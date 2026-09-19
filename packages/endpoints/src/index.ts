/**
 * Every host Mjolnir is allowed to talk to, in one file.
 *
 * The rule is simple and worth keeping simple: a Mjolnir build contacts
 * `*.mjolnir.sh` and nothing else. Not a flag vendor's cloud, not a crash
 * vendor's ingest, not a CDN someone picked in a hurry. People run this thing
 * against production clusters inside networks with egress rules, and "allow
 * *.mjolnir.sh" is a rule an ops team can actually write down and audit.
 *
 * Third parties still do the work behind these names. Unleash Edge answers on
 * unleash.mjolnir.sh, the update feed is object storage behind
 * updates.mjolnir.sh, Paddle is reached through api.mjolnir.sh. That is a
 * deployment detail. From the app's side there is one apex, and
 * `isAllowedHost` is the check that keeps it that way.
 */

export { BUILD } from './build.ts';

export const APEX = 'mjolnir.sh';

export const ENDPOINTS = {
  /** Marketing site and docs. */
  site: 'https://mjolnir.sh',
  /** Licence activation and account calls, which proxy the payment provider. */
  api: 'https://api.mjolnir.sh',
  /** Unleash Edge. The app reads toggles; it never writes them. */
  flags: 'https://unleash.mjolnir.sh',
  /** Usage events and crash reports, when the person has said yes. */
  telemetry: 'https://telemetry.mjolnir.sh',
  /** The electron-updater feed: the channel file and the artefacts beside it. */
  updates: 'https://api.mjolnir.sh/updates',
  /** Release notes, linked from the update prompt. */
  releases: 'https://mjolnir.sh/releases',
} as const;

export type EndpointName = keyof typeof ENDPOINTS;

/**
 * The only flag environment there is.
 *
 * A desktop app ships one build to everyone. There is no staging fleet
 * pointed at a different set of toggles, so a second environment is only ever
 * a second place for a flag's state to live and a second place to forget to
 * change it. Unleash starts projects with a `development` environment; it is
 * disabled on ours and this is the app's half of the same decision.
 */
export const FLAG_ENVIRONMENT = 'production';

/**
 * True when a URL points at the apex or one of its subdomains, over HTTPS.
 *
 * Checked with the URL parser rather than a string match, because
 * `https://mjolnir.sh.attacker.example` and `https://notmjolnir.sh` both pass a
 * naive `endsWith` and neither is us. Loopback is allowed so a developer can
 * point a build at a local stand-in without the check lying about what it saw.
 */
export function isAllowedHost(candidate: string, options: { allowLoopback?: boolean } = {}): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (options.allowLoopback && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')) {
    return url.protocol === 'http:' || url.protocol === 'https:';
  }
  if (url.protocol !== 'https:') return false;
  return url.hostname === APEX || url.hostname.endsWith(`.${APEX}`);
}

/** The same check, phrased as the sentence a settings page should show. */
export function hostRefusal(candidate: string): string | null {
  if (isAllowedHost(candidate, { allowLoopback: true })) return null;
  if (!candidate.trim()) return 'Enter an address.';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return 'Use https. Mjolnir will not send anything over a plain connection.';
    return `Mjolnir only contacts ${APEX} and its subdomains, so ${url.hostname} is refused.`;
  } catch {
    return 'That is not a URL. It should look like https://unleash.mjolnir.sh';
  }
}
