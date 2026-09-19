import { z } from 'zod';
import { logger } from '@mjolnir/logger';
import type { DeviceIdentity } from './device.ts';
import { IdentitySchema, ProviderOfferSchema, type ProviderId } from './providers.ts';

const log = logger.child('account');

/**
 * Signing in, without a password and without a client secret.
 *
 * A desktop app cannot keep a secret, so the usual web OAuth exchange does not
 * apply to it. The device authorization grant (RFC 8628) is the flow designed
 * for exactly this: the app asks for a code, shows it, and polls; the person
 * approves in a browser, which may be on an entirely different machine.
 *
 * The alternative, a loopback redirect with PKCE, needs the app to listen on a
 * local port and needs the browser to be on the same machine. It is a fine
 * second option and a poor first one: corporate endpoint software dislikes
 * processes that open listening sockets, and "open this URL and type HAMR-4Q7X"
 * is something a person can do from their phone.
 *
 * Nothing is stored until the exchange succeeds. An abandoned sign-in leaves
 * no trace on the machine.
 */

export const DeviceCodeSchema = z.object({
  /** Secret, held by the app, exchanged for tokens. Never shown. */
  device_code: z.string().min(1),
  /** Short and readable. This is what goes on screen. */
  user_code: z.string().min(1),
  verification_uri: z.string().min(1),
  /** The same URL with the code already in it, for a QR or a click. */
  verification_uri_complete: z.string().optional(),
  /** Seconds until the code is useless. */
  expires_in: z.number().int().positive(),
  /** Seconds between polls. The server owns this number, not us. */
  interval: z.number().int().positive().default(5),
  /**
   * Which ways in this person may use. Sent by the server rather than fixed in
   * the app, so adding a provider, or an organisation turning one off, does
   * not need a release.
   */
  providers: ProviderOfferSchema.default({ available: ['email'], enforced: null, enforcedBy: null }),
});
export type DeviceCode = z.infer<typeof DeviceCodeSchema>;

export const TokensSchema = z.object({
  refresh_token: z.string().min(1),
  access_token: z.string().min(1),
  /** Seconds. Short by design; the refresh token is the durable one. */
  expires_in: z.number().int().positive(),
  email: z.string().optional(),
  /** Who signed in, and through what. "Signed in" with no name is not an answer. */
  identity: IdentitySchema.optional(),
});
export type Tokens = z.infer<typeof TokensSchema>;

/** The errors RFC 8628 defines for the polling endpoint, plus ours. */
export type GrantError =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_grant'
  | 'seat_limit'
  | 'network'
  | 'unexpected';

export interface GrantFailure {
  readonly error: GrantError;
  readonly description: string;
}

export type PollResult = { readonly done: true; readonly tokens: Tokens } | { readonly done: false; readonly failure: GrantFailure };

export interface DeviceGrantTransport {
  /** POSTs JSON and returns the parsed body with its status. Injected so this is testable without a network. */
  post(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
}

/**
 * Starts a sign-in. The caller shows `user_code` and `verification_uri`.
 */
export async function requestDeviceCode(
  transport: DeviceGrantTransport,
  device: DeviceIdentity,
  options: { readonly provider?: ProviderId; readonly emailHint?: string } = {},
): Promise<DeviceCode> {
  const response = await transport.post('/api/device/code', {
    device_id: device.id,
    device_name: device.name,
    platform: device.platform,
    app_version: device.appVersion,
    // A preference, not an instruction. The site decides what it will honour:
    // an organisation that enforces Okta must be able to ignore a request for
    // GitHub, or enforcement would be a suggestion.
    ...(options.provider ? { provider: options.provider } : {}),
    // Routes an enterprise sign-in to the right tenant without asking the
    // person which company they work for.
    ...(options.emailHint ? { login_hint: options.emailHint } : {}),
  });
  if (response.status >= 400) throw new Error(describeStatus(response));
  const parsed = DeviceCodeSchema.safeParse(response.body);
  if (!parsed.success) throw new Error('the sign-in service returned something unexpected');
  return parsed.data;
}

/** One poll. Returns the tokens, or why not yet. */
export async function pollForTokens(transport: DeviceGrantTransport, deviceCode: string): Promise<PollResult> {
  let response: { status: number; body: unknown };
  try {
    response = await transport.post('/api/device/token', { device_code: deviceCode });
  } catch (error) {
    // A dropped connection mid sign-in is not a refusal; the caller keeps going.
    return { done: false, failure: { error: 'network', description: error instanceof Error ? error.message : String(error) } };
  }

  if (response.status < 400) {
    const parsed = TokensSchema.safeParse(response.body);
    if (!parsed.success) return { done: false, failure: { error: 'unexpected', description: 'the sign-in service returned something unexpected' } };
    return { done: true, tokens: parsed.data };
  }

  const body = (response.body ?? {}) as { error?: string; error_description?: string };
  const known: readonly GrantError[] = ['authorization_pending', 'slow_down', 'access_denied', 'expired_token', 'invalid_grant', 'seat_limit'];
  const error = known.find((candidate) => candidate === body.error) ?? 'unexpected';
  return { done: false, failure: { error, description: body.error_description ?? describeStatus(response) } };
}

export interface WaitOptions {
  readonly transport: DeviceGrantTransport;
  readonly code: DeviceCode;
  /** Injected so tests do not actually wait. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  /** Called on every poll, so the UI can count down. */
  readonly onTick?: (secondsLeft: number) => void;
  /** Aborts the wait; the caller resolves with access_denied. */
  readonly signal?: { readonly aborted: boolean };
}

/**
 * Polls until the person approves, refuses, or the code expires.
 *
 * `slow_down` widens the interval permanently, as the RFC requires: a server
 * asking us to back off and being ignored is how an app gets rate limited into
 * uselessness for everyone.
 */
export async function waitForApproval(options: WaitOptions): Promise<PollResult> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());

  let interval = options.code.interval;
  const deadline = now() + options.code.expires_in * 1000;

  for (;;) {
    if (options.signal?.aborted) {
      return { done: false, failure: { error: 'access_denied', description: 'sign-in was cancelled' } };
    }
    const remaining = Math.ceil((deadline - now()) / 1000);
    if (remaining <= 0) {
      return { done: false, failure: { error: 'expired_token', description: 'the code expired before it was approved' } };
    }
    options.onTick?.(remaining);

    await sleep(interval * 1000);

    const result = await pollForTokens(options.transport, options.code.device_code);
    if (result.done) return result;

    switch (result.failure.error) {
      case 'authorization_pending':
      case 'network':
        continue;
      case 'slow_down':
        interval += 5;
        log.debug('sign-in polling slowed down', { interval });
        continue;
      default:
        return result;
    }
  }
}

function describeStatus(response: { status: number; body: unknown }): string {
  const body = response.body as { error_description?: string; message?: string } | null;
  if (body?.error_description) return body.error_description;
  if (body?.message) return body.message;
  if (response.status === 429) return 'too many attempts; wait a moment and try again';
  if (response.status >= 500) return 'the sign-in service is not answering';
  return `the sign-in service answered ${response.status}`;
}
