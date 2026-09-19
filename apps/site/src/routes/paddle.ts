import { Router, raw } from 'express';
import { DEFAULT_SEATS, NotificationSchema, actionFor, verifyWebhookSignature, type LicenseAction, type PriceCatalogue } from '@mjolnir/paddle';
import { logger } from '@mjolnir/logger';
import type { Store, Subscription } from '../db.ts';
import { newId } from '../signing.ts';

const log = logger.child('paddle');

/**
 * Money becoming a subscription.
 *
 * Three rules make this survivable:
 *
 * The signature is checked on the **raw** body, before anything parses it.
 * A webhook handler that parses first and verifies second is verifying
 * something it reconstructed, which is not the same bytes and not a signature
 * check.
 *
 * It is idempotent. Paddle retries, and it retries the ones that timed out
 * after succeeding, so every path has to end in the same state whether it runs
 * once or six times.
 *
 * It answers 200 for anything it understood, including events it deliberately
 * ignores. Returning an error for an event we do not care about teaches Paddle
 * to retry it forever.
 */
export function paddleRoutes(
  store: Store,
  options: {
    readonly secret: string;
    readonly catalogue: PriceCatalogue;
    /** Looks up an email for a customer id. Injected so this is testable without Paddle. */
    readonly customerEmail: (customerId: string) => Promise<string | null>;
    /** Sends a sign-in link to someone who paid before they had an account. */
    readonly inviteNewCustomer?: (email: string) => Promise<void>;
  },
): Router {
  const router = Router();

  router.post(
    '/',
    // Raw, so the bytes that were signed are the bytes that are checked.
    raw({ type: () => true, limit: '1mb' }),
    async (req, res) => {
      const signature = req.get('paddle-signature') ?? '';
      const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');

      const verified = verifyWebhookSignature({ rawBody: body, signatureHeader: signature, secret: options.secret });
      if (!verified.ok) {
        log.warn('webhook rejected', { reason: verified.reason });
        res.status(401).json({ error: 'bad_signature', reason: verified.reason });
        return;
      }

      let notification;
      try {
        notification = NotificationSchema.parse(JSON.parse(body));
      } catch {
        res.status(400).json({ error: 'bad_body' });
        return;
      }

      const action = actionFor(notification, options.catalogue);
      log.info('webhook', { event: notification.event_type, action: action.kind });

      try {
        await apply(store, action, options);
      } catch (error) {
        // A failure here must be retried, so it is the one case that answers
        // with an error on purpose.
        log.error('could not apply a webhook', { event: notification.event_type, error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ error: 'not_applied' });
        return;
      }

      res.json({ ok: true, action: action.kind });
    },
  );

  return router;
}

async function apply(
  store: Store,
  action: LicenseAction,
  options: { customerEmail: (id: string) => Promise<string | null>; inviteNewCustomer?: (email: string) => Promise<void> },
): Promise<void> {
  if (action.kind === 'ignore') return;

  const account = await resolveAccount(store, action.customerId, options);
  if (!account) {
    log.warn('no account for customer, and no email to make one with', { customer: action.customerId });
    return;
  }

  if (action.kind === 'revoke') {
    for (const subscription of liveSubscriptions(store, account.id)) {
      store.saveSubscription({ ...subscription, status: 'refunded' });
    }
    // The devices keep their leases until those expire. Cutting someone off
    // mid-session over a chargeback we may yet dispute is worse than a week
    // of access we did not mean to give.
    log.info('subscription revoked', { account: account.id, reason: action.reason });
    return;
  }

  if (action.kind === 'extend') {
    const current = (action.subscriptionId ? store.subscriptionByPaddleId(action.subscriptionId) : null) ?? store.subscriptionFor(account.id);
    if (!current) return;
    store.saveSubscription({
      ...current,
      status: 'active',
      expiresAt: Math.floor(action.expiresAt.getTime() / 1000),
      updatesUntil: Math.max(current.updatesUntil, Math.floor(action.expiresAt.getTime() / 1000)),
      // Seats can go up mid-period, and someone who just paid for more should
      // be able to use them now rather than at the next renewal.
      seats: action.seats ?? current.seats,
    });
    return;
  }

  // issue. Keyed on the Paddle subscription id where there is one, so a retry
  // updates the same row rather than granting a second licence.
  const paddleId = action.subscriptionId ?? '';
  const existing = paddleId ? store.subscriptionByPaddleId(paddleId) : null;
  const subscription: Subscription = {
    id: existing?.id ?? newId('sub'),
    accountId: account.id,
    plan: action.plan,
    status: 'active',
    expiresAt: action.expiresAt ? Math.floor(action.expiresAt.getTime() / 1000) : null,
    updatesUntil: Math.floor(action.updatesUntil.getTime() / 1000),
    // What they paid for, never fewer than the floor: a customer from before
    // seats existed does not quietly lose four machines.
    seats: Math.max(action.seats ?? DEFAULT_SEATS, existing?.seats ?? 0, DEFAULT_SEATS),
    paddleSubscriptionId: paddleId || existing?.paddleSubscriptionId || null,
  };
  store.saveSubscription(subscription);
  if (!account.customerId) store.setCustomerId(account.id, action.customerId);
  log.info('subscription issued', { account: account.id, plan: action.plan });
}

function liveSubscriptions(store: Store, accountId: string): Subscription[] {
  const found: Subscription[] = [];
  let next = store.subscriptionFor(accountId);
  // subscriptionFor returns the most generous live one; loop until none are
  // left so a refund clears every row rather than the best one.
  const seen = new Set<string>();
  while (next && !seen.has(next.id)) {
    seen.add(next.id);
    found.push(next);
    store.saveSubscription({ ...next, status: 'cancelled' });
    next = store.subscriptionFor(accountId);
  }
  // Put them back as they were; the caller decides the final status.
  for (const subscription of found) store.saveSubscription(subscription);
  return found;
}

/**
 * The account a payment belongs to.
 *
 * A purchase can arrive before anyone has signed in, which is the normal case
 * for a first sale: the buyer went to the website, paid, and has never opened
 * the app. So the account is created from the email Paddle holds, and they are
 * sent a link. The purchase has to work before the account does.
 */
async function resolveAccount(
  store: Store,
  customerId: string,
  options: { customerEmail: (id: string) => Promise<string | null>; inviteNewCustomer?: (email: string) => Promise<void> },
) {
  const byCustomer = store.accountByCustomerId(customerId);
  if (byCustomer) return byCustomer;

  const email = await options.customerEmail(customerId);
  if (!email) return null;

  const existing = store.accountByEmail(email);
  const account = store.upsertAccount(email, () => newId('acc'));
  store.setCustomerId(account.id, customerId);
  if (!existing) await options.inviteNewCustomer?.(email);
  return store.accountById(account.id);
}
