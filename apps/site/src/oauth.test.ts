import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { startSite } from './main.ts';

/**
 * GitHub, Google and Okta, end to end, with a fake provider on the other side.
 *
 * The fake is not a stub that returns a fixed answer: it checks the client
 * credentials, checks that the `code_verifier` we send hashes to the
 * `code_challenge` we published, and checks that the redirect URI is the same
 * one both times. Those are the properties that make this flow safe, and a
 * test that accepts any exchange would pass just as happily with all three
 * removed.
 *
 * What is actually being tested here is account identity: that one human with
 * three sign-in methods gets one account, that an unverified address can never
 * reach an existing one, and that an organisation's identity provider can only
 * speak for the domains it has proved it owns.
 */

interface Person {
  readonly subject: string;
  readonly email: string;
  readonly verified: boolean;
  readonly handle?: string;
  /** GitHub only: the address on the public profile, which may be a lie. */
  readonly profileEmail?: string;
  /** GitHub only: addresses that are not primary. */
  readonly others?: ReadonlyArray<{ email: string; verified: boolean }>;
}

const GITHUB = { clientId: 'gh_id', clientSecret: 'gh_secret' };
const GOOGLE = { clientId: 'goog_id', clientSecret: 'goog_secret' };
const OKTA = { clientId: 'okta_id', clientSecret: 'okta_secret' };
const OKTA_ISSUER = 'https://acme.okta.com/oauth2/default';

/** Codes the fake has issued, with what was promised when they were issued. */
const issued = new Map<string, { provider: string; person: Person; challenge: string; redirectUri: string }>();
const calls: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Stands in for GitHub, Google and Okta. Verifies rather than accepts. */
const fakeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  calls.push(url);
  const headers = new Headers(init?.headers ?? {});

  if (url === `${OKTA_ISSUER}/.well-known/openid-configuration`) {
    return json({
      issuer: OKTA_ISSUER,
      authorization_endpoint: `${OKTA_ISSUER}/v1/authorize`,
      token_endpoint: `${OKTA_ISSUER}/v1/token`,
      userinfo_endpoint: `${OKTA_ISSUER}/v1/userinfo`,
    });
  }

  // ---- the token endpoints, which are where the checks live -------------
  const tokenEndpoints: Record<string, { provider: string; app: { clientId: string; clientSecret: string } }> = {
    'https://github.com/login/oauth/access_token': { provider: 'github', app: GITHUB },
    'https://oauth2.googleapis.com/token': { provider: 'google', app: GOOGLE },
    [`${OKTA_ISSUER}/v1/token`]: { provider: 'okta', app: OKTA },
  };
  const endpoint = tokenEndpoints[url];
  if (endpoint) {
    const form = new URLSearchParams(String(init?.body ?? ''));
    const record = issued.get(form.get('code') ?? '');
    if (!record || record.provider !== endpoint.provider) return json({ error: 'bad_verification_code' });
    if (form.get('client_id') !== endpoint.app.clientId || form.get('client_secret') !== endpoint.app.clientSecret) {
      return json({ error: 'invalid_client' }, 401);
    }
    if (form.get('redirect_uri') !== record.redirectUri) return json({ error: 'redirect_uri_mismatch' }, 400);
    const verifier = form.get('code_verifier') ?? '';
    if (createHash('sha256').update(verifier).digest('base64url') !== record.challenge) {
      return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }
    // Single use, exactly as a real one is.
    issued.delete(form.get('code') ?? '');
    return json({ access_token: `at_${record.provider}_${record.person.subject}`, token_type: 'bearer' });
  }

  // ---- the identity endpoints -------------------------------------------
  const bearer = headers.get('authorization') ?? '';
  const person = [...seen.values()].find((candidate) => bearer.endsWith(`_${candidate.subject}`));

  if (url === 'https://api.github.com/user') {
    if (!person) return json({ message: 'Bad credentials' }, 401);
    return json({
      id: Number(person.subject),
      login: person.handle ?? 'someone',
      ...(person.profileEmail ? { email: person.profileEmail } : {}),
    });
  }
  if (url === 'https://api.github.com/user/emails') {
    if (!person) return json({ message: 'Bad credentials' }, 401);
    return json([
      { email: person.email, primary: true, verified: person.verified },
      ...(person.others ?? []).map((other) => ({ email: other.email, primary: false, verified: other.verified })),
    ]);
  }
  if (url === 'https://openidconnect.googleapis.com/v1/userinfo' || url === `${OKTA_ISSUER}/v1/userinfo`) {
    if (!person) return json({ error: 'invalid_token' }, 401);
    return json({
      sub: person.subject,
      email: person.email,
      email_verified: person.verified,
      ...(person.handle ? { preferred_username: person.handle } : {}),
    });
  }

  throw new Error(`the fake provider was asked for ${url}`);
};

/** Everyone the fake knows about, so a bearer token can be traced to a person. */
const seen = new Map<string, Person>();

const keys = generateKeyPairSync('ed25519');
let site: Awaited<ReturnType<typeof startSite>>;
let base: string;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  site = await startSite({
    port,
    databasePath: ':memory:',
    signingKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    oauth: { publicUrl: base, github: GITHUB, google: GOOGLE, fetch: fakeFetch },
    sendEmail: async () => {},
  });
});

afterAll(() => site.close());
beforeEach(() => {
  issued.clear();
  calls.length = 0;
});

const post = async (path: string, body: unknown = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, never> };
};

/** Asks for a device code, the way the app does on launch. */
async function beginGrant(deviceId: string, options: { emailHint?: string; name?: string } = {}) {
  const started = await post('/api/device/code', {
    device_id: deviceId,
    device_name: options.name ?? 'A machine',
    platform: 'darwin',
    app_version: '0.1.0',
    ...(options.emailHint ? { login_hint: options.emailHint } : {}),
  });
  return {
    userCode: String(started.body['user_code']),
    deviceCode: String(started.body['device_code']),
    providers: started.body['providers'] as unknown as { available: string[]; enforced: string | null; startUri: string },
  };
}

/** The browser half: follow the start, land on the callback, read the page. */
async function browserTrip(input: {
  provider: 'github' | 'google' | 'okta';
  userCode: string;
  person: Person;
  query?: Record<string, string>;
  /** Hand the callback a different state, to test replay and swapping. */
  overrideState?: string;
}) {
  seen.set(input.person.subject, input.person);
  const search = new URLSearchParams({ user_code: input.userCode, ...(input.query ?? {}) });
  const start = await fetch(`${base}/api/auth/oauth/${input.provider}/start?${search}`, { redirect: 'manual' });
  if (start.status !== 302) return { start, callback: null, authorize: null };

  const authorize = new URL(start.headers.get('location') ?? '');
  const state = authorize.searchParams.get('state') ?? '';
  const code = `code_${Math.random().toString(36).slice(2)}`;
  issued.set(code, {
    provider: input.provider,
    person: input.person,
    challenge: authorize.searchParams.get('code_challenge') ?? '',
    redirectUri: authorize.searchParams.get('redirect_uri') ?? '',
  });

  const callback = await fetch(
    `${base}/api/auth/oauth/${input.provider}/callback?code=${code}&state=${encodeURIComponent(input.overrideState ?? state)}`,
  );
  return { start, callback, authorize, state, code };
}

describe('signing in with a browser provider', () => {
  it('takes someone to GitHub with PKCE and the scopes it needs, and nothing more', async () => {
    const grant = await beginGrant('device-gh-1');
    const trip = await browserTrip({
      provider: 'github',
      userCode: grant.userCode,
      person: { subject: '4001', email: 'dev@example.com', verified: true, handle: 'devgh' },
    });

    const authorize = trip.authorize!;
    expect(authorize.origin + authorize.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(authorize.searchParams.get('client_id')).toBe(GITHUB.clientId);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${base}/api/auth/oauth/github/callback`);
    // No repository access, ever.
    expect(authorize.searchParams.get('scope')).toBe('read:user user:email');

    expect(trip.callback!.status).toBe(200);
    await expect(trip.callback!.text()).resolves.toContain('dev@example.com');

    const tokens = await post('/api/device/token', { device_code: grant.deviceCode });
    expect(tokens.status).toBe(200);
    expect(tokens.body['email']).toBe('dev@example.com');
    expect((tokens.body['identity'] as unknown as { provider: string }).provider).toBe('github');
  });

  it('reads the verified address from GitHub rather than the one on the profile', async () => {
    const grant = await beginGrant('device-gh-2');
    await browserTrip({
      provider: 'github',
      userCode: grant.userCode,
      // The profile claims to be the founder. The verified address is not.
      person: { subject: '4002', email: 'real@example.com', verified: true, handle: 'liar', profileEmail: 'aman@mjolnir.sh' },
    });

    const tokens = await post('/api/device/token', { device_code: grant.deviceCode });
    expect(tokens.body['email']).toBe('real@example.com');
    expect(calls).toContain('https://api.github.com/user/emails');
  });

  it('falls back to another confirmed address when the primary one is not', async () => {
    const grant = await beginGrant('device-gh-3');
    await browserTrip({
      provider: 'github',
      userCode: grant.userCode,
      person: {
        subject: '4003',
        email: 'unconfirmed@example.com',
        verified: false,
        others: [{ email: 'confirmed@example.com', verified: true }],
      },
    });
    const tokens = await post('/api/device/token', { device_code: grant.deviceCode });
    expect(tokens.body['email']).toBe('confirmed@example.com');
  });

  it('refuses a sign-in where nothing is confirmed, and leaves the grant pending', async () => {
    const grant = await beginGrant('device-gh-4');
    const trip = await browserTrip({
      provider: 'github',
      userCode: grant.userCode,
      person: { subject: '4004', email: 'nobody@example.com', verified: false },
    });

    expect(trip.callback!.status).toBe(403);
    await expect(trip.callback!.text()).resolves.toContain('not confirmed');

    const tokens = await post('/api/device/token', { device_code: grant.deviceCode });
    expect(tokens.body['error']).toBe('authorization_pending');
  });

  it('never lets an unconfirmed address reach an account that already exists', async () => {
    // Someone signs in properly first.
    const first = await beginGrant('device-victim');
    await browserTrip({
      provider: 'github',
      userCode: first.userCode,
      person: { subject: '5001', email: 'owner@example.com', verified: true },
    });
    const owner = await post('/api/device/token', { device_code: first.deviceCode });
    expect(owner.body['email']).toBe('owner@example.com');

    // An attacker points a different Google account at the same address.
    const second = await beginGrant('device-attacker');
    const trip = await browserTrip({
      provider: 'google',
      userCode: second.userCode,
      person: { subject: '5002', email: 'owner@example.com', verified: false },
    });
    expect(trip.callback!.status).toBe(403);

    const denied = await post('/api/device/token', { device_code: second.deviceCode });
    expect(denied.body['error']).toBe('authorization_pending');
  });

  it('gives one person with two providers one account', async () => {
    const viaGithub = await beginGrant('device-both-1');
    await browserTrip({
      provider: 'github',
      userCode: viaGithub.userCode,
      person: { subject: '6001', email: 'same@example.com', verified: true },
    });
    const one = await post('/api/device/token', { device_code: viaGithub.deviceCode });

    const viaGoogle = await beginGrant('device-both-2');
    await browserTrip({
      provider: 'google',
      userCode: viaGoogle.userCode,
      person: { subject: '6002', email: 'same@example.com', verified: true },
    });
    const two = await post('/api/device/token', { device_code: viaGoogle.deviceCode });

    expect(one.body['email']).toBe(two.body['email']);
    const account = site.store.accountByEmail('same@example.com');
    expect(account).not.toBeNull();
    expect(site.store.identitiesFor(account!.id).map((identity) => identity.provider).sort()).toEqual(['github', 'google']);
  });

  it('follows the person when their email changes, because the subject is what identifies them', async () => {
    const before = await beginGrant('device-moved-1');
    await browserTrip({
      provider: 'github',
      userCode: before.userCode,
      person: { subject: '7001', email: 'old@example.com', verified: true },
    });
    const first = await post('/api/device/token', { device_code: before.deviceCode });
    const accountId = site.store.accountByEmail('old@example.com')?.id;

    const after = await beginGrant('device-moved-2');
    await browserTrip({
      provider: 'github',
      userCode: after.userCode,
      person: { subject: '7001', email: 'new@example.com', verified: true },
    });
    const second = await post('/api/device/token', { device_code: after.deviceCode });

    // Same account, and it keeps the address it was created with rather than
    // silently moving to one someone else may later be given.
    expect(second.body['email']).toBe(first.body['email']);
    expect(site.store.identityFor('github', '7001')?.accountId).toBe(accountId);
    expect(site.store.identityFor('github', '7001')?.email).toBe('new@example.com');
  });
});

describe('the things that make it safe', () => {
  it('spends a state once, so a replayed callback approves nothing', async () => {
    const grant = await beginGrant('device-replay');
    const trip = await browserTrip({
      provider: 'github',
      userCode: grant.userCode,
      person: { subject: '8001', email: 'replay@example.com', verified: true },
    });
    expect(trip.callback!.status).toBe(200);

    const again = await fetch(`${base}/api/auth/oauth/github/callback?code=${trip.code}&state=${trip.state}`);
    expect(again.status).toBe(400);
    await expect(again.text()).resolves.toContain('expired');
  });

  it('will not let a state made for one provider be spent at another', async () => {
    const grant = await beginGrant('device-swap');
    const search = new URLSearchParams({ user_code: grant.userCode });
    const start = await fetch(`${base}/api/auth/oauth/github/start?${search}`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';

    const crossed = await fetch(`${base}/api/auth/oauth/google/callback?code=anything&state=${encodeURIComponent(state)}`);
    expect(crossed.status).toBe(400);
  });

  it('refuses a callback whose code does not survive PKCE', async () => {
    const grant = await beginGrant('device-pkce');
    const search = new URLSearchParams({ user_code: grant.userCode });
    const start = await fetch(`${base}/api/auth/oauth/github/start?${search}`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';

    // A code obtained against somebody else's challenge, which is what a
    // stolen or injected code looks like.
    seen.set('9001', { subject: '9001', email: 'pkce@example.com', verified: true });
    issued.set('stolen', {
      provider: 'github',
      person: { subject: '9001', email: 'pkce@example.com', verified: true },
      challenge: createHash('sha256').update('not-our-verifier').digest('base64url'),
      redirectUri: `${base}/api/auth/oauth/github/callback`,
    });

    const callback = await fetch(`${base}/api/auth/oauth/github/callback?code=stolen&state=${encodeURIComponent(state)}`);
    expect(callback.status).toBe(400);
    const pending = await post('/api/device/token', { device_code: grant.deviceCode });
    expect(pending.body['error']).toBe('authorization_pending');
  });

  it('will not start a sign-in for a code nobody is waiting on', async () => {
    const start = await fetch(`${base}/api/auth/oauth/github/start?user_code=NOPE-NOPE`, { redirect: 'manual' });
    expect(start.status).toBe(404);
  });

  it('says so when someone cancels at the provider, rather than failing silently', async () => {
    const callback = await fetch(`${base}/api/auth/oauth/github/callback?error=access_denied&error_description=The+user+cancelled`);
    expect(callback.status).toBe(400);
    await expect(callback.text()).resolves.toContain('cancelled');
  });

  it('offers only the providers this deployment is configured for', async () => {
    const response = await fetch(`${base}/api/auth/providers`);
    const body = (await response.json()) as { available: string[] };
    expect(body.available).toEqual(['email', 'github', 'google']);

    const grant = await beginGrant('device-offer');
    expect(grant.providers.available).toEqual(['email', 'github', 'google']);
    expect(grant.providers.startUri).toContain(`${base}/api/auth/oauth/{provider}/start?user_code=`);
  });
});

describe('an organisation that runs its own sign-in', () => {
  beforeAll(() => {
    site.store.raw.exec(`
      insert into organisations (id, name, sso_issuer, sso_client_id, sso_client_secret, enforce_sso)
        values ('org_acme', 'Acme', '${OKTA_ISSUER}', '${OKTA.clientId}', '${OKTA.clientSecret}', 1);
      insert into domains (domain, organisation_id, verified_at, verification_token)
        values ('acme.test', 'org_acme', '2026-01-01T00:00:00.000Z', 'tok');
    `);
  });

  it('discovers the tenant endpoints rather than guessing them', async () => {
    const grant = await beginGrant('device-okta-1', { emailHint: 'staff@acme.test' });
    const trip = await browserTrip({
      provider: 'okta',
      userCode: grant.userCode,
      person: { subject: 'okta|1', email: 'staff@acme.test', verified: true, handle: 'staff' },
    });

    expect(calls).toContain(`${OKTA_ISSUER}/.well-known/openid-configuration`);
    expect(trip.authorize!.origin + trip.authorize!.pathname).toBe(`${OKTA_ISSUER}/v1/authorize`);
    expect(trip.callback!.status).toBe(200);

    const tokens = await post('/api/device/token', { device_code: grant.deviceCode });
    expect(tokens.body['email']).toBe('staff@acme.test');
    expect((tokens.body['identity'] as unknown as { provider: string }).provider).toBe('okta');
  });

  it('offers exactly one way in to a domain that enforces it', async () => {
    const grant = await beginGrant('device-okta-2', { emailHint: 'someone@acme.test' });
    expect(grant.providers.available).toEqual(['okta']);
    expect(grant.providers.enforced).toBe('okta');
  });

  it('turns a staff member away from GitHub before the round trip, not after', async () => {
    const grant = await beginGrant('device-okta-3', { emailHint: 'someone@acme.test' });
    const start = await fetch(`${base}/api/auth/oauth/github/start?user_code=${grant.userCode}`, { redirect: 'manual' });
    expect(start.status).toBe(409);
    await expect(start.text()).resolves.toContain('Acme');
  });

  it('will not let a tenant vouch for a domain it has not proved it owns', async () => {
    const grant = await beginGrant('device-okta-4', { emailHint: 'staff@acme.test' });
    const trip = await browserTrip({
      provider: 'okta',
      userCode: grant.userCode,
      // Acme's own identity provider, asserting somebody at another company.
      person: { subject: 'okta|evil', email: 'cfo@othercompany.test', verified: true },
    });

    expect(trip.callback!.status).toBe(403);
    await expect(trip.callback!.text()).resolves.toContain('not verified the domain');
    const pending = await post('/api/device/token', { device_code: grant.deviceCode });
    expect(pending.body['error']).toBe('authorization_pending');
  });

  it('asks which company rather than guessing when there is no hint', async () => {
    const grant = await beginGrant('device-okta-5');
    const start = await fetch(`${base}/api/auth/oauth/okta/start?user_code=${grant.userCode}`, { redirect: 'manual' });
    expect(start.status).toBe(400);
    await expect(start.text()).resolves.toContain('work address');
  });
});
