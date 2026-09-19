import { DEFAULT_SEATS } from '@mjolnir/paddle';
import type { LicenseClaims } from '@mjolnir/licensing';
import { logger } from '@mjolnir/logger';
import type { Account, Device, Store, Subscription } from './db.ts';
import { newId, type Signer } from './signing.ts';

const log = logger.child('licensing');

/** How long a lease lasts. Short enough that cancelling bites, long enough to fly with. */
export const LEASE_DAYS = 7;

/**
 * The trial, and what happens when somebody asks for more of it.
 *
 * Thirty days, started by signing in rather than by asking for it. A trial
 * somebody has to request is a trial most people never start, and the whole
 * point is to find out whether this is any good on a real cluster, which
 * takes longer than an afternoon.
 *
 * The first extension is granted on the spot. Somebody still asking after
 * thirty days is somebody still trying, and refusing them costs a customer to
 * save nothing. The second is a conversation, and the request is recorded so
 * there is something to have it about.
 */
export const TRIAL_DAYS = 30;
export const EXTENSION_DAYS = 14;
export const AUTOMATIC_EXTENSIONS = 1;

export interface DeviceView {
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly lastSeenAt: string;
  readonly createdAt: string;
  /** True for the device asking, so the UI can say "this machine". */
  readonly current: boolean;
  /** Whether it is holding a seat right now. */
  readonly active: boolean;
}

export type LeaseOutcome =
  | { readonly ok: true; readonly lease: string; readonly seats: { total: number; used: number }; readonly devices: DeviceView[] }
  | { readonly ok: false; readonly error: 'no_subscription'; readonly description: string }
  | { readonly ok: false; readonly error: 'deprovisioned'; readonly description: string }
  | {
      /**
       * Every seat is taken. The list comes with it, because "no seats left"
       * with nothing to act on is a dead end, and the person almost always
       * wants to sign out a machine they no longer own.
       */
      readonly ok: false;
      readonly error: 'seat_limit';
      readonly description: string;
      readonly seats: { total: number; used: number };
      readonly devices: DeviceView[];
    };

/**
 * Turns a subscription into a lease for one machine.
 *
 * The seat check happens here and nowhere else, so there is exactly one place
 * that decides whether someone may have Pro on a given machine.
 */
export function issueLease(
  store: Store,
  signer: Signer,
  account: Account,
  device: { id: string; name: string; platform: string; appVersion: string },
): LeaseOutcome {
  /*
   * The directory has the last word.
   *
   * This is above the subscription check on purpose: an organisation that
   * offboarded someone does not want to hear that their seat was fine, it
   * wants them not to have one. Sitting here rather than at sign-in means it
   * also catches a machine that was already signed in when they were removed,
   * on its next renewal.
   */
  if (account.suspended) {
    return {
      ok: false,
      error: 'deprovisioned',
      description: 'Your organisation has removed your access to Mjolnir. Everything on the free tier still works.',
    };
  }

  /*
   * A trial starts by signing in, not by asking.
   *
   * The first time an account asks for a licence and has none, it gets thirty
   * days. Nothing in the app has to know about it: the trial is a
   * subscription with a plan of `trial`, so every check that asks what
   * somebody has gets the same answer in the same shape.
   */
  const subscription = store.subscriptionFor(account.id) ?? startTrial(store, account);
  if (!subscription) {
    return {
      ok: false,
      error: 'no_subscription',
      description: 'This account has no active subscription. Everything on the free tier still works.',
    };
  }

  const known = store.devicesFor(account.id);
  const active = store.activeDevices(account.id);
  const holdsSeat = active.some((entry) => entry.id === device.id);

  const total = Math.max(subscription.seats, DEFAULT_SEATS);
  if (!holdsSeat && active.length >= total) {
    log.info('seat limit reached', { account: account.id, seats: total });
    return {
      ok: false,
      error: 'seat_limit',
      description:
        total === 1
          ? 'Your licence covers one machine, and another one is using it. Sign that one out to move the licence here.'
          : `All ${total} machines are in use. Sign one out to make room for this one, or add seats from your account page.`,
      seats: { total, used: active.length },
      devices: view(known, device.id, active),
    };
  }

  const claims = claimsFor(account, subscription);
  const used = holdsSeat ? active.length : active.length + 1;
  const seats = { total, used };
  const { token, nonce, notAfter } = signer.signLease({ claims, deviceId: device.id, days: LEASE_DAYS, seats });

  store.recordLease(nonce, account.id, device.id, Math.floor(Date.now() / 1000), notAfter);
  store.touchDevice(account.id, device.id, device.appVersion);

  const after = store.devicesFor(account.id);
  return { ok: true, lease: token, seats, devices: view(after, device.id, store.activeDevices(account.id)) };
}

/**
 * The claims a licence carries.
 *
 * `expiresAt` and `updatesUntil` stay separate because they lapse for
 * different reasons: the first decides whether Pro works at all, the second
 * decides which builds this licence covers, and collapsing them means a
 * lapsed update entitlement takes Pro away from somebody still paying.
 */
/**
 * Thirty days, once.
 *
 * Returns null for an account that has already had one and let it lapse:
 * a trial that restarts itself is not a trial, it is the product.
 */
export function startTrial(store: Store, account: Account, now = Math.floor(Date.now() / 1000)): Subscription | null {
  if (store.hadTrial(account.id)) return null;

  const subscription: Subscription = {
    id: newId('sub'),
    accountId: account.id,
    plan: 'trial',
    status: 'active',
    expiresAt: now + TRIAL_DAYS * 86_400,
    // Updates for as long as the trial runs, and no longer: a lapsed trial
    // should stop offering new versions, not keep quietly upgrading.
    updatesUntil: now + TRIAL_DAYS * 86_400,
    seats: DEFAULT_SEATS,
    paddleSubscriptionId: null,
  };
  store.saveSubscription(subscription);
  log.info('trial started', { account: account.id, days: TRIAL_DAYS });
  return subscription;
}

export type ExtensionOutcome =
  | { readonly ok: true; readonly grantedDays: number; readonly expiresAt: number }
  | { readonly ok: false; readonly error: 'not_on_trial' | 'already_asked'; readonly description: string };

/**
 * More time, asked for by somebody still evaluating.
 *
 * The first ask is granted immediately and the rest are recorded as pending,
 * so nobody is blocked on a reply at the moment they most want to keep going,
 * and nobody extends forever without a person looking.
 */
export function requestExtension(store: Store, account: Account, reason: string, now = Math.floor(Date.now() / 1000)): ExtensionOutcome {
  const subscription = store.subscriptionFor(account.id) ?? store.lastSubscription(account.id);
  if (!subscription || subscription.plan !== 'trial') {
    return {
      ok: false,
      error: 'not_on_trial',
      description: 'This account is not on a trial, so there is nothing to extend.',
    };
  }

  const already = store.extensionsFor(account.id);
  const granted = already.filter((entry) => entry.status === 'granted').length;
  const pending = already.some((entry) => entry.status === 'pending');

  if (granted >= AUTOMATIC_EXTENSIONS || pending) {
    if (!pending) {
      store.saveExtension({
        id: newId('ext'),
        accountId: account.id,
        requestedAt: new Date(now * 1000).toISOString(),
        reason: reason.slice(0, 500),
        days: EXTENSION_DAYS,
        status: 'pending',
        decidedAt: null,
      });
    }
    return {
      ok: false,
      error: 'already_asked',
      description:
        'We have your request and will come back to you. Everything on the free tier keeps working in the meantime, and nothing in your cluster is touched.',
    };
  }

  // From now rather than from the old expiry, so asking late is not punished
  // by an extension that has already half elapsed.
  const from = Math.max(subscription.expiresAt ?? now, now);
  const expiresAt = from + EXTENSION_DAYS * 86_400;
  store.saveSubscription({ ...subscription, status: 'active', expiresAt, updatesUntil: expiresAt });
  store.saveExtension({
    id: newId('ext'),
    accountId: account.id,
    requestedAt: new Date(now * 1000).toISOString(),
    reason: reason.slice(0, 500),
    days: EXTENSION_DAYS,
    status: 'granted',
    decidedAt: new Date(now * 1000).toISOString(),
  });
  log.info('trial extended', { account: account.id, days: EXTENSION_DAYS });
  return { ok: true, grantedDays: EXTENSION_DAYS, expiresAt };
}

export function claimsFor(account: Account, subscription: Subscription): LicenseClaims {
  return {
    jti: subscription.id,
    email: account.email,
    plan: subscription.plan,
    iat: Math.floor(Date.now() / 1000),
    expiresAt: subscription.expiresAt,
    updatesUntil: subscription.updatesUntil,
    customerId: account.customerId ?? newId('ctm'),
  };
}

export function view(devices: readonly Device[], currentId: string, active: readonly Device[]): DeviceView[] {
  const activeIds = new Set(active.map((entry) => entry.id));
  return devices.map((entry) => ({
    id: entry.id,
    name: entry.name,
    platform: entry.platform,
    appVersion: entry.appVersion,
    lastSeenAt: entry.lastSeenAt,
    createdAt: entry.createdAt,
    current: entry.id === currentId,
    active: activeIds.has(entry.id),
  }));
}
