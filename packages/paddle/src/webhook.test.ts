import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSignatureHeader, verifyWebhookSignature } from './webhook.ts';
import { NotificationSchema, actionFor, type PriceCatalogue } from './events.ts';

const SECRET = 'pdl_ntfset_secret';
const NOW = new Date('2026-09-18T12:00:00Z');
const TS = Math.floor(NOW.getTime() / 1000);

function sign(body: string, secret = SECRET, ts = TS): string {
  const hash = createHmac('sha256', secret).update(`${ts}:${body}`, 'utf8').digest('hex');
  return `ts=${ts};h1=${hash}`;
}

describe('parseSignatureHeader', () => {
  it('reads ts and h1', () => {
    expect(parseSignatureHeader('ts=123;h1=abc')).toEqual({ timestamp: 123, hashes: ['abc'] });
  });

  it('collects every h1 present during a secret rotation', () => {
    const parsed = parseSignatureHeader('ts=123;h1=aaa;h1=bbb');
    expect(parsed?.hashes).toEqual(['aaa', 'bbb']);
  });

  it('rejects headers missing either part', () => {
    expect(parseSignatureHeader('h1=abc')).toBeNull();
    expect(parseSignatureHeader('ts=123')).toBeNull();
    expect(parseSignatureHeader('nonsense')).toBeNull();
  });
});

describe('verifyWebhookSignature', () => {
  const body = '{"event_id":"evt_1","event_type":"transaction.completed"}';

  it('accepts a correctly signed body', () => {
    const result = verifyWebhookSignature({
      rawBody: body,
      signatureHeader: sign(body),
      secret: SECRET,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a Buffer body identically to a string', () => {
    const result = verifyWebhookSignature({
      rawBody: Buffer.from(body, 'utf8'),
      signatureHeader: sign(body),
      secret: SECRET,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a body that was re-serialised rather than passed raw', () => {
    // The classic Paddle bug: express.json() parses, the handler re-stringifies,
    // key order and whitespace shift, and every signature fails.
    const reserialized = JSON.stringify(JSON.parse(body), null, 2);
    const result = verifyWebhookSignature({
      rawBody: reserialized,
      signatureHeader: sign(body),
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'no-match' });
  });

  it('rejects the wrong secret', () => {
    const result = verifyWebhookSignature({
      rawBody: body,
      signatureHeader: sign(body, 'wrong-secret'),
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'no-match' });
  });

  it('rejects a replayed request outside the tolerance window', () => {
    const result = verifyWebhookSignature({
      rawBody: body,
      signatureHeader: sign(body, SECRET, TS - 600),
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'stale' });
  });

  it('honours a widened tolerance for queued redelivery', () => {
    const result = verifyWebhookSignature({
      rawBody: body,
      signatureHeader: sign(body, SECRET, TS - 600),
      secret: SECRET,
      toleranceSeconds: 3600,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts when any h1 in a rotating header matches', () => {
    const valid = sign(body).split('h1=')[1];
    const result = verifyWebhookSignature({
      rawBody: body,
      signatureHeader: `ts=${TS};h1=${'0'.repeat(64)};h1=${valid}`,
      secret: SECRET,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });
});

describe('actionFor', () => {
  const catalogue: PriceCatalogue = {
    monthly: 'pri_monthly',
    annual: 'pri_annual',
  };

  const notify = (eventType: string, data: unknown) =>
    NotificationSchema.parse({
      event_id: 'evt_1',
      event_type: eventType,
      occurred_at: NOW.toISOString(),
      data,
    });

  it('provisions nothing from a payment, because every plan is recurring', () => {
    // Subscription events carry the authoritative period end and arrive for
    // the same payment. Issuing from both would grant a licence twice on the
    // first charge, with two different end dates.
    const action = actionFor(
      notify('transaction.completed', {
        customer_id: 'ctm_1',
        items: [{ price: { id: 'pri_monthly' } }],
      }),
      catalogue,
      NOW,
    );
    expect(action.kind).toBe('ignore');
  });

  it('ignores a recurring transaction, leaving it to subscription events', () => {
    const action = actionFor(
      notify('transaction.completed', {
        customer_id: 'ctm_1',
        items: [{ price: { id: 'pri_annual' } }],
      }),
      catalogue,
      NOW,
    );
    // Handling it here as well would issue the licence twice on first payment.
    expect(action.kind).toBe('ignore');
  });

  it('issues a subscription licence ending at the billing period end', () => {
    const endsAt = '2027-09-18T12:00:00Z';
    const action = actionFor(
      notify('subscription.created', {
        customer_id: 'ctm_1',
        items: [{ price: { id: 'pri_annual' } }],
        current_billing_period: { ends_at: endsAt },
      }),
      catalogue,
      NOW,
    );
    if (action.kind !== 'issue') throw new Error('expected issue');
    expect(action.plan).toBe('annual');
    expect(action.expiresAt?.toISOString()).toBe(new Date(endsAt).toISOString());
  });

  it('keeps access to the end of the paid period when a subscription is cancelled', () => {
    const endsAt = '2026-10-18T12:00:00Z';
    const action = actionFor(
      notify('subscription.canceled', {
        customer_id: 'ctm_1',
        current_billing_period: { ends_at: endsAt },
      }),
      catalogue,
      NOW,
    );
    // Cutting access at the cancel click is the fastest route to a chargeback.
    expect(action.kind).toBe('extend');
  });

  it('revokes when a cancelled period has already ended', () => {
    const action = actionFor(
      notify('subscription.canceled', {
        customer_id: 'ctm_1',
        current_billing_period: { ends_at: '2026-01-01T00:00:00Z' },
      }),
      catalogue,
      NOW,
    );
    expect(action.kind).toBe('revoke');
  });

  it('revokes on a refund or chargeback', () => {
    const action = actionFor(notify('adjustment.created', { customer_id: 'ctm_1' }), catalogue, NOW);
    expect(action).toMatchObject({ kind: 'revoke', customerId: 'ctm_1' });
  });

  it('ignores an unknown price rather than guessing a plan', () => {
    const action = actionFor(
      notify('transaction.completed', {
        customer_id: 'ctm_1',
        items: [{ price: { id: 'pri_someone_elses_product' } }],
      }),
      catalogue,
      NOW,
    );
    expect(action.kind).toBe('ignore');
  });

  it('ignores event types it does not handle', () => {
    expect(actionFor(notify('report.created', {}), catalogue, NOW).kind).toBe('ignore');
  });
});
