import { createPrivateKey, sign as signBytes, createPublicKey, verify as verifySignature } from 'node:crypto';
import { z } from 'zod';
import { logger } from '@mjolnir/logger';
import type { Tier } from './entitlements.ts';

const log = logger.child('licensing');

/**
 * What somebody is on.
 *
 * `trial` is a plan rather than a flag beside one, so every place that asks
 * "what does this person have" gets the same answer in the same shape. A
 * trial that was a boolean on the side would be checked in four places and
 * forgotten in a fifth, and the fifth is the one that decides whether a
 * feature works.
 */
export type Plan = 'trial' | 'monthly' | 'annual';

/**
 * The signed body of a licence key.
 *
 * `updatesUntil` and `expiresAt` are deliberately separate, because the two
 * plans fail differently. A subscription that lapses stops granting Pro. A
 * lifetime licence never stops granting Pro, it stops granting *new versions*.
 * Collapsing them into one field is how perpetual licences accidentally expire.
 */
export const LicenseClaimsSchema = z.object({
  /** Licence id, for support and revocation. */
  jti: z.string().min(1),
  /** Who it was issued to. Shown in the UI so a user can confirm their own key. */
  email: z.string().min(1),
  plan: z.enum(['trial', 'monthly', 'annual']),
  /** Issued-at, seconds since epoch. */
  iat: z.number().int().nonnegative(),
  /**
   * Subscription end, seconds since epoch. Never null: every plan ends, and
   * expire.
   */
  expiresAt: z.number().int().nonnegative().nullable(),
  /**
   * Last instant whose releases this licence covers. For lifetime keys this is
   * the update entitlement; builds published after it still run, at the newest
   * version the licence covers.
   */
  updatesUntil: z.number().int().nonnegative(),
  /** Paddle customer id, for revalidation. */
  customerId: z.string().min(1),
});

export type LicenseClaims = z.infer<typeof LicenseClaimsSchema>;

export type LicenseStatus =
  | { readonly kind: 'none'; readonly tier: 'free' }
  | { readonly kind: 'valid'; readonly tier: 'pro'; readonly claims: LicenseClaims }
  | {
      /** Past its subscription end, still inside the offline grace window. */
      readonly kind: 'grace';
      readonly tier: 'pro';
      readonly claims: LicenseClaims;
      readonly graceEndsAt: Date;
    }
  | { readonly kind: 'expired'; readonly tier: 'free'; readonly claims: LicenseClaims }
  | { readonly kind: 'invalid'; readonly tier: 'free'; readonly reason: string };

export const GRACE_PERIOD_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

/**
 * A licence key is `<base64url(claims)>.<base64url(ed25519 signature)>`.
 *
 * Ed25519 over a detached JSON body rather than a JWT: no algorithm field means
 * no algorithm-confusion attack, and no library that might honour `alg: none`.
 * The app ships only the public key, so a leaked build cannot mint licences.
 */
export function parseLicenseKey(key: string): { payload: Buffer; signature: Buffer } | null {
  const parts = key.trim().split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;
  try {
    return {
      payload: Buffer.from(body, 'base64url'),
      signature: Buffer.from(signature, 'base64url'),
    };
  } catch {
    return null;
  }
}

export interface VerifyOptions {
  /** Ed25519 public key, SPKI PEM. Embedded in the app at build time. */
  readonly publicKeyPem: string;
  /** Overridable for testing; defaults to now. */
  readonly now?: Date;
}

/**
 * Verify a licence key and decide what it entitles the holder to.
 *
 * Never throws. A malformed or forged key yields `invalid` and the free tier,
 * because a licensing bug must never be able to stop someone using the app.
 */
export function verifyLicense(key: string, options: VerifyOptions): LicenseStatus {
  if (key.trim() === '') return { kind: 'none', tier: 'free' };

  const parsed = parseLicenseKey(key);
  if (!parsed) return { kind: 'invalid', tier: 'free', reason: 'malformed key' };

  let signatureValid: boolean;
  try {
    const publicKey = createPublicKey(options.publicKeyPem);
    signatureValid = verifySignature(null, parsed.payload, publicKey, parsed.signature);
  } catch (error) {
    log.warn('licence signature check failed to run', { error });
    return { kind: 'invalid', tier: 'free', reason: 'signature could not be checked' };
  }

  if (!signatureValid) return { kind: 'invalid', tier: 'free', reason: 'signature does not match' };

  let claims: LicenseClaims;
  try {
    const decoded: unknown = JSON.parse(parsed.payload.toString('utf8'));
    const result = LicenseClaimsSchema.safeParse(decoded);
    if (!result.success) {
      return { kind: 'invalid', tier: 'free', reason: 'claims did not validate' };
    }
    claims = result.data;
  } catch {
    return { kind: 'invalid', tier: 'free', reason: 'claims were not JSON' };
  }

  const now = options.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);

  /*
   * Every licence has an end date now that lifetime is gone.
   *
   * A missing one used to mean "forever", which was right when a perpetual
   * plan existed and is a hole without one: an absent field is exactly what a
   * malformed or truncated payload looks like, and reading it as unlimited
   * entitlement is the wrong way round. The signature already stops a forged
   * claim, and this stops a broken one being read generously.
   */
  if (claims.expiresAt === null) {
    return { kind: 'invalid', tier: 'free', reason: 'no end date on the licence' };
  }

  if (nowSeconds <= claims.expiresAt) {
    return { kind: 'valid', tier: 'pro', claims };
  }

  const graceEnds = claims.expiresAt + GRACE_PERIOD_DAYS * SECONDS_PER_DAY;
  if (nowSeconds <= graceEnds) {
    return {
      kind: 'grace',
      tier: 'pro',
      claims,
      graceEndsAt: new Date(graceEnds * 1000),
    };
  }

  return { kind: 'expired', tier: 'free', claims };
}

/**
 * Whether a build is covered by a licence.
 *
 * Kept separate from the entitlement because the two lapse for different
 * reasons: a subscription that ends stops granting Pro, and a licence that is
 * still inside its grace period should not be offered a build published after
 * it lapsed. The updater reads this, not the entitlement.
 */
export function coversRelease(claims: LicenseClaims, releasedAt: Date): boolean {
  return Math.floor(releasedAt.getTime() / 1000) <= claims.updatesUntil;
}

export function tierOf(status: LicenseStatus): Tier {
  return status.tier;
}

/**
 * Issues a key: `<base64url(claims)>.<base64url(ed25519 signature)>`. Used by
 * the licence service and by the owner's grant CLI, never by the app.
 */
export function signLicense(claims: LicenseClaims, privateKeyPem: string): string {
  const payload = Buffer.from(JSON.stringify(LicenseClaimsSchema.parse(claims)));
  const signature = signBytes(null, payload, createPrivateKey(privateKeyPem));
  return `${payload.toString('base64url')}.${signature.toString('base64url')}`;
}
