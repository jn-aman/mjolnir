import { createHash, randomUUID } from 'node:crypto';
import { hostname, platform, userInfo } from 'node:os';

/**
 * Which machine this is.
 *
 * A lease names a device so that copying `~/.mjolnir` to a second machine does
 * not hand it a second Pro seat. The identifier therefore has to be stable
 * across restarts and upgrades, and it must not be something a user can carry
 * with them by accident.
 *
 * It is a random id, generated once and stored beside the settings. Not a MAC
 * address, not a machine UUID, not a serial number: those are stable in the
 * wrong way. They identify hardware rather than an installation, they are the
 * kind of value that ends up correlated with a person, and reading them needs
 * permissions this app has no business asking for. A random id per install is
 * exactly as useful for seat counting and tells us nothing else.
 *
 * The display name is the hostname, because that is what makes a device list
 * readable, and it is editable on the account page for people whose laptops
 * are called things like `mbp-2`.
 */
export interface DeviceIdentity {
  /** Stable, random, per installation. */
  readonly id: string;
  /** What a person will recognise in a list of devices. */
  readonly name: string;
  readonly platform: NodeJS.Platform;
  readonly appVersion: string;
}

export function newDeviceId(): string {
  return randomUUID();
}

/**
 * A readable name, with the username stripped out where it is obvious.
 *
 * macOS names machines `aman's MacBook Pro` by default, which would put a
 * person's name into a record that does not need one.
 */
export function deviceName(raw = hostname(), user = safeUsername()): string {
  const trimmed = raw.replace(/\.local$/i, '').trim();
  if (!user) return trimmed || 'This machine';
  // macOS writes the same name two ways: "Aman's MacBook Pro" in the UI and
  // "Amans-MacBook-Pro-2" as the hostname, apostrophe dropped and the spaces
  // hyphenated. Both carry the owner's name into a record that does not need
  // one, so both are handled.
  const owner = escapeForRegExp(user);
  const withoutUser = trimmed.replace(new RegExp(`^${owner}(?:['\u2019]?s)?[-\\s]+`, 'i'), '');
  return withoutUser || trimmed || 'This machine';
}

export function identity(id: string, appVersion: string): DeviceIdentity {
  return { id, name: deviceName(), platform: platform(), appVersion };
}

/**
 * A short, readable fingerprint of the device id.
 *
 * Shown beside a device in a list so two laptops with the same name can still
 * be told apart, without putting the full id on screen where it would be
 * copied into a support email.
 */
export function deviceFingerprint(id: string): string {
  const digest = createHash('sha256').update(id).digest('hex');
  return `${digest.slice(0, 4)}-${digest.slice(4, 8)}`.toUpperCase();
}

function safeUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
