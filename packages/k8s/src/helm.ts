import { gunzipSync } from 'node:zlib';

/**
 * Helm releases, read from where Helm keeps them.
 *
 * Helm 3 stores every revision as a Secret named
 * `sh.helm.release.v1.<name>.v<revision>` in the release namespace, with the
 * release JSON gzipped and base64-encoded in `data.release` (and the Secret's
 * own base64 on top of that). Reading them needs no helm binary and no
 * plugin: the cluster is the source of truth, and this is exactly what
 * `helm list` and `helm get` read.
 */

export interface HelmChartMeta {
  readonly name: string;
  readonly version: string;
  readonly appVersion?: string | undefined;
  readonly description?: string | undefined;
}

export interface HelmRelease {
  readonly name: string;
  readonly namespace: string;
  readonly revision: number;
  readonly status: string;
  readonly chart: HelmChartMeta;
  readonly firstDeployed?: string | undefined;
  readonly lastDeployed?: string | undefined;
  readonly description?: string | undefined;
  readonly notes?: string | undefined;
  /** User-supplied values (what `helm get values` shows). */
  readonly values: Record<string, unknown>;
  readonly manifest: string;
  /** The Secret this came from, for kubectl parity. */
  readonly secret: string;
}

interface RawRelease {
  name?: string;
  namespace?: string;
  version?: number;
  info?: { status?: string; first_deployed?: string; last_deployed?: string; description?: string; notes?: string };
  chart?: { metadata?: { name?: string; version?: string; appVersion?: string; description?: string } };
  config?: Record<string, unknown>;
  manifest?: string;
}

export interface HelmSecretShape {
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
  type?: string;
  data?: Record<string, string>;
}

export function isHelmReleaseSecret(secret: HelmSecretShape): boolean {
  return secret.type === 'helm.sh/release.v1' || secret.metadata?.labels?.['owner'] === 'helm';
}

export function decodeHelmRelease(secret: HelmSecretShape): HelmRelease | null {
  const encoded = secret.data?.['release'];
  if (!encoded) return null;
  try {
    const inner = Buffer.from(encoded, 'base64').toString('utf8');
    const gz = Buffer.from(inner, 'base64');
    const json = gunzipSync(gz).toString('utf8');
    const raw = JSON.parse(json) as RawRelease;
    return {
      name: raw.name ?? secret.metadata?.labels?.['name'] ?? '',
      namespace: raw.namespace ?? secret.metadata?.namespace ?? '',
      revision: raw.version ?? Number(secret.metadata?.labels?.['version'] ?? 0),
      status: raw.info?.status ?? secret.metadata?.labels?.['status'] ?? 'unknown',
      chart: {
        name: raw.chart?.metadata?.name ?? '',
        version: raw.chart?.metadata?.version ?? '',
        appVersion: raw.chart?.metadata?.appVersion,
        description: raw.chart?.metadata?.description,
      },
      firstDeployed: raw.info?.first_deployed,
      lastDeployed: raw.info?.last_deployed,
      description: raw.info?.description,
      notes: raw.info?.notes,
      values: raw.config ?? {},
      manifest: raw.manifest ?? '',
      secret: secret.metadata?.name ?? '',
    };
  } catch {
    return null;
  }
}

/** Every revision of every release, newest revision first within a release. */
export function decodeHelmReleases(secrets: readonly HelmSecretShape[]): HelmRelease[] {
  return secrets
    .filter(isHelmReleaseSecret)
    .map(decodeHelmRelease)
    .filter((release): release is HelmRelease => release !== null)
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name) || b.revision - a.revision);
}

/** The current revision of each release. */
export function latestHelmReleases(secrets: readonly HelmSecretShape[]): HelmRelease[] {
  const seen = new Set<string>();
  return decodeHelmReleases(secrets).filter((release) => {
    const key = `${release.namespace}/${release.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
