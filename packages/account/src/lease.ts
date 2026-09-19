import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { z } from 'zod';
import { LicenseClaimsSchema, type LicenseClaims, type Tier } from '@mjolnir/licensing';
import { logger } from '@mjolnir/logger';

const log = logger.child('lease');

/**
 * A licence, issued to one machine, for about a week.
 *
 * A licence key on its own cannot be taken back. Cancel a subscription and the
 * signed key keeps working until the date inside it; refund a lifetime
 * purchase and it works forever. A lease fixes that without giving up offline
 * operation: it is the same signed claims with three additions, and the app
 * renews it while it can.
 *
 *   deviceId   the machine it was issued to, so a copied lease is useless
 *   notAfter   a week out, so cancelling takes effect within a week
 *   nonce      so two leases for the same device are distinguishable in a log
 *
 * Verification is entirely local, against the public key inside the build.
 * Being offline is not a reason to lose access; being offline for longer than
 * the lease plus its grace period is.
 */
export const LeaseSchema = z.object({
  claims: LicenseClaimsSchema,
  /** Stable per installation; a lease copied to another machine will not verify. */
  deviceId: z.string().min(8),
  /** Seconds since epoch. The app renews well before this. */
  notAfter: z.number().int().positive(),
  /** Seconds since epoch, when the server issued it. */
  issuedAt: z.number().int().nonnegative(),
  nonce: z.string().min(8),
  /** Seats the subscription has, and how many are in use, for the settings page. */
  seats: z.object({ total: z.number().int().nonnegative(), used: z.number().int().nonnegative() }).optional(),
});

export type Lease = z.infer<typeof LeaseSchema>;

/** How long Pro survives past a lease's expiry with no successful renewal. */
export const LEASE_GRACE_DAYS = 30;
/** Renew once the lease is this close to expiring, so a bad week is survivable. */
export const RENEW_WHEN_REMAINING_HOURS = 48;
const SECONDS_PER_DAY = 86_400;

export type LeaseStatus =
  | { readonly kind: 'none'; readonly tier: 'free' }
  | { readonly kind: 'invalid'; readonly tier: 'free'; readonly reason: string }
  /** Issued to a different machine: almost always a copied `~/.mjolnir`. */
  | { readonly kind: 'wrong-device'; readonly tier: 'free'; readonly reason: string }
  | { readonly kind: 'valid'; readonly tier: 'pro'; readonly lease: Lease }
  /** Past `notAfter`, inside the grace window, still Pro, but say so. */
  | { readonly kind: 'grace'; readonly tier: 'pro'; readonly lease: Lease; readonly graceEndsAt: Date }
  | { readonly kind: 'expired'; readonly tier: 'free'; readonly lease: Lease };

export interface VerifyLeaseOptions {
  /** Ed25519 public key, SPKI PEM. The same one that verifies licence keys. */
  readonly publicKeyPem: string;
  /** This machine. A lease for another one is not ours to use. */
  readonly deviceId: string;
  readonly now?: Date;
}

/**
 * A signed lease is `<base64url(json)>.<base64url(ed25519 signature)>`.
 *
 * The same envelope as a licence key on purpose: one parser, one signature
 * scheme, one public key, and no second format to get subtly wrong.
 */
export function parseSigned(token: string): { payload: Buffer; signature: Buffer } | null {
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;
  try {
    return { payload: Buffer.from(body, 'base64url'), signature: Buffer.from(signature, 'base64url') };
  } catch {
    return null;
  }
}

/**
 * Check a lease and decide what it grants. Never throws.
 *
 * A bug in here must not be able to lock someone out of their own clusters, so
 * every failure path returns the free tier and a reason rather than raising.
 */
export function verifyLease(token: string, options: VerifyLeaseOptions): LeaseStatus {
  if (token.trim() === '') return { kind: 'none', tier: 'free' };

  const parsed = parseSigned(token);
  if (!parsed) return { kind: 'invalid', tier: 'free', reason: 'malformed lease' };

  let signatureValid: boolean;
  try {
    signatureValid = verifySignature(null, parsed.payload, createPublicKey(options.publicKeyPem), parsed.signature);
  } catch (error) {
    log.warn('lease signature check could not run', { error: error instanceof Error ? error.message : String(error) });
    return { kind: 'invalid', tier: 'free', reason: 'signature could not be checked' };
  }
  if (!signatureValid) return { kind: 'invalid', tier: 'free', reason: 'signature does not match' };

  let lease: Lease;
  try {
    const decoded: unknown = JSON.parse(parsed.payload.toString('utf8'));
    const result = LeaseSchema.safeParse(decoded);
    if (!result.success) return { kind: 'invalid', tier: 'free', reason: 'lease did not validate' };
    lease = result.data;
  } catch {
    return { kind: 'invalid', tier: 'free', reason: 'lease was not JSON' };
  }

  // Checked before the dates: a lease from another machine is not expired, it
  // is not ours, and the settings page should say which of those it is.
  if (lease.deviceId !== options.deviceId) {
    return { kind: 'wrong-device', tier: 'free', reason: 'this lease was issued to another machine' };
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (nowSeconds <= lease.notAfter) return { kind: 'valid', tier: 'pro', lease };

  const graceEnds = lease.notAfter + LEASE_GRACE_DAYS * SECONDS_PER_DAY;
  if (nowSeconds <= graceEnds) {
    return { kind: 'grace', tier: 'pro', lease, graceEndsAt: new Date(graceEnds * 1000) };
  }
  return { kind: 'expired', tier: 'free', lease };
}

/** Whether it is time to ask the server for a fresh one. */
export function shouldRenew(status: LeaseStatus, now = new Date()): boolean {
  if (status.kind === 'none' || status.kind === 'invalid' || status.kind === 'wrong-device') return true;
  const remaining = status.lease.notAfter - Math.floor(now.getTime() / 1000);
  return remaining <= RENEW_WHEN_REMAINING_HOURS * 3600;
}

/** The tier, and one sentence a person can act on. Used by the settings page. */
export function describeLease(status: LeaseStatus): { tier: Tier; headline: string; detail?: string } {
  switch (status.kind) {
    case 'none':
      return { tier: 'free', headline: 'Not signed in', detail: 'Mjolnir is fully usable on the free tier. Sign in to use your subscription.' };
    case 'invalid':
      return { tier: 'free', headline: 'The stored licence could not be read', detail: `${status.reason}. Signing in again will replace it.` };
    case 'wrong-device':
      return { tier: 'free', headline: 'This licence belongs to another machine', detail: 'It was probably copied along with a home directory. Sign in to get one for this machine.' };
    case 'valid': {
      // No detail. The email is already beside the headline, and repeating it
      // underneath is a sentence that says nothing twice.
      const claims: LicenseClaims = status.lease.claims;
      return { tier: 'pro', headline: `Pro, ${claims.plan}` };
    }
    case 'grace':
      return {
        tier: 'pro',
        headline: 'Pro, working offline',
        detail: `Mjolnir has not been able to reach the licence server. Pro continues until ${status.graceEndsAt.toDateString()}.`,
      };
    case 'expired':
      return { tier: 'free', headline: 'Pro has lapsed', detail: 'The licence expired and could not be renewed. Everything on the free tier still works.' };
  }
}
