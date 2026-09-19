import { createHash, createPrivateKey, randomBytes, randomUUID, sign as signBytes, timingSafeEqual } from 'node:crypto';
import type { Lease } from '@mjolnir/account';
import type { LicenseClaims } from '@mjolnir/licensing';
import { logger } from '@mjolnir/logger';

const log = logger.child('signing');

/**
 * Minting leases, and the tokens that get you one.
 *
 * The signing key exists only here. A build ships the public half, so a
 * leaked app cannot mint anything, and a leaked lease is valid for one device
 * for one week. The key itself is the thing that must never move: everything
 * else in this service can be rebuilt from Paddle and a sign-in, and that key
 * cannot.
 */

export interface Signer {
  signLease(input: { claims: LicenseClaims; deviceId: string; days: number; seats?: { total: number; used: number } }): { token: string; nonce: string; notAfter: number };
  signPerpetual(claims: LicenseClaims): string;
}

export function createSigner(privateKeyPem: string): Signer {
  const key = createPrivateKey(privateKeyPem);

  const envelope = (payload: object): string => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = signBytes(null, body, key);
    return `${body.toString('base64url')}.${signature.toString('base64url')}`;
  };

  return {
    signLease({ claims, deviceId, days, seats }) {
      const issuedAt = Math.floor(Date.now() / 1000);
      const notAfter = issuedAt + days * 86_400;
      const nonce = randomBytes(12).toString('base64url');
      const lease: Lease = { claims, deviceId, notAfter, issuedAt, nonce, ...(seats ? { seats } : {}) };
      return { token: envelope(lease), nonce, notAfter };
    },

    /**
     * A key with no expiry and no device, for someone who bought a lifetime
     * licence.
     *
     * A lifetime purchase that stops working when a server goes away is not a
     * lifetime purchase, so this exists and is offered openly. It is the one
     * artefact here that cannot be taken back, which is exactly what was sold.
     */
    signPerpetual(claims) {
      log.info('perpetual licence minted', { jti: claims.jti });
      return envelope(claims);
    },
  };
}

/**
 * The code a person reads off the screen.
 *
 * Crockford's alphabet minus the letters that are the same shape as digits, so
 * nobody types O for 0 or I for 1 and is told they got it wrong. Two groups of
 * four, because a single run of eight is read back wrong more often than it is
 * read back right.
 *
 * 28 characters over 8 positions is about 37 bits. With a fifteen minute
 * window and rate limiting on the lookup, guessing one is not a route in.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function userCode(): string {
  const bytes = randomBytes(8);
  const letters = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]);
  return `${letters.slice(0, 4).join('')}-${letters.slice(4).join('')}`;
}

/** The secret half, held by the app and never shown to anyone. */
export function deviceCode(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A refresh token, and the hash that is all we keep.
 *
 * Storing the token itself would mean a database leak hands over every
 * account. The hash is plain SHA-256 rather than a password hash on purpose:
 * this is a 256-bit random value, not a password, so there is nothing to
 * brute force and a slow hash would only cost every request.
 */
export function refreshToken(): { token: string; hash: string } {
  const token = `mjr_${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A short-lived bearer token. Stateless, so nothing to store or clean up. */
export function accessToken(accountId: string, deviceId: string, secret: string, seconds = 900): string {
  const payload = Buffer.from(JSON.stringify({ sub: accountId, dev: deviceId, exp: Math.floor(Date.now() / 1000) + seconds }), 'utf8');
  const mac = createHash('sha256').update(`${secret}.${payload.toString('base64url')}`).digest('base64url');
  return `${payload.toString('base64url')}.${mac}`;
}

export function readAccessToken(token: string, secret: string): { sub: string; dev: string } | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHash('sha256').update(`${secret}.${body}`).digest('base64url');
  // Constant time, so the comparison does not leak the correct prefix one
  // character at a time.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { sub?: string; dev?: string; exp?: number };
    if (!claims.sub || !claims.dev || !claims.exp) return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: claims.sub, dev: claims.dev };
  } catch {
    return null;
  }
}

export function emailCode(): { code: string; hash: string } {
  // Six digits, because it is typed on a phone. The strength comes from the
  // ten minute window and the five attempt limit, not the length.
  const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
  return { code, hash: createHash('sha256').update(code).digest('hex') };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}
