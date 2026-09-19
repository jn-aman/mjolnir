import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { LEASE_GRACE_DAYS, describeLease, shouldRenew, verifyLease, type Lease } from './lease.ts';
import { deviceFingerprint, deviceName, newDeviceId } from './device.ts';
import { pollForTokens, requestDeviceCode, waitForApproval, type DeviceGrantTransport } from './device-grant.ts';
import { enforcementNote, offeredProviders } from './providers.ts';

const keys = generateKeyPairSync('ed25519');
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const DEVICE = 'device-aaaaaaaa';
const OFFER = { available: ['email' as const], enforced: null, enforcedBy: null };
const DAY = 86_400;

function issue(overrides: Partial<Lease> = {}, key = keys.privateKey): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const lease: Lease = {
    claims: {
      jti: 'lic_1',
      email: 'someone@example.com',
      plan: 'monthly',
      iat: nowSeconds,
      expiresAt: nowSeconds + 30 * DAY,
      updatesUntil: nowSeconds + 30 * DAY,
      customerId: 'ctm_1',
    },
    deviceId: DEVICE,
    notAfter: nowSeconds + 7 * DAY,
    issuedAt: nowSeconds,
    nonce: 'nonce-1234',
    ...overrides,
  };
  const payload = Buffer.from(JSON.stringify(lease), 'utf8');
  const signature = signBytes(null, payload, key);
  return `${payload.toString('base64url')}.${signature.toString('base64url')}`;
}

describe('verifyLease', () => {
  const options = { publicKeyPem, deviceId: DEVICE };

  it('grants Pro for a lease that is in date and ours', () => {
    const status = verifyLease(issue(), options);
    expect(status.kind).toBe('valid');
    expect(status.tier).toBe('pro');
  });

  it('gives the free tier and a reason rather than throwing on rubbish', () => {
    for (const bad of ['', 'not-a-lease', 'a.b', '....', 'eyJhIjoxfQ.zzzz']) {
      const status = verifyLease(bad, options);
      expect(status.tier).toBe('free');
      expect(['none', 'invalid']).toContain(status.kind);
    }
  });

  it('refuses a lease signed by someone else', () => {
    const other = generateKeyPairSync('ed25519');
    const status = verifyLease(issue({}, other.privateKey), options);
    expect(status).toMatchObject({ kind: 'invalid', tier: 'free' });
  });

  it('refuses a lease issued to another machine, and says which problem it is', () => {
    const status = verifyLease(issue(), { ...options, deviceId: 'a-different-device' });
    expect(status.kind).toBe('wrong-device');
    expect(status.tier).toBe('free');
  });

  it('keeps Pro through the offline grace window', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = issue({ notAfter: nowSeconds - 2 * DAY });
    const status = verifyLease(token, options);
    expect(status.kind).toBe('grace');
    expect(status.tier).toBe('pro');
  });

  it('drops to free once the grace window is spent', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = issue({ notAfter: nowSeconds - (LEASE_GRACE_DAYS + 1) * DAY });
    const status = verifyLease(token, options);
    expect(status.kind).toBe('expired');
    expect(status.tier).toBe('free');
  });

  it('holds the line exactly at the end of grace', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const boundary = nowSeconds - LEASE_GRACE_DAYS * DAY;
    expect(verifyLease(issue({ notAfter: boundary }), options).tier).toBe('pro');
    expect(verifyLease(issue({ notAfter: boundary - 1 }), options).tier).toBe('free');
  });

  it('refuses a lease whose body has been edited', () => {
    const token = issue();
    const [body, signature] = token.split('.');
    const tampered = JSON.parse(Buffer.from(body ?? '', 'base64url').toString('utf8')) as Lease;
    const forged = { ...tampered, claims: { ...tampered.claims, plan: 'lifetime' as const, expiresAt: null } };
    const swapped = `${Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url')}.${signature ?? ''}`;
    expect(verifyLease(swapped, options).kind).toBe('invalid');
  });
});

describe('shouldRenew', () => {
  const options = { publicKeyPem, deviceId: DEVICE };

  it('does not renew a lease with days left on it', () => {
    expect(shouldRenew(verifyLease(issue(), options))).toBe(false);
  });

  it('renews when the lease is nearly out', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(shouldRenew(verifyLease(issue({ notAfter: nowSeconds + 3600 }), options))).toBe(true);
  });

  it('renews when there is nothing stored at all', () => {
    expect(shouldRenew(verifyLease('', options))).toBe(true);
  });

  it('renews when the stored lease belongs to another machine', () => {
    expect(shouldRenew(verifyLease(issue(), { ...options, deviceId: 'elsewhere' }))).toBe(true);
  });
});

describe('describeLease', () => {
  it('never tells a free user something is wrong when nothing is', () => {
    const described = describeLease(verifyLease('', { publicKeyPem, deviceId: DEVICE }));
    expect(described.tier).toBe('free');
    expect(described.detail).toMatch(/fully usable/i);
  });

  it('explains a copied home directory in words a person can act on', () => {
    const described = describeLease(verifyLease(issue(), { publicKeyPem, deviceId: 'other' }));
    expect(described.headline).toMatch(/another machine/i);
  });
});

describe('deviceName', () => {
  it('keeps a plain hostname', () => {
    expect(deviceName('build-server-3', 'aman')).toBe('build-server-3');
  });

  it('strips the trailing .local macOS adds', () => {
    expect(deviceName('workshop.local', 'aman')).toBe('workshop');
  });

  it("takes the owner's name out of the default macOS hostname", () => {
    expect(deviceName("aman's MacBook Pro", 'aman')).toBe('MacBook Pro');
    expect(deviceName('Aman’s MacBook Air', 'aman')).toBe('MacBook Air');
  });

  it('handles the hyphenated form macOS actually uses for the hostname', () => {
    expect(deviceName('Amans-MacBook-Pro-2', 'aman')).toBe('MacBook-Pro-2');
  });

  it('does not eat a name that merely starts with the username', () => {
    expect(deviceName('amanda-laptop', 'aman')).toBe('amanda-laptop');
    expect(deviceName('amantha', 'aman')).toBe('amantha');
  });

  it('never returns nothing', () => {
    expect(deviceName('', '')).toBe('This machine');
    expect(deviceName('aman', 'aman')).toBe('aman');
  });
});

describe('deviceFingerprint', () => {
  it('is stable and short', () => {
    const id = newDeviceId();
    expect(deviceFingerprint(id)).toBe(deviceFingerprint(id));
    expect(deviceFingerprint(id)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it('does not reveal the id itself', () => {
    const id = newDeviceId();
    expect(deviceFingerprint(id)).not.toContain(id.slice(0, 8));
  });
});

/** A transport that answers from a script, so the flow is testable offline. */
function scripted(responses: Array<{ status: number; body: unknown } | Error>): DeviceGrantTransport & { calls: number } {
  let at = 0;
  const transport = {
    calls: 0,
    async post(): Promise<{ status: number; body: unknown }> {
      transport.calls += 1;
      const next = responses[Math.min(at, responses.length - 1)];
      at += 1;
      if (next instanceof Error) throw next;
      return next ?? { status: 500, body: {} };
    },
  };
  return transport;
}

describe('device grant', () => {
  const device = { id: 'device-1', name: 'Workshop', platform: 'darwin' as NodeJS.Platform, appVersion: '0.1.0' };

  it('asks for a code and hands back what to show', async () => {
    const transport = scripted([
      { status: 200, body: { device_code: 'dc_1', user_code: 'HAMR-4Q7X', verification_uri: 'https://mjolnir.sh/device', expires_in: 900, interval: 5 } },
    ]);
    const code = await requestDeviceCode(transport, device);
    expect(code.user_code).toBe('HAMR-4Q7X');
    expect(code.interval).toBe(5);
  });

  it('treats a dropped connection as "not yet", never as a refusal', async () => {
    const transport = scripted([new Error('socket hang up')]);
    const result = await pollForTokens(transport, 'dc_1');
    expect(result).toMatchObject({ done: false, failure: { error: 'network' } });
  });

  it('waits through pending answers and then succeeds', async () => {
    const transport = scripted([
      { status: 400, body: { error: 'authorization_pending' } },
      { status: 400, body: { error: 'authorization_pending' } },
      { status: 200, body: { refresh_token: 'rt', access_token: 'at', expires_in: 900, email: 'a@b.c' } },
    ]);
    const sleep = vi.fn(async () => {});
    const result = await waitForApproval({
      transport,
      code: { device_code: 'dc_1', user_code: 'X', verification_uri: 'u', expires_in: 900, interval: 5, providers: OFFER },
      sleep,
    });
    expect(result.done).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('backs off when the server says slow_down, rather than ignoring it', async () => {
    const transport = scripted([
      { status: 400, body: { error: 'slow_down' } },
      { status: 200, body: { refresh_token: 'rt', access_token: 'at', expires_in: 900 } },
    ]);
    const waits: number[] = [];
    await waitForApproval({
      transport,
      code: { device_code: 'dc_1', user_code: 'X', verification_uri: 'u', expires_in: 900, interval: 5, providers: OFFER },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([5000, 10_000]);
  });

  it('stops when the person refuses', async () => {
    const transport = scripted([{ status: 400, body: { error: 'access_denied', error_description: 'you said no' } }]);
    const result = await waitForApproval({
      transport,
      code: { device_code: 'dc_1', user_code: 'X', verification_uri: 'u', expires_in: 900, interval: 5, providers: OFFER },
      sleep: async () => {},
    });
    expect(result).toMatchObject({ done: false, failure: { error: 'access_denied', description: 'you said no' } });
  });

  it('gives up when the code expires instead of polling forever', async () => {
    const transport = scripted([{ status: 400, body: { error: 'authorization_pending' } }]);
    let clock = 0;
    const result = await waitForApproval({
      transport,
      code: { device_code: 'dc_1', user_code: 'X', verification_uri: 'u', expires_in: 10, interval: 5, providers: OFFER },
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    expect(result).toMatchObject({ done: false, failure: { error: 'expired_token' } });
  });

  it('can be cancelled', async () => {
    const transport = scripted([{ status: 400, body: { error: 'authorization_pending' } }]);
    const result = await waitForApproval({
      transport,
      code: { device_code: 'dc_1', user_code: 'X', verification_uri: 'u', expires_in: 900, interval: 5, providers: OFFER },
      sleep: async () => {},
      signal: { aborted: true },
    });
    expect(result).toMatchObject({ done: false, failure: { error: 'access_denied' } });
    expect(transport.calls).toBe(0);
  });

  it('surfaces a seat limit as its own answer, not a generic failure', async () => {
    const transport = scripted([{ status: 409, body: { error: 'seat_limit', error_description: 'all 3 seats are in use' } }]);
    const result = await pollForTokens(transport, 'dc_1');
    expect(result).toMatchObject({ done: false, failure: { error: 'seat_limit', description: 'all 3 seats are in use' } });
  });
});

describe('providers', () => {
  it('puts the everyday ways in first and the enterprise one last', () => {
    const offered = offeredProviders({ available: ['okta', 'email', 'github'], enforced: null, enforcedBy: null });
    expect(offered.map((p) => p.id)).toEqual(['email', 'github', 'okta']);
  });

  it('offers only the enforced provider, so nobody makes a second identity by accident', () => {
    const offered = offeredProviders({ available: ['email', 'github', 'okta'], enforced: 'okta', enforcedBy: 'Acme' });
    expect(offered.map((p) => p.id)).toEqual(['okta']);
  });

  it('says whose policy it is rather than just refusing', () => {
    expect(enforcementNote({ available: [], enforced: 'okta', enforcedBy: 'Acme' })).toBe(
      'Acme requires everyone to sign in through Okta.',
    );
    expect(enforcementNote({ available: [], enforced: 'okta', enforcedBy: null })).toMatch(/Your organisation requires/);
    expect(enforcementNote({ available: ['email'], enforced: null, enforcedBy: null })).toBeNull();
  });

  it('always offers something, even from an empty answer', () => {
    expect(offeredProviders({ available: [], enforced: null, enforcedBy: null }).map((p) => p.id)).toEqual(['email']);
  });

  it('asks for a provider and a login hint when it has them', async () => {
    let sent: unknown = null;
    const transport: DeviceGrantTransport = {
      async post(_path, body) {
        sent = body;
        return { status: 200, body: { device_code: 'dc', user_code: 'U', verification_uri: 'v', expires_in: 900, interval: 5 } };
      },
    };
    await requestDeviceCode(transport, { id: 'd', name: 'n', platform: 'darwin', appVersion: '0.1.0' }, { provider: 'github', emailHint: 'a@acme.com' });
    expect(sent).toMatchObject({ provider: 'github', login_hint: 'a@acme.com' });
  });

  it('sends no provider when none was chosen, so the site decides', async () => {
    let sent: Record<string, unknown> = {};
    const transport: DeviceGrantTransport = {
      async post(_path, body) {
        sent = body as Record<string, unknown>;
        return { status: 200, body: { device_code: 'dc', user_code: 'U', verification_uri: 'v', expires_in: 900, interval: 5 } };
      },
    };
    await requestDeviceCode(transport, { id: 'd', name: 'n', platform: 'darwin', appVersion: '0.1.0' });
    expect(sent['provider']).toBeUndefined();
    expect(sent['login_hint']).toBeUndefined();
  });

  it('defaults the offer when a server does not send one', async () => {
    const transport: DeviceGrantTransport = {
      async post() {
        return { status: 200, body: { device_code: 'dc', user_code: 'U', verification_uri: 'v', expires_in: 900, interval: 5 } };
      },
    };
    const code = await requestDeviceCode(transport, { id: 'd', name: 'n', platform: 'darwin', appVersion: '0.1.0' });
    expect(code.providers.available).toEqual(['email']);
    expect(code.providers.enforced).toBeNull();
  });
});
