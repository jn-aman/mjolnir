import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '@odin/logger';

const log = logger.child('paddle:webhook');

/**
 * Paddle Billing webhook signature verification.
 *
 * Paddle sends `Paddle-Signature: ts=<unix>;h1=<hex>`, where h1 is
 * HMAC-SHA256 of the literal string `<ts>:<raw body>` under the destination's
 * secret. Two things routinely break this and both are handled here:
 *
 * 1. **The raw body.** The signature covers the exact bytes Paddle sent. Any
 *    middleware that parses and re-serialises JSON changes key order and
 *    whitespace, and every signature then fails. The webhook route must use a
 *    raw body parser, which is why this function takes bytes, not an object.
 * 2. **Secret rotation.** During a rotation Paddle sends several `h1` values in
 *    one header. Accepting only the first rejects live traffic mid-rotation.
 */

export interface ParsedSignature {
  readonly timestamp: number;
  readonly hashes: readonly string[];
}

export function parseSignatureHeader(header: string): ParsedSignature | null {
  let timestamp: number | null = null;
  const hashes: string[] = [];

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === 'ts') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) timestamp = parsed;
    } else if (key === 'h1' && value !== '') {
      hashes.push(value);
    }
  }

  if (timestamp === null || hashes.length === 0) return null;
  return { timestamp, hashes };
}

export interface VerifyWebhookOptions {
  /** Exact bytes of the request body, before any parsing. */
  readonly rawBody: Buffer | string;
  /** Value of the Paddle-Signature header. */
  readonly signatureHeader: string;
  /** Secret for the notification destination that sent this request. */
  readonly secret: string;
  /**
   * Replay window in seconds. Paddle's own SDK uses 5; this is configurable
   * because a webhook queue that retries after a delay legitimately needs more.
   */
  readonly toleranceSeconds?: number;
  readonly now?: Date;
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'malformed-header' | 'stale' | 'no-match' };

function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyWebhookSignature(options: VerifyWebhookOptions): VerifyResult {
  const parsed = parseSignatureHeader(options.signatureHeader);
  if (!parsed) {
    log.warn('webhook signature header could not be parsed');
    return { ok: false, reason: 'malformed-header' };
  }

  const tolerance = options.toleranceSeconds ?? 5;
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    log.warn('webhook signature outside replay window', {
      skewSeconds: now - parsed.timestamp,
      tolerance,
    });
    return { ok: false, reason: 'stale' };
  }

  const body = Buffer.isBuffer(options.rawBody)
    ? options.rawBody.toString('utf8')
    : options.rawBody;
  const expected = createHmac('sha256', options.secret)
    .update(`${parsed.timestamp}:${body}`, 'utf8')
    .digest('hex');

  // Check every h1 — during a secret rotation Paddle sends more than one.
  for (const hash of parsed.hashes) {
    if (equalsConstantTime(expected, hash)) return { ok: true };
  }

  log.warn('webhook signature did not match');
  return { ok: false, reason: 'no-match' };
}
