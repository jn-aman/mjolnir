/**
 * Values a release build carries that a source checkout does not.
 *
 * The flag client token is the case that matters. Asking every person who
 * installs Mjolnir to paste a token before feature flags work is absurd: the
 * flags are ours, the token is read-only, and the whole point is that it works
 * on first launch with nothing configured.
 *
 * So the token ships inside the build, and this file is the seam. It is
 * committed empty, which keeps the repository free of secrets and means a
 * source build simply has no flag server until someone configures one in
 * settings. `npm run build:secrets` rewrites it from the environment just
 * before packaging, and `git checkout` puts it back afterwards.
 *
 * An Unleash client token is read-only and designed to be distributed in
 * clients, so a determined person extracting it from the bundle learns which
 * flags exist and nothing else. It cannot change a toggle.
 */
export const BUILD = {
  /** Unleash client token, scoped to one project and environment. */
  flagsToken: '',
  /** Set by the release script so support can tell builds apart. */
  channel: '',
} as const;
