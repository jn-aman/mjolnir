import { DEFAULT_SEATS } from '@mjolnir/paddle';
import type { LicenseClaims } from '@mjolnir/licensing';
import { logger } from '@mjolnir/logger';
import type { Account, Device, Store, Subscription } from './db.ts';
import { newId, type Signer } from './signing.ts';

const log = logger.child('licensing');

/** How long a lease lasts. Short enough that cancelling bites, long enough to fly with. */
export const LEASE_DAYS = 7;

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
  const subscription = store.subscriptionFor(account.id);
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
 * `expiresAt` and `updatesUntil` stay separate because the two plans fail
 * differently: a subscription that lapses stops granting Pro, and a lifetime
 * licence never stops granting Pro but does stop covering new versions.
 */
export function claimsFor(account: Account, subscription: Subscription): LicenseClaims {
  return {
    jti: subscription.id,
    email: account.email,
    plan: subscription.plan,
    iat: Math.floor(Date.now() / 1000),
    expiresAt: subscription.plan === 'lifetime' ? null : subscription.expiresAt,
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
