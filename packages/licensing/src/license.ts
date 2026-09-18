import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { z } from 'zod';
import { logger } from '@odin/logger';
import type { Tier } from './entitlements.ts';

const log = logger.child('licensing');

export type Plan = 'monthly' | 'annual' | 'lifetime';

/**
 * The signed body of a licence key.
 *
 * `updatesUntil` and `expiresAt` are deliberately separate, because the two
 * plans fail differently. A subscription that lapses stops granting Pro. A
 * lifetime licence never stops granting Pro — it stops granting *new versions*.
 * Collapsing them into one field is how perpetual licences accidentally expire.
 */
export const LicenseClaimsSchema = z.object({
  /** Licence id, for support and revocation. */
  jti: z.string().min(1),
  /** Who it was issued to. Shown in the UI so a user can confirm their own key. */
  email: z.string().min(1),
  plan: z.enum(['monthly', 'annual', 'lifetime']),
  /** Issued-at, seconds since epoch. */
  iat: z.number().int().nonnegative(),
  /**
   * Subscription end, seconds since epoch. Null for lifetime, which does not
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

  // A lifetime licence never expires. Its updatesUntil governs which builds it
  // covers, which is an updater concern, not an entitlement one.
  if (claims.plan === 'lifetime' || claims.expiresAt === null) {
    return { kind: 'valid', tier: 'pro', claims };
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
 * Only meaningful for lifetime keys: the app keeps working forever, but a
 * release published after the update entitlement lapsed is not included. The
 * updater uses this to stop offering builds the user has not paid for, rather
 * than to stop the app running.
 */
export function coversRelease(claims: LicenseClaims, releasedAt: Date): boolean {
  return Math.floor(releasedAt.getTime() / 1000) <= claims.updatesUntil;
}

export function tierOf(status: LicenseStatus): Tier {
  return status.tier;
}
