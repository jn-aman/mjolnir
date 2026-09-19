import { generateKeyPairSync, sign as signPayload } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GRACE_PERIOD_DAYS, coversRelease, verifyLicense, type LicenseClaims } from './license.ts';
import { allows } from './entitlements.ts';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const DAY = 86_400;
const NOW = new Date('2026-09-18T12:00:00Z');
const nowSeconds = Math.floor(NOW.getTime() / 1000);

function issue(overrides: Partial<LicenseClaims> = {}, key = privateKey): string {
  const claims: LicenseClaims = {
    jti: 'lic_1',
    email: 'user@example.com',
    plan: 'annual',
    iat: nowSeconds - DAY,
    expiresAt: nowSeconds + 30 * DAY,
    updatesUntil: nowSeconds + 30 * DAY,
    customerId: 'ctm_1',
    ...overrides,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8');
  const signature = signPayload(null, payload, key);
  return `${payload.toString('base64url')}.${signature.toString('base64url')}`;
}

describe('verifyLicense', () => {
  it('accepts a valid subscription and grants pro', () => {
    const status = verifyLicense(issue(), { publicKeyPem, now: NOW });
    expect(status.kind).toBe('valid');
    expect(status.tier).toBe('pro');
  });

  it('treats an empty key as the free tier, not an error', () => {
    const status = verifyLicense('', { publicKeyPem, now: NOW });
    expect(status).toEqual({ kind: 'none', tier: 'free' });
  });

  it('rejects a key signed by the wrong private key', () => {
    const attacker = generateKeyPairSync('ed25519');
    const status = verifyLicense(issue({}, attacker.privateKey), { publicKeyPem, now: NOW });
    expect(status.kind).toBe('invalid');
    expect(status.tier).toBe('free');
  });

  it('rejects a key whose claims were edited after signing', () => {
    const original = issue({ plan: 'monthly', expiresAt: nowSeconds - DAY });
    const [, signature] = original.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        jti: 'lic_1',
        email: 'user@example.com',
        plan: 'lifetime',
        iat: nowSeconds - DAY,
        expiresAt: null,
        updatesUntil: nowSeconds + 3650 * DAY,
        customerId: 'ctm_1',
      }),
      'utf8',
    ).toString('base64url');

    const status = verifyLicense(`${forged}.${signature}`, { publicKeyPem, now: NOW });
    expect(status.kind).toBe('invalid');
  });

  it('rejects malformed keys without throwing', () => {
    for (const key of ['garbage', 'a.b.c', '.', 'only-one-part']) {
      expect(() => verifyLicense(key, { publicKeyPem, now: NOW })).not.toThrow();
      expect(verifyLicense(key, { publicKeyPem, now: NOW }).tier).toBe('free');
    }
  });

  it('keeps pro inside the offline grace window after expiry', () => {
    const key = issue({ expiresAt: nowSeconds - DAY });
    const status = verifyLicense(key, { publicKeyPem, now: NOW });
    expect(status.kind).toBe('grace');
    expect(status.tier).toBe('pro');
  });

  it('falls back to free once the grace window closes', () => {
    const key = issue({ expiresAt: nowSeconds - (GRACE_PERIOD_DAYS + 1) * DAY });
    const status = verifyLicense(key, { publicKeyPem, now: NOW });
    expect(status.kind).toBe('expired');
    expect(status.tier).toBe('free');
  });

  it('keeps a licence valid long past its update entitlement', () => {
    const key = issue({
      plan: 'annual',
      expiresAt: nowSeconds + 30 * DAY,
      updatesUntil: nowSeconds - 3650 * DAY,
    });
    const status = verifyLicense(key, { publicKeyPem, now: NOW });
    // The bug this guards: collapsing "updates ran out" into "licence
    // expired", which takes Pro away from somebody who is still paying.
    expect(status.kind).toBe('valid');
    expect(status.tier).toBe('pro');
  });

  it('refuses a licence with no end date rather than reading it as forever', () => {
    // An absent end date is what a truncated or malformed payload looks like.
    // It used to mean "lifetime", which is the wrong way to fail: the
    // generous reading belongs to the plan, not to a missing field.
    const key = issue({ plan: 'annual', expiresAt: null, updatesUntil: nowSeconds + DAY });
    const status = verifyLicense(key, { publicKeyPem, now: NOW });
    expect(status.kind).toBe('invalid');
    expect(status.tier).toBe('free');
  });
});

describe('coversRelease', () => {
  const claims = {
    jti: 'lic_1',
    email: 'user@example.com',
    plan: 'annual',
    iat: nowSeconds,
    expiresAt: nowSeconds + 365 * DAY,
    updatesUntil: nowSeconds,
    customerId: 'ctm_1',
  } satisfies LicenseClaims;

  it('covers a release published inside the entitlement', () => {
    expect(coversRelease(claims, new Date((nowSeconds - DAY) * 1000))).toBe(true);
  });

  it('excludes a release published after it', () => {
    expect(coversRelease(claims, new Date((nowSeconds + DAY) * 1000))).toBe(false);
  });
});

describe('entitlements', () => {
  it('lets free use the whole single-user client', () => {
    for (const feature of ['logs.stream', 'logs.previous', 'logs.structured', 'terminal', 'resources.edit'] as const) {
      expect(allows('free', feature)).toBe(true);
    }
  });

  it('holds back the multi-account and privileged-action features', () => {
    for (const feature of ['cloud.multiAccount', 'logs.aggregate', 'security.scan', 'argocd.operate'] as const) {
      expect(allows('free', feature)).toBe(false);
      expect(allows('pro', feature)).toBe(true);
    }
  });
});
