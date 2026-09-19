import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  describeLease,
  deviceFingerprint,
  identity,
  newDeviceId,
  openCredentialStore,
  requestDeviceCode,
  shouldRenew,
  verifyLease,
  waitForApproval,
  type CredentialStore,
  type DeviceCode,
  type DeviceGrantTransport,
  type DeviceIdentity,
  type GrantFailure,
  type Identity,
  type LeaseStatus,
  type ProviderId,
} from '@mjolnir/account';
import { ENDPOINTS, isAllowedHost } from '@mjolnir/endpoints';
import { logger } from '@mjolnir/logger';

const log = logger.child('account');

/**
 * The account, as the app holds it.
 *
 * Signing in is how you get a licence; the licence is what grants access, and
 * it is verified locally. Nothing in this file is on the path to reaching a
 * cluster. If every call in here fails forever, Mjolnir still opens, still
 * connects, and still shows Pro until the stored lease genuinely runs out.
 *
 * That is not politeness. People run this against production during incidents,
 * and a tool that will not open because a billing service is down is a tool
 * they will stop carrying.
 */

const DIR = join(homedir(), '.mjolnir');
const LEASE_FILE = join(DIR, 'lease.json');
const DEVICE_FILE = join(DIR, 'device.json');
const CREDENTIALS_FALLBACK = join(DIR, 'credentials.json');

/** Renewal cadence while everything is fine. The lease itself lasts a week. */
const RENEW_EVERY_MS = 6 * 60 * 60 * 1000;

/** A machine on the account, as the settings page lists it. */
export interface DeviceView {
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly lastSeenAt: string;
  readonly createdAt: string;
  /** The one you are sitting at. */
  readonly current: boolean;
  /** Holding a seat right now, which is not the same as having signed in. */
  readonly active: boolean;
}

export interface AccountStatus {
  readonly signedIn: boolean;
  readonly email: string;
  /** Which identity provider vouched for them, and under what name. */
  readonly identity?: Identity | undefined;
  readonly tier: 'free' | 'pro';
  readonly headline: string;
  readonly detail?: string | undefined;
  readonly lease: LeaseStatus['kind'];
  readonly expiresAt?: string | undefined;
  readonly plan?: string | undefined;
  readonly seats?: { total: number; used: number } | undefined;
  /** Every machine on the account. Empty when signed out or offline. */
  readonly devices: DeviceView[];
  readonly device: { id: string; name: string; fingerprint: string };
  /** Where the refresh token is kept, said plainly rather than implied. */
  readonly credentialStore: 'keychain' | 'file';
  /** Why the last renewal did not happen, when it did not. */
  readonly lastError?: string | undefined;
  readonly lastCheckedAt?: string | undefined;
}

export class AccountStore {
  readonly #version: string;
  #device: DeviceIdentity;
  #credentials: CredentialStore | null = null;
  #timer: NodeJS.Timeout | undefined;
  #lastError: string | undefined;
  #lastCheckedAt: string | undefined;
  #pending: { code: DeviceCode; cancelled: boolean } | null = null;
  #identity: Identity | undefined;
  // Last known, kept so the list is still on screen when the network is not.
  #devices: DeviceView[] = [];

  constructor(version: string) {
    this.#version = version;
    this.#device = identity(readOrCreateDeviceId(), version);
  }

  get device(): DeviceIdentity {
    return this.#device;
  }

  /**
   * The public key this build trusts.
   *
   * Same key as licence activation, because a lease and a key are the same
   * envelope signed by the same authority. One key to rotate, one to protect.
   */
  #publicKey(): string | null {
    const fromEnv = process.env['MJOLNIR_LICENCE_PUBLIC_KEY'];
    if (fromEnv) return fromEnv.replace(/\\n/g, '\n');
    const path = join(DIR, 'licence-public.pem');
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  }

  #readLease(): string {
    try {
      return (JSON.parse(readFileSync(LEASE_FILE, 'utf8')) as { token?: string }).token ?? '';
    } catch {
      return '';
    }
  }

  #writeLease(token: string): void {
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    writeFileSync(LEASE_FILE, JSON.stringify({ token, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  }

  /** The stored lease, checked. Free tier and a reason when anything is wrong. */
  leaseStatus(): LeaseStatus {
    const pem = this.#publicKey();
    if (!pem) return { kind: 'none', tier: 'free' };
    return verifyLease(this.#readLease(), { publicKeyPem: pem, deviceId: this.#device.id });
  }

  async status(): Promise<AccountStatus> {
    const store = await this.#store();
    const saved = await store.read();
    const lease = this.leaseStatus();
    const claims = 'lease' in lease ? lease.lease.claims : undefined;

    // `describeLease` only knows about the licence, so on its own it says
    // "Not signed in" to someone who has just signed in and has no
    // subscription. Those are different situations and the sentence has to
    // say which: one of them is fixed by signing in and the other is not.
    const described =
      saved && lease.kind === 'none'
        ? {
            tier: 'free' as const,
            headline: 'Signed in, no subscription',
            detail: this.#lastError ?? 'This account has nothing active on it. Everything on the free tier works exactly as it does now.',
          }
        : describeLease(lease);

    return {
      signedIn: saved !== null,
      email: saved?.email ?? claims?.email ?? '',
      identity: this.#identity,
      tier: described.tier,
      headline: described.headline,
      detail: described.detail,
      lease: lease.kind,
      expiresAt: 'lease' in lease ? new Date(lease.lease.notAfter * 1000).toISOString() : undefined,
      plan: claims?.plan,
      seats: 'lease' in lease ? lease.lease.seats : undefined,
      devices: this.#devices,
      device: { id: this.#device.id, name: this.#device.name, fingerprint: deviceFingerprint(this.#device.id) },
      credentialStore: store.backend,
      // A failed renewal only matters once a renewal is actually due. A
      // licence with six days left and one missed poll is not a problem, and
      // putting a warning on screen for it teaches people to ignore warnings.
      lastError: lease.kind === 'valid' && !shouldRenew(lease) ? undefined : this.#lastError,
      lastCheckedAt: this.#lastCheckedAt,
    };
  }

  /**
   * Starts a sign-in and returns what to put on screen.
   *
   * The provider is a preference the site may ignore: an organisation that
   * enforces Okta has to be able to refuse a request for GitHub, or
   * enforcement would be a suggestion.
   */
  async beginSignIn(options: { provider?: ProviderId; emailHint?: string } = {}): Promise<DeviceCode> {
    const code = await requestDeviceCode(this.#transport(), this.#device, options);
    this.#pending = { code, cancelled: false };
    return code;
  }

  cancelSignIn(): void {
    if (this.#pending) this.#pending.cancelled = true;
    this.#pending = null;
  }

  /**
   * Waits for the person to approve, then stores the credentials and takes a
   * lease. Returns the new status either way.
   */
  async completeSignIn(): Promise<{ ok: boolean; failure?: GrantFailure; status: AccountStatus }> {
    const pending = this.#pending;
    if (!pending) return { ok: false, failure: { error: 'invalid_grant', description: 'no sign-in is in progress' }, status: await this.status() };

    const result = await waitForApproval({
      transport: this.#transport(),
      code: pending.code,
      signal: { get aborted() { return pending.cancelled; } } as { aborted: boolean },
    });
    this.#pending = null;

    if (!result.done) {
      this.#lastError = result.failure.description;
      return { ok: false, failure: result.failure, status: await this.status() };
    }

    const store = await this.#store();
    const identity = result.tokens.identity;
    await store.write({
      refreshToken: result.tokens.refresh_token,
      email: identity?.email ?? result.tokens.email ?? '',
      savedAt: new Date().toISOString(),
    });
    this.#identity = identity;
    // The provider, never the token: which door someone came through is
    // useful in a log, and their credential never is.
    log.info('signed in', { store: store.backend, provider: identity?.provider ?? 'unknown' });
    await this.renew();
    return { ok: true, status: await this.status() };
  }

  /**
   * Signs this device out.
   *
   * The lease goes with the credentials. Leaving a week-long Pro lease behind
   * after someone deliberately signed out would be a surprise, and a bad one
   * on a shared machine.
   */
  async signOut(): Promise<AccountStatus> {
    const store = await this.#store();
    const saved = await store.read();
    if (saved) {
      // Best effort: tell the server so the seat is freed now rather than in
      // sixty days. A failure here must not stop a local sign-out.
      try {
        await this.#post('/api/token/revoke', { refresh_token: saved.refreshToken, device_id: this.#device.id });
      } catch (error) {
        log.debug('could not revoke remotely', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    await store.clear();
    rmSync(LEASE_FILE, { force: true });
    this.#identity = undefined;
    this.#devices = [];
    this.#lastError = undefined;
    log.info('signed out');
    return this.status();
  }

  /**
   * Exchanges the refresh token for a fresh lease.
   *
   * Never throws. A failed renewal leaves the previous lease in place, which
   * is the whole reason a lease has a grace window.
   */
  async renew(force = false): Promise<AccountStatus> {
    const store = await this.#store();
    const saved = await store.read();
    if (!saved) return this.status();
    if (!force && !shouldRenew(this.leaseStatus())) return this.status();

    try {
      const response = await this.#post('/api/licence/lease', {
        refresh_token: saved.refreshToken,
        device_id: this.#device.id,
        device_name: this.#device.name,
        platform: this.#device.platform,
        app_version: this.#version,
      });
      this.#lastCheckedAt = new Date().toISOString();

      if (response.status === 401 || response.status === 403) {
        // The account is gone, or this device was signed out elsewhere. Drop
        // the credentials so the UI asks rather than retrying forever, but
        // leave the lease: it is still signed and still in date.
        await store.clear();
        this.#lastError = 'This device was signed out. Sign in again to keep Pro.';
        log.info('refresh token rejected; credentials cleared');
        return this.status();
      }
      if (response.status >= 400) {
        // A seat limit arrives with the machines holding the seats, because
        // "no seats left" with nothing to act on is a dead end and the person
        // almost always wants to sign out a laptop they no longer own.
        const payload = response.body as { devices?: DeviceView[] } | null;
        if (Array.isArray(payload?.devices)) this.#devices = payload.devices;
        this.#lastError = describe(response);
        return this.status();
      }

      const payload = response.body as { lease?: string; devices?: DeviceView[] } | null;
      if (Array.isArray(payload?.devices)) this.#devices = payload.devices;
      const token = payload?.lease;
      if (typeof token !== 'string' || token === '') {
        this.#lastError = 'the licence service returned no lease';
        return this.status();
      }
      this.#writeLease(token);
      this.#lastError = undefined;
      log.info('licence lease renewed');
    } catch (error) {
      // Offline is the normal case, not an incident.
      this.#lastError = error instanceof Error ? error.message : String(error);
      log.debug('lease renewal did not happen', { error: this.#lastError });
    }
    return this.status();
  }

  /** The machines on this account, refreshed from the service. */
  async devices(): Promise<DeviceView[]> {
    const store = await this.#store();
    const saved = await store.read();
    if (!saved) return [];
    try {
      const response = await this.#post('/api/account/devices', { refresh_token: saved.refreshToken });
      const payload = response.body as { devices?: DeviceView[] } | null;
      if (Array.isArray(payload?.devices)) this.#devices = payload.devices;
    } catch (error) {
      // Offline: the last list is better than an empty one.
      log.debug('could not refresh the device list', { error: error instanceof Error ? error.message : String(error) });
    }
    return this.#devices;
  }

  /**
   * Signs a machine out, freeing its seat.
   *
   * Signing out the machine you are sitting at is allowed and does the obvious
   * thing: the credentials and lease go, same as Sign out.
   */
  async revokeDevice(deviceId: string): Promise<AccountStatus> {
    const store = await this.#store();
    const saved = await store.read();
    if (!saved) return this.status();
    try {
      const response = await this.#post('/api/account/devices/revoke', { refresh_token: saved.refreshToken, device_id: deviceId });
      const payload = response.body as { devices?: DeviceView[]; wasCurrent?: boolean } | null;
      if (Array.isArray(payload?.devices)) this.#devices = payload.devices;
      if (payload?.wasCurrent) return this.signOut();
      if (response.status >= 400) this.#lastError = describe(response);
      else {
        this.#lastError = undefined;
        // A freed seat is usually freed in order to use it here.
        await this.renew(true);
      }
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error);
    }
    return this.status();
  }

  start(): void {
    this.stop();
    void this.renew();
    this.#timer = setInterval(() => void this.renew(), RENEW_EVERY_MS);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #store(): Promise<CredentialStore> {
    this.#credentials ??= await openCredentialStore(CREDENTIALS_FALLBACK);
    return this.#credentials;
  }

  #base(): string {
    const configured = process.env['MJOLNIR_API_URL'] ?? ENDPOINTS.api;
    // The one-apex rule applies here as much as anywhere: a build must not be
    // talked into sending a refresh token to somebody else's host.
    if (!isAllowedHost(configured, { allowLoopback: true })) {
      log.warn('ignoring an API URL that is not ours', { configured });
      return ENDPOINTS.api;
    }
    return configured.replace(/\/+$/, '');
  }

  async #post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const url = `${this.#base()}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': `mjolnir/${this.#version}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      // `fetch failed` is what Node says and it tells a person nothing. The
      // host is the useful part: it is either their network or ours, and
      // naming it is the difference between a shrug and a next step.
      const cause = error instanceof Error ? error : new Error(String(error));
      const host = new URL(url).host;
      const reason = /timeout|abort/i.test(cause.message)
        ? `${host} did not answer in time`
        : `could not reach ${host}`;
      throw new Error(`${reason}. Mjolnir works offline; Pro continues until the current licence runs out.`);
    }
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text.slice(0, 200) };
    }
    return { status: response.status, body: parsed };
  }

  #transport(): DeviceGrantTransport {
    return { post: (path, body) => this.#post(path, body) };
  }
}

/** The device id, made once and then left alone. */
function readOrCreateDeviceId(): string {
  try {
    const stored = (JSON.parse(readFileSync(DEVICE_FILE, 'utf8')) as { id?: string }).id;
    if (typeof stored === 'string' && stored.length >= 8) return stored;
  } catch {
    // First run, or the file was removed. Either way, make a new one.
  }
  const id = newDeviceId();
  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    writeFileSync(DEVICE_FILE, JSON.stringify({ id, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  } catch (error) {
    log.warn('could not remember this device; a new id will be made next start', { error: error instanceof Error ? error.message : String(error) });
  }
  return id;
}

/**
 * The sentence to put on screen.
 *
 * `description` is checked before `error`, because `error` is a machine code
 * and putting `no_subscription` in front of a person is the same as saying
 * nothing. The code is the last resort, and the status is the resort after
 * that.
 */
function describe(response: { status: number; body: unknown }): string {
  const body = response.body as { description?: string; error_description?: string; message?: string; error?: string } | null;
  return body?.description ?? body?.error_description ?? body?.message ?? body?.error ?? `the licence service answered ${response.status}`;
}
