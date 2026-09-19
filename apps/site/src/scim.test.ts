import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { verifyLease } from '@mjolnir/account';
import { startSite } from './main.ts';
import { hashToken, newId } from './signing.ts';

/**
 * Deprovisioning, which is the half of SCIM that anybody is buying.
 *
 * Provisioning failing is a support ticket. Deprovisioning failing is a
 * finding in an audit: someone removed in Okta three weeks ago still holding
 * a licence. So the assertions here are mostly about what stops working, and
 * how fast.
 */

const keys = generateKeyPairSync('ed25519');
const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

let site: Awaited<ReturnType<typeof startSite>>;
let base: string;
const TOKEN = 'scim_test_token';
const WRONG = 'scim_not_the_token';

beforeAll(async () => {
  site = await startSite({ port: 0, databasePath: ':memory:', signingKeyPem: privateKeyPem, sendEmail: async () => {} });
  base = `http://127.0.0.1:${site.port}`;
  site.store.raw.exec(`
    insert into organisations (id, name, enforce_sso) values ('org_acme', 'Acme', 1);
    insert into domains (domain, organisation_id, verified_at, verification_token)
      values ('acme.test', 'org_acme', '2026-01-01T00:00:00.000Z', 'tok');
  `);
  site.store.setScimToken('org_acme', hashToken(TOKEN));
});

afterAll(() => site.close());

const scim = async (
  method: string,
  path: string,
  body?: unknown,
  token: string = TOKEN,
): Promise<{ status: number; body: Record<string, never> }> => {
  const response = await fetch(`${base}/scim/v2${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/scim+json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, never> };
};

const post = async (path: string, body: unknown = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, never> };
};

/** Puts a machine on an account with a live lease, which is what holds a seat. */
async function machineWithLease(accountId: string, deviceId: string): Promise<string> {
  const token = `mjr_${deviceId}`;
  site.store.saveDevice({
    id: deviceId,
    accountId,
    name: deviceId,
    platform: 'darwin',
    appVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    refreshTokenHash: hashToken(token),
    revokedAt: null,
  });
  const lease = await post('/api/licence/lease', { refresh_token: token, device_name: deviceId, platform: 'darwin', app_version: '0.1.0' });
  expect(lease.status).toBe(200);
  return token;
}

function giveSubscription(accountId: string, seats = 5) {
  site.store.saveSubscription({
    id: newId('sub'),
    accountId,
    plan: 'monthly',
    status: 'active',
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 86_400,
    updatesUntil: Math.floor(Date.now() / 1000) + 365 * 86_400,
    seats,
    paddleSubscriptionId: null,
  });
}

describe('the directory owns who has a seat', () => {
  it('turns away a request with no token, or the wrong one', async () => {
    expect((await scim('GET', '/Users', undefined, WRONG)).status).toBe(401);
    const anonymous = await fetch(`${base}/scim/v2/Users`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('answers the three things Okta reads before it will set anything up', async () => {
    const config = await fetch(`${base}/scim/v2/ServiceProviderConfig`);
    expect(config.status).toBe(200);
    expect(config.headers.get('content-type')).toContain('application/scim+json');
    expect(((await config.json()) as { patch: { supported: boolean } }).patch.supported).toBe(true);

    expect((await fetch(`${base}/scim/v2/ResourceTypes`)).status).toBe(200);
    expect((await fetch(`${base}/scim/v2/Schemas`)).status).toBe(200);
  });

  it('provisions a person, and makes the account before they have ever signed in', async () => {
    const created = await scim('POST', '/Users', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'new.starter@acme.test',
      externalId: '00u123',
      name: { givenName: 'New', familyName: 'Starter' },
      active: true,
    });

    expect(created.status).toBe(201);
    expect(created.body['userName']).toBe('new.starter@acme.test');
    expect(created.body['displayName']).toBe('New Starter');
    expect(site.store.accountByEmail('new.starter@acme.test')).not.toBeNull();
  });

  it('refuses to provision an address on a domain the organisation has not proved it owns', async () => {
    const created = await scim('POST', '/Users', { userName: 'someone@othercompany.test' });
    expect(created.status).toBe(400);
    expect(created.body['detail']).toContain('has not verified the domain');
    expect(site.store.accountByEmail('someone@othercompany.test')).toBeNull();
  });

  it('says uniqueness rather than looping when a person is provisioned twice', async () => {
    await scim('POST', '/Users', { userName: 'twice@acme.test' });
    const again = await scim('POST', '/Users', { userName: 'twice@acme.test' });
    expect(again.status).toBe(409);
    expect(again.body['scimType']).toBe('uniqueness');
  });

  it('finds a person by the one filter every directory sends', async () => {
    await scim('POST', '/Users', { userName: 'findable@acme.test', externalId: '00u999' });
    const byName = await scim('GET', `/Users?filter=${encodeURIComponent('userName eq "findable@acme.test"')}`);
    expect(byName.body['totalResults']).toBe(1);

    const byExternal = await scim('GET', `/Users?filter=${encodeURIComponent('externalId eq "00u999"')}`);
    expect(byExternal.body['totalResults']).toBe(1);

    const missing = await scim('GET', `/Users?filter=${encodeURIComponent('userName eq "nobody@acme.test"')}`);
    expect(missing.body['totalResults']).toBe(0);
    expect(missing.body['Resources']).toEqual([]);
  });

  it('says so plainly when asked for a filter it cannot answer', async () => {
    const response = await scim('GET', `/Users?filter=${encodeURIComponent('userName sw "a"')}`);
    expect(response.status).toBe(400);
    expect(response.body['scimType']).toBe('invalidFilter');
  });

  it('counts pages from one, so nobody is silently missing from the directory', async () => {
    const first = await scim('GET', '/Users?startIndex=1&count=1');
    const second = await scim('GET', '/Users?startIndex=2&count=1');
    expect(first.body['Resources']).toHaveLength(1);
    expect(second.body['Resources']).toHaveLength(1);
    expect((first.body['Resources'] as unknown as Array<{ id: string }>)[0]?.id).not.toBe(
      (second.body['Resources'] as unknown as Array<{ id: string }>)[0]?.id,
    );
  });
});

describe('deprovisioning', () => {
  it('frees the seat the same second, both spellings of the patch', async () => {
    for (const [index, operation] of [
      // With a path, and without. Okta sends both, and a server that handles
      // only one looks fine until somebody is offboarded.
      { op: 'replace', path: 'active', value: false },
      { op: 'replace', value: { active: false } },
    ].entries()) {
      const email = `leaver${index}@acme.test`;
      const created = await scim('POST', '/Users', { userName: email });
      const account = site.store.accountByEmail(email)!;
      giveSubscription(account.id);
      await machineWithLease(account.id, `laptop-${index}`);
      expect(site.store.activeDevices(account.id)).toHaveLength(1);

      const patched = await scim('PATCH', `/Users/${created.body['id']}`, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [operation],
      });

      expect(patched.status).toBe(200);
      expect(patched.body['active']).toBe(false);
      // Not "in a week", not "when the lease lapses". Now.
      expect(site.store.activeDevices(account.id)).toHaveLength(0);
    }
  });

  it('will not issue another lease to someone the directory removed', async () => {
    const email = 'removed@acme.test';
    const created = await scim('POST', '/Users', { userName: email });
    const account = site.store.accountByEmail(email)!;
    giveSubscription(account.id);
    const token = await machineWithLease(account.id, 'removed-laptop');

    await scim('PATCH', `/Users/${created.body['id']}`, { Operations: [{ op: 'replace', value: { active: false } }] });

    // The device is signed out, so it cannot even ask.
    const afterRevoke = await post('/api/licence/lease', { refresh_token: token, device_name: 'x', platform: 'darwin', app_version: '0.1.0' });
    expect(afterRevoke.status).toBe(401);

    // And signing in again does not get them back, which is the whole point:
    // deprovisioning that a person can undo by signing in is not
    // deprovisioning.
    site.store.saveDevice({
      id: 'removed-laptop-2',
      accountId: account.id,
      name: 'again',
      platform: 'darwin',
      appVersion: '0.1.0',
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      refreshTokenHash: hashToken('mjr_again'),
      revokedAt: null,
    });
    const retry = await post('/api/licence/lease', { refresh_token: 'mjr_again', device_name: 'x', platform: 'darwin', app_version: '0.1.0' });
    expect(retry.status).toBe(403);
    expect(retry.body['error']).toBe('deprovisioned');
    expect(String(retry.body['description'])).toContain('removed your access');
  });

  it('leaves the lease already on the laptop working until it expires, and says why', async () => {
    const email = 'window@acme.test';
    const created = await scim('POST', '/Users', { userName: email });
    const account = site.store.accountByEmail(email)!;
    giveSubscription(account.id);
    const token = `mjr_window`;
    site.store.saveDevice({
      id: 'window-laptop',
      accountId: account.id,
      name: 'window',
      platform: 'darwin',
      appVersion: '0.1.0',
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      refreshTokenHash: hashToken(token),
      revokedAt: null,
    });
    const issued = await post('/api/licence/lease', { refresh_token: token, device_name: 'window', platform: 'darwin', app_version: '0.1.0' });
    const lease = String(issued.body['lease']);

    await scim('PATCH', `/Users/${created.body['id']}`, { Operations: [{ op: 'replace', value: { active: false } }] });

    // Signed, offline-verifiable, and not something we can reach into. The
    // revocation window is real and it is a week: that is why LEASE_DAYS is 7
    // and not 30.
    const verified = verifyLease(lease, { publicKeyPem, deviceId: 'window-laptop' });
    expect(verified.kind).toBe('valid');
  });

  it('brings someone back when the directory switches them on again', async () => {
    const email = 'returner@acme.test';
    const created = await scim('POST', '/Users', { userName: email });
    const account = site.store.accountByEmail(email)!;
    giveSubscription(account.id);

    await scim('PATCH', `/Users/${created.body['id']}`, { Operations: [{ op: 'replace', value: { active: false } }] });
    expect(site.store.accountById(account.id)?.suspended).toBe(true);

    const back = await scim('PATCH', `/Users/${created.body['id']}`, { Operations: [{ op: 'replace', path: 'active', value: true }] });
    expect(back.body['active']).toBe(true);
    expect(site.store.accountById(account.id)?.suspended).toBe(false);

    site.store.saveDevice({
      id: 'returner-laptop',
      accountId: account.id,
      name: 'returner',
      platform: 'darwin',
      appVersion: '0.1.0',
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      refreshTokenHash: hashToken('mjr_returner'),
      revokedAt: null,
    });
    const lease = await post('/api/licence/lease', { refresh_token: 'mjr_returner', device_name: 'x', platform: 'darwin', app_version: '0.1.0' });
    expect(lease.status).toBe(200);
  });

  it('frees the seat on a delete too, and keeps the account', async () => {
    const email = 'deleted@acme.test';
    const created = await scim('POST', '/Users', { userName: email });
    const account = site.store.accountByEmail(email)!;
    giveSubscription(account.id);
    await machineWithLease(account.id, 'deleted-laptop');

    const response = await scim('DELETE', `/Users/${created.body['id']}`);
    expect(response.status).toBe(204);
    expect(site.store.activeDevices(account.id)).toHaveLength(0);
    // The person is gone from the directory, not from our records: someone
    // who leaves and comes back should not find their history erased by an
    // offboarding script.
    expect(site.store.accountById(account.id)).not.toBeNull();
    expect(site.store.accountById(account.id)?.suspended).toBe(true);
    expect((await scim('GET', `/Users/${created.body['id']}`)).status).toBe(404);
  });

  it('refuses the operations it does not implement rather than pretending', async () => {
    const created = await scim('POST', '/Users', { userName: 'strange@acme.test' });
    const removed = await scim('PATCH', `/Users/${created.body['id']}`, { Operations: [{ op: 'remove', path: 'active' }] });
    expect(removed.status).toBe(400);

    const groups = await scim('GET', '/Groups');
    expect(groups.status).toBe(501);
    expect(String(groups.body['detail'])).toContain('not implemented');
  });

  it('ignores the profile fields it does not store instead of failing the whole offboarding', async () => {
    const created = await scim('POST', '/Users', { userName: 'noisy@acme.test' });
    const patched = await scim('PATCH', `/Users/${created.body['id']}`, {
      Operations: [
        { op: 'replace', value: { active: false, title: 'Head of Somewhere', 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department': 'Ops' } },
      ],
    });
    expect(patched.status).toBe(200);
    expect(patched.body['active']).toBe(false);
  });

  it('keeps one tenant out of the other tenant directory', async () => {
    site.store.raw.exec(`insert into organisations (id, name, enforce_sso) values ('org_other', 'Other', 0)`);
    site.store.setScimToken('org_other', hashToken('scim_other_token'));

    const acme = await scim('POST', '/Users', { userName: 'private@acme.test' });
    const peek = await scim('GET', `/Users/${acme.body['id']}`, undefined, 'scim_other_token');
    expect(peek.status).toBe(404);

    const list = await scim('GET', '/Users', undefined, 'scim_other_token');
    expect(list.body['totalResults']).toBe(0);
  });
});
