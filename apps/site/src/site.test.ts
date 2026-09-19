import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { verifyLease } from '@mjolnir/account';
import { startSite } from './main.ts';
import type { Store } from './db.ts';
import { newId } from './signing.ts';

/**
 * The whole service, over HTTP, with nothing mocked but email delivery.
 *
 * Sign-in, seats, revocation and offline verification are the four things that
 * decide whether a paying customer can use what they bought, so they are
 * tested through the same doors the app knocks on rather than by calling the
 * functions underneath.
 */
const keys = generateKeyPairSync('ed25519');
const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

let site: Awaited<ReturnType<typeof startSite>>;
let base: string;
const sent: Array<{ to: string; code: string }> = [];

beforeAll(async () => {
  site = await startSite({
    port: 0,
    databasePath: ':memory:',
    signingKeyPem: privateKeyPem,
    verificationUri: 'https://mjolnir.sh/device',
    sendEmail: async (to, code) => {
      sent.push({ to, code });
    },
  });
  base = `http://127.0.0.1:${site.port}`;
});

afterAll(() => site.close());

const post = async (path: string, body: unknown = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, never> };
};

/** Signs in a device the way the app does, and returns its refresh token. */
async function signIn(deviceId: string, email: string, name = 'A machine') {
  const code = await post('/api/device/code', { device_id: deviceId, device_name: name, platform: 'darwin', app_version: '0.1.0' });
  await post('/api/auth/email/start', { email });
  const delivered = sent.at(-1);
  const verified = await post('/api/auth/email/verify', { email, code: delivered?.code });
  await post('/api/device/approve', { user_code: code.body['user_code'], account_id: verified.body['accountId'] });
  // The app polls; one poll is enough once it is approved.
  const tokens = await post('/api/device/token', { device_code: code.body['device_code'] });
  return { tokens: tokens.body, accountId: String(verified.body['accountId']), userCode: String(code.body['user_code']) };
}

function giveSubscription(store: Store, accountId: string, seats: number, plan: 'monthly' | 'lifetime' = 'monthly') {
  store.saveSubscription({
    id: newId('sub'),
    accountId,
    plan,
    status: 'active',
    expiresAt: plan === 'lifetime' ? null : Math.floor(Date.now() / 1000) + 30 * 86_400,
    updatesUntil: Math.floor(Date.now() / 1000) + 365 * 86_400,
    seats,
    paddleSubscriptionId: null,
  });
}

describe('the service answers at all', () => {
  it('is healthy', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});

describe('signing in', () => {
  it('hands out a code to show, and refuses to say anything before approval', async () => {
    const code = await post('/api/device/code', { device_id: 'dev-pending-1', device_name: 'Laptop', platform: 'darwin', app_version: '0.1.0' });
    expect(code.status).toBe(200);
    expect(String(code.body['user_code'])).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const early = await post('/api/device/token', { device_code: code.body['device_code'] });
    expect(early.status).toBe(400);
    expect(early.body['error']).toBe('authorization_pending');
  });

  it('tells a client that polls too fast to slow down', async () => {
    const code = await post('/api/device/code', { device_id: 'dev-fast-1' });
    await post('/api/device/token', { device_code: code.body['device_code'] });
    const second = await post('/api/device/token', { device_code: code.body['device_code'] });
    expect(second.body['error']).toBe('slow_down');
  });

  it('never reveals the device code from the user code', async () => {
    const code = await post('/api/device/code', { device_id: 'dev-lookup-1', device_name: 'Workshop' });
    const looked = await fetch(`${base}/api/device/verify/${String(code.body['user_code'])}`);
    const body = (await looked.json()) as Record<string, unknown>;
    expect(body['deviceName']).toBe('Workshop');
    expect(JSON.stringify(body)).not.toContain(String(code.body['device_code']));
  });

  it('completes, and the code cannot be spent twice', async () => {
    const { tokens, userCode } = await signIn('dev-once-1', 'once@example.com');
    expect(String(tokens['refresh_token'])).toMatch(/^mjr_/);

    const grant = await post('/api/device/approve', { user_code: userCode, account_id: 'acc_whatever' });
    expect(grant.status).toBe(404);
  });

  it('refuses a wrong email code, and eventually stops accepting guesses', async () => {
    await post('/api/auth/email/start', { email: 'guess@example.com' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await post('/api/auth/email/verify', { email: 'guess@example.com', code: '000000' });
    }
    const last = await post('/api/auth/email/verify', { email: 'guess@example.com', code: '000000' });
    expect(last.status).toBe(400);
    expect(['wrong', 'too-many']).toContain(last.body['error']);
  });
});

describe('licences and seats', () => {
  it('refuses a lease when nothing has been paid for, and says the free tier is fine', async () => {
    const { tokens } = await signIn('dev-free-1', 'free@example.com');
    const lease = await post('/api/licence/lease', { refresh_token: tokens['refresh_token'] });
    expect(lease.status).toBe(402);
    expect(lease.body['error']).toBe('no_subscription');
    expect(String(lease.body['description'])).toMatch(/free tier still works/i);
  });

  it('issues a lease that verifies offline against the public key', async () => {
    const { tokens, accountId } = await signIn('dev-pro-1', 'pro@example.com');
    giveSubscription(site.store, accountId, 5);

    const lease = await post('/api/licence/lease', { refresh_token: tokens['refresh_token'], device_name: 'Workshop', platform: 'darwin', app_version: '0.1.0' });
    expect(lease.status).toBe(200);

    const status = verifyLease(String(lease.body['lease']), { publicKeyPem, deviceId: 'dev-pro-1' });
    expect(status.kind).toBe('valid');
    expect(status.tier).toBe('pro');
  });

  it('will not let that lease work on another machine', async () => {
    const { tokens, accountId } = await signIn('dev-bind-1', 'bind@example.com');
    giveSubscription(site.store, accountId, 5);
    const lease = await post('/api/licence/lease', { refresh_token: tokens['refresh_token'] });
    const elsewhere = verifyLease(String(lease.body['lease']), { publicKeyPem, deviceId: 'some-other-machine' });
    expect(elsewhere.kind).toBe('wrong-device');
  });

  it('gives five machines by default', async () => {
    const email = 'five@example.com';
    let accountId = '';
    for (let n = 1; n <= 5; n += 1) {
      const { tokens, accountId: id } = await signIn(`dev-five-${n}`, email, `Machine ${n}`);
      accountId = id;
      if (n === 1) giveSubscription(site.store, accountId, 5);
      const lease = await post('/api/licence/lease', { refresh_token: tokens['refresh_token'], device_name: `Machine ${n}` });
      expect(lease.status).toBe(200);
      expect(lease.body['seats']).toMatchObject({ total: 5, used: n });
    }
  });

  it('refuses the sixth, and hands back the list so it can be fixed on the spot', async () => {
    const { tokens } = await signIn('dev-five-6', 'five@example.com', 'Machine 6');
    const lease = await post('/api/licence/lease', { refresh_token: tokens['refresh_token'], device_name: 'Machine 6' });
    expect(lease.status).toBe(409);
    expect(lease.body['error']).toBe('seat_limit');
    const devices = lease.body['devices'] as unknown as Array<{ name: string; active: boolean; current: boolean }>;
    expect(devices.filter((d) => d.active)).toHaveLength(5);
    expect(devices.some((d) => d.current)).toBe(true);
    expect(String(lease.body['description'])).toMatch(/add seats/i);
  });

  it('frees a seat the moment another machine is signed out', async () => {
    const { tokens } = await signIn('dev-five-6', 'five@example.com', 'Machine 6');
    const revoked = await post('/api/account/devices/revoke', { refresh_token: tokens['refresh_token'], device_id: 'dev-five-1' });
    expect(revoked.status).toBe(200);

    const retry = await post('/api/licence/lease', { refresh_token: tokens['refresh_token'], device_name: 'Machine 6' });
    expect(retry.status).toBe(200);
    expect(retry.body['seats']).toMatchObject({ total: 5, used: 5 });
  });

  it('honours more seats when more are bought', async () => {
    const { accountId } = await signIn('dev-more-1', 'more@example.com');
    giveSubscription(site.store, accountId, 12);
    const { tokens } = await signIn('dev-more-2', 'more@example.com', 'Second');
    const lease = await post('/api/licence/lease', { refresh_token: tokens['refresh_token'] });
    expect(lease.body['seats']).toMatchObject({ total: 12 });
  });

  it('lists every machine, saying which hold a seat and which one is asking', async () => {
    const { tokens } = await signIn('dev-more-2', 'more@example.com', 'Second');
    const listed = await post('/api/account/devices', { refresh_token: tokens['refresh_token'] });
    const devices = listed.body['devices'] as unknown as Array<{ id: string; current: boolean; active: boolean }>;
    expect(devices.length).toBeGreaterThanOrEqual(2);
    expect(devices.find((d) => d.current)?.id).toBe('dev-more-2');
  });
});

describe('signing out', () => {
  it('stops that device using the account at all', async () => {
    const { tokens, accountId } = await signIn('dev-out-1', 'out@example.com');
    giveSubscription(site.store, accountId, 5);
    expect((await post('/api/licence/lease', { refresh_token: tokens['refresh_token'] })).status).toBe(200);

    await post('/api/token/revoke', { refresh_token: tokens['refresh_token'] });

    const after = await post('/api/licence/lease', { refresh_token: tokens['refresh_token'] });
    expect(after.status).toBe(401);
  });

  it('refuses a token that was never ours', async () => {
    const made_up = await post('/api/licence/lease', { refresh_token: 'mjr_not_a_real_token' });
    expect(made_up.status).toBe(401);
  });
});

describe('enterprise sign-in', () => {
  it('will not let an enforced domain sign in with an email code', async () => {
    site.store.raw.exec(`
      insert into organisations (id, name, sso_issuer, sso_client_id, sso_client_secret, enforce_sso)
      values ('org_acme', 'Acme', 'https://acme.okta.com', 'cid', 'secret', 1);
      insert into domains (domain, organisation_id, verified_at, verification_token)
      values ('acme.test', 'org_acme', '2026-01-01T00:00:00Z', 'tok');
    `);
    const started = await post('/api/auth/email/start', { email: 'someone@acme.test' });
    expect(started.status).toBe(409);
    expect(started.body['error']).toBe('sso_required');
    expect(String(started.body['error_description'])).toContain('Acme');
  });

  it('offers only Okta to a device that hinted an enforced domain', async () => {
    const code = await post('/api/device/code', { device_id: 'dev-okta-1', login_hint: 'someone@acme.test' });
    const providers = code.body['providers'] as unknown as { available: string[]; enforced: string | null; enforcedBy: string | null };
    expect(providers.available).toEqual(['okta']);
    expect(providers.enforced).toBe('okta');
    expect(providers.enforcedBy).toBe('Acme');
  });

  it('leaves everyone else with the full set', async () => {
    const code = await post('/api/device/code', { device_id: 'dev-open-1', login_hint: 'someone@gmail.test' });
    const providers = code.body['providers'] as unknown as { available: string[]; enforced: string | null };
    expect(providers.available).toContain('email');
    expect(providers.available).toContain('github');
    expect(providers.enforced).toBeNull();
  });
});
