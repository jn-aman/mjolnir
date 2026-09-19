import type { ClusterContext, ResourceDefinition, WatchState } from '@mjolnir/k8s';

/**
 * Client for the local API.
 *
 * The server binds to loopback and the desktop shell injects its port, so there
 * is no base URL to configure and no auth to carry, the only thing that can
 * reach it is this window.
 */

const base = (): string => {
  const injected = (globalThis as { __MJOLNIR_API__?: string }).__MJOLNIR_API__;
  return injected ?? '';
};

export type ErrorCode = 'bad-request' | 'auth' | 'not-found' | 'upstream' | 'internal';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }

  /** The cue to offer a session refresh rather than show a failure. */
  get isAuth(): boolean {
    return this.code === 'auth';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    let code: ErrorCode = 'internal';
    let message = response.statusText;
    try {
      const body = (await response.json()) as { error?: { code?: ErrorCode; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* a non-JSON error body is still an error; keep the status text */
    }
    throw new ApiError(code, message, response.status);
  }

  return (await response.json()) as T;
}

export interface ClustersResponse {
  readonly hidden?: string[];
  readonly contexts: ClusterContext[];
  readonly currentContext: string | null;
  readonly failures: Array<{ path: string; error: string }>;
}

export interface ClusterStatus {
  readonly reachable: boolean;
  readonly version?: string | null;
  readonly error?: string;
  readonly latencyMs: number;
}

export interface ResourceListResponse<T = Record<string, unknown>> {
  readonly kind: string;
  readonly namespaced: boolean;
  readonly state: WatchState;
  readonly error: string | null;
  readonly updatedAt: string | null;
  readonly items: T[];
}

export interface LogLineWire {
  readonly seq: number;
  readonly timestamp: string | null;
  readonly message: string;
  readonly pod: string;
  readonly container: string;
}

export interface AppSettings {
  general: { showSystemNamespaces: boolean; defaultNamespace: string };
  clusters: { hidden: string[]; kubeconfigs: string[]; perContext: Record<string, { namespace?: string; namespaces?: string[]; label?: string; color?: string }> };
  ai: { provider: 'anthropic' | 'openai'; preset: string; baseUrl: string; apiKey: string; model: string; allowWrites: boolean; instructions: string };
  mcp: { http: boolean; token: string; allowWrites: boolean };
  licence: { key: string };
  install: { id: string; firstRun: string };
  flags: { overrides: Record<string, boolean>; remote: { enabled: boolean; url: string; token: string; environment: string; refreshSeconds: number } };
  telemetry: { usage: boolean; crashes: boolean; decided: boolean };
  updates: { channel: 'stable' | 'beta'; automatic: boolean; checkOnLaunch: boolean; skipped: string };
  onboarding: { completed: boolean; step: string; version: number };
}

/** A kind this cluster defines, discovered from its CustomResourceDefinitions. */
export interface CustomResource extends ResourceDefinition {
  definition: string;
  shortNames: string[];
  versions: string[];
  columns: Array<{ name: string; jsonPath: string; type: string; priority?: number }>;
  owner?: string;
}

export interface FlagState {
  id: string;
  label: string;
  description: string;
  stage: 'internal' | 'experimental' | 'beta' | 'stable';
  module: string;
  warning?: string;
  value: boolean;
  source: 'override' | 'remote' | 'default';
  fallback: boolean;
  remote?: boolean;
  /** Why the flag server's answer is what it is, when the toggle alone does not say. */
  remoteReason?: string;
}

export interface RemoteFlagStatus {
  enabled: boolean;
  url: string;
  state: 'off' | 'never-fetched' | 'ok' | 'failed';
  fetchedAt?: string;
  error?: string;
  count: number;
}

export interface TelemetryView {
  consent: { usage: boolean; crashes: boolean; decided: boolean };
  catalogue: Array<{ name: string; strings: Record<string, string[]>; numbers: string[] }>;
  queue: unknown[];
  envelope: Record<string, unknown>;
  lastSend?: string;
  lastError?: string;
}

export interface UpdateView {
  version: string;
  feed: string;
  preferences: AppSettings['updates'];
  state: { status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'current' | 'error' | 'unsupported'; version?: string; percent?: number; error?: string; checkedAt?: string };
}

export interface AccountStatus {
  signedIn: boolean;
  email: string;
  tier: 'free' | 'pro';
  headline: string;
  detail?: string;
  lease: 'none' | 'invalid' | 'wrong-device' | 'valid' | 'grace' | 'expired';
  expiresAt?: string;
  plan?: string;
  seats?: { total: number; used: number };
  devices: AccountDevice[];
  device: { id: string; name: string; fingerprint: string };
  /** Where the refresh token is kept. Shown, not implied. */
  identity?: { provider: 'email' | 'github' | 'google' | 'okta'; email: string; handle?: string; organisation?: string };
  credentialStore: 'keychain' | 'file';
  lastError?: string;
  lastCheckedAt?: string;
}

export interface AccountDevice {
  id: string;
  name: string;
  platform: string;
  appVersion: string;
  lastSeenAt: string;
  createdAt: string;
  /** The machine you are sitting at. */
  current: boolean;
  /** Holding a seat, which is not the same as having signed in. */
  active: boolean;
}

export interface DriftChange {
  path: string;
  kind: 'changed' | 'removed' | 'type-changed';
  desired: unknown;
  live: unknown;
  note?: string | null;
  /** Some drift is a controller doing its job. */
  expected: boolean;
}

export type DriftResult =
  | {
      available: true;
      source: 'helm' | 'last-applied' | 'argocd';
      object: { kind: string; name: string; namespace?: string | null };
      changes: DriftChange[];
      unexpected: number;
      inSync: boolean;
      summary: string;
      against: string;
    }
  | {
      available: false;
      object: { kind: string; name: string; namespace?: string | null };
      /** Why there is nothing to compare against, which is not the same as no drift. */
      reason: string;
    };

export interface CertificateSummary {
  id: string;
  source: 'secret' | 'cert-manager' | 'webhook' | 'api-service';
  name: string;
  namespace?: string | null;
  subject: string;
  issuer: string;
  hosts: string[];
  notBefore: string;
  notAfter: string;
  /** Negative once it has expired. */
  daysLeft: number;
  state: 'expired' | 'critical' | 'soon' | 'ok' | 'not-yet-valid' | 'not-issued';
  selfSigned: boolean;
  /** True when a controller renews this without anyone doing anything. */
  managed: boolean;
  issuerRef?: string | null;
  renewAt?: string | null;
  serial: string;
  keyType: string;
  chainLength: number;
  usedBy: Array<{ kind: string; name: string; namespace?: string | null; hosts?: string[] | null }>;
  detail: string;
  fix?: string | null;
  problems: Array<{ kind: string; detail: string; severity: 'critical' | 'warning' | 'info' }>;
}

export interface CertificateReport {
  certificates: CertificateSummary[];
  counts: { expired: number; critical: number; soon: number; ok: number };
  summary: string;
  nextUnmanaged?: { name: string; namespace?: string | null; daysLeft: number } | null;
  scope: { namespace: string | null };
}

export type DiagnosisSeverity = 'critical' | 'warning' | 'info';

export interface DiagnosisFinding {
  id: string;
  rule: string;
  severity: DiagnosisSeverity;
  title: string;
  detail: string;
  fix?: string | null;
  object: { kind: string; name: string; namespace?: string | null };
  at?: string | null;
  evidence: Array<{ source: string; text: string; at?: string | null }>;
  actions: Array<{
    label: string;
    kind: 'logs' | 'previous-logs' | 'open' | 'events' | 'describe' | 'nodes';
    target?: { kind: string; name: string; namespace?: string | null; container?: string | null } | null;
  }>;
  /** 0 a change someone made, 1 a failure, 2 a symptom, 3 background. */
  cause: number;
  /** Every object this covers. More than one means the same problem on several pods. */
  affected?: string[];
}

export interface Diagnosis {
  findings: DiagnosisFinding[];
  timeline: Array<{
    at: string;
    severity: DiagnosisSeverity;
    title: string;
    detail: string;
    object: { kind: string; name: string; namespace?: string | null };
  }>;
  summary: string;
  healthy: boolean;
  counts: { critical: number; warning: number; info: number };
  scope: { namespace: string | null; kind: string | null; name: string | null };
}

export interface SignInProvider {
  id: 'email' | 'github' | 'google' | 'okta';
  label: string;
  detail: string;
  enterprise: boolean;
  /**
   * Where the button opens, carrying the code this sign-in already has.
   *
   * Null for email, which has nowhere to send a browser except the page with
   * the code on it, and null from a server too old to build one.
   */
  startUri: string | null;
}

export interface SignInPrompt {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
  /** What this person may use, decided by the site rather than fixed here. */
  providers: SignInProvider[];
  /** Set when an organisation allows exactly one way in, and says whose rule it is. */
  enforcement: string | null;
}

export interface SignInResult {
  ok: boolean;
  failure: { error: string; description: string } | null;
  status: AccountStatus;
}

export interface LicenceStatus {
  kind: 'none' | 'valid' | 'grace' | 'expired' | 'invalid' | 'unconfigured';
  tier: 'free' | 'pro';
  email?: string;
  plan?: string;
  expiresAt?: string | null;
  reason?: string;
}

export interface DockerContextInfo {
  name: string;
  endpoint: string;
  supported: boolean;
  reachable: boolean;
  version?: string;
  platform?: string;
  error?: string;
}
export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  imageId: string;
  state: string;
  status: string;
  created: string;
  labels: Record<string, string>;
  project?: string;
  service?: string;
  ports: Array<{ host?: number; container: number; protocol: string; ip?: string }>;
  mounts: Array<{ type: string; source?: string; destination: string }>;
  networks: Array<{ name: string; ip?: string }>;
  cpuPercent?: number;
  memoryBytes?: number;
  memoryLimit?: number;
  rxBytes?: number;
  txBytes?: number;
}
export interface DockerImage {
  id: string;
  tags: string[];
  digests: string[];
  created: string;
  size: number;
  usedBy: string[];
  labels: Record<string, string>;
}
export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  created?: string;
  labels: Record<string, string>;
  usedBy: string[];
}
export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  created: string;
  internal: boolean;
  subnets: string[];
  containers: string[];
}
export interface ScanFinding {
  id: string;
  package: string;
  installed: string;
  fixed: string | null;
  severity: string;
  title: string;
  url: string;
  target: string;
}
export interface ClusterImage {
  image: string;
  /** What to hand a scanner: the digest when the runtime recorded one. */
  target: string;
  digest?: string | null;
  registry: string;
  repository: string;
  tag: string;
  pods: number;
  namespaces: string[];
  usedBy: Array<{ kind: string; name: string; namespace?: string | null; pods: number }>;
  initOnly: boolean;
  /** The spec names a tag that moves, so a clean scan is a weaker promise. */
  mutableTag: boolean;
  report: ScanReport | null;
}

export interface ClusterImages {
  images: ClusterImage[];
  pods: number;
  namespaces: number;
  trivy: boolean;
}

export interface ScanReport {
  cached?: boolean;
  image: string;
  scannedAt: string;
  os?: { Family?: string; Name?: string };
  total: number;
  bySeverity: Record<string, number>;
  fixable: number;
  findings: ScanFinding[];
}

export interface HelmReleaseSummary {
  name: string;
  namespace: string;
  revision: number;
  status: string;
  chart: { name: string; version: string; appVersion?: string; description?: string };
  firstDeployed?: string;
  lastDeployed?: string;
  description?: string;
  secret: string;
}
export interface HelmReleaseFull extends HelmReleaseSummary {
  notes?: string;
  values: Record<string, unknown>;
  manifest: string;
}

export interface StorageConnection {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  pathStyle: boolean;
  source?: { context: string; namespace: string; pod: string; port: number };
}
export interface StorageObject {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
  storageClass?: string;
}

export interface ForwardRecord {
  readonly id: string;
  readonly context: string;
  readonly namespace: string;
  readonly pod: string;
  readonly port: number;
  readonly localPort: number;
  readonly startedAt: string;
  readonly connections: number;
  readonly lastError: string | null;
}

export interface ForwardTarget {
  kind: 'Pod' | 'Service';
  name: string;
  namespace: string;
  /** The pod the connection lands on, which for a Service is one behind it. */
  pod: string;
  ports: Array<{ port: number; name?: string | null; protocol: string }>;
  workload?: string | null;
  /** A guess from the port number. Only ever a hint. */
  hint?: string | null;
}

export const api = {
  clusters: () => request<ClustersResponse>('/api/clusters'),

  reloadClusters: () => request<ClustersResponse>('/api/clusters/reload', { method: 'POST' }),

  clusterStatus: (context: string) =>
    request<ClusterStatus>(`/api/clusters/${encodeURIComponent(context)}/status`),

  kinds: () => request<{ resources: ResourceDefinition[] }>('/api/resources/kinds'),

  /** The kinds one cluster serves: built-ins plus its own custom resources. */
  kindsFor: (context: string, fresh = false) =>
    request<{ resources: ResourceDefinition[]; custom: CustomResource[] }>(
      `/api/resources/kinds/${encodeURIComponent(context)}${fresh ? '?fresh=true' : ''}`,
    ),

  list: <T = Record<string, unknown>>(context: string, kind: string, namespace?: string) => {
    const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return request<ResourceListResponse<T>>(
      `/api/resources/${encodeURIComponent(context)}/${encodeURIComponent(kind)}${query}`,
    );
  },

  get: <T = Record<string, unknown>>(
    context: string,
    kind: string,
    name: string,
    namespace?: string,
  ) => {
    const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return request<T>(
      `/api/resources/${encodeURIComponent(context)}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}${query}`,
    );
  },

  /** Replaces an object with the YAML given. The server parses and PUTs it. */
  apply: (context: string, kind: string, name: string, yamlText: string, namespace?: string) => {
    const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return request<unknown>(
      `/api/resources/${encodeURIComponent(context)}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}${query}`,
      { method: 'PUT', body: JSON.stringify({ yaml: yamlText }) },
    );
  },

  settings: {
    get: () => request<{ settings: AppSettings; path: string; mcpCommand?: string }>('/api/settings'),
    update: (patch: unknown) => request<{ settings: AppSettings }>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
    mcpToken: () => request<{ token: string }>('/api/settings/mcp-token', { method: 'POST', body: '{}' }),
  },
  flags: {
    list: () => request<{ flags: FlagState[]; remote: RemoteFlagStatus; context: Record<string, unknown> }>('/api/flags'),
    set: (id: string, value: boolean | null) => request<{ flags: FlagState[] }>(`/api/flags/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ value }) }),
    refresh: () => request<{ flags: FlagState[]; remote: RemoteFlagStatus }>('/api/flags/refresh', { method: 'POST', body: '{}' }),
    test: (config: { url: string; token: string; environment: string }) =>
      request<{ ok: boolean; count?: number; matched?: string[]; ignored?: string[]; error?: string }>('/api/flags/test', { method: 'POST', body: JSON.stringify(config) }),
  },
  telemetry: {
    get: () => request<TelemetryView>('/api/telemetry'),
    consent: (usage: boolean, crashes: boolean) => request<{ consent: TelemetryView['consent'] }>('/api/telemetry/consent', { method: 'PUT', body: JSON.stringify({ usage, crashes }) }),
    flush: () => request<{ sent: number; error?: string }>('/api/telemetry/flush', { method: 'POST', body: '{}' }),
    clear: () => request<{ ok: boolean }>('/api/telemetry', { method: 'DELETE' }),
    event: (name: string, props: Record<string, unknown> = {}) =>
      request<{ ok: boolean }>('/api/telemetry/event', { method: 'POST', body: JSON.stringify({ name, props }) }).catch(() => ({ ok: false })),
  },
  updates: {
    get: () => request<UpdateView>('/api/updates'),
    preferences: (patch: Partial<AppSettings['updates']>) => request<{ preferences: AppSettings['updates'] }>('/api/updates/preferences', { method: 'PUT', body: JSON.stringify(patch) }),
    check: () => request<{ state: UpdateView['state']; message?: string }>('/api/updates/check', { method: 'POST', body: '{}' }),
    install: () => request<{ ok: boolean }>('/api/updates/install', { method: 'POST', body: '{}' }),
  },
  ai: {
    tools: () => request<{ tools: Array<{ name: string; description: string; kind: 'read' | 'write' }> }>('/api/ai/tools'),
  },
  account: {
    get: () => request<AccountStatus>('/api/account'),
    signIn: (choice: { provider?: SignInProvider['id']; emailHint?: string } = {}) =>
      request<SignInPrompt>('/api/account/sign-in', { method: 'POST', body: JSON.stringify(choice) }),
    /** Resolves when the person approves in their browser, or it expires. */
    wait: () => request<SignInResult>('/api/account/sign-in/wait', { method: 'POST' }),
    cancel: () => request<AccountStatus>('/api/account/sign-in/cancel', { method: 'POST' }),
    signOut: () => request<AccountStatus>('/api/account/sign-out', { method: 'POST' }),
    refresh: () => request<AccountStatus>('/api/account/refresh', { method: 'POST' }),
    devices: () => request<{ devices: AccountDevice[] }>('/api/account/devices'),
    revokeDevice: (id: string) => request<AccountStatus>(`/api/account/devices/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
    billing: () => request<{ url: string; signedIn: boolean; email: string }>('/api/account/billing'),
  },
  licence: {
    get: () => request<LicenceStatus>('/api/licence'),
    activate: (key: string) => request<LicenceStatus>('/api/licence', { method: 'POST', body: JSON.stringify({ key }) }),
    deactivate: () => request<LicenceStatus>('/api/licence', { method: 'DELETE' }),
  },
  kubeconfigs: {
    list: () => request<{ files: string[] }>('/api/clusters/kubeconfigs'),
    add: (body: { path?: string; name?: string; content?: string }) => request<{ files: string[] }>('/api/clusters/kubeconfigs', { method: 'POST', body: JSON.stringify(body) }),
    remove: (path: string) => request<{ files: string[] }>(`/api/clusters/kubeconfigs?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  },
  removeCluster: (name: string, scope: 'hide' | 'kubeconfig') =>
    request<unknown>(`/api/clusters/${encodeURIComponent(name)}?scope=${scope}`, { method: 'DELETE' }),
  unhideCluster: (name: string) => request<unknown>(`/api/clusters/${encodeURIComponent(name)}/unhide`, { method: 'POST', body: '{}' }),

  docker: {
    contexts: () => request<{ contexts: DockerContextInfo[]; current: string }>('/api/docker'),
    containers: (ctx: string) => request<{ containers: DockerContainer[] }>(`/api/docker/${encodeURIComponent(ctx)}/containers`),
    container: (ctx: string, id: string) => request<Record<string, unknown>>(`/api/docker/${encodeURIComponent(ctx)}/containers/${encodeURIComponent(id)}`),
    action: (ctx: string, id: string, action: string) =>
      request<{ ok: boolean }>(`/api/docker/${encodeURIComponent(ctx)}/containers/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' }),
    removeContainer: (ctx: string, id: string, options: { force?: boolean; volumes?: boolean } = {}) =>
      request<{ ok: boolean }>(`/api/docker/${encodeURIComponent(ctx)}/containers/${encodeURIComponent(id)}?force=${options.force ? 'true' : 'false'}&volumes=${options.volumes ? 'true' : 'false'}`, { method: 'DELETE' }),
    images: (ctx: string) => request<{ images: DockerImage[] }>(`/api/docker/${encodeURIComponent(ctx)}/images`),
    removeImage: (ctx: string, id: string, force = false) => request<unknown>(`/api/docker/${encodeURIComponent(ctx)}/images/${encodeURIComponent(id)}?force=${force}`, { method: 'DELETE' }),
    pull: (ctx: string, image: string) => request<{ ok: boolean; status?: string }>(`/api/docker/${encodeURIComponent(ctx)}/images/pull`, { method: 'POST', body: JSON.stringify({ image }) }),
    volumes: (ctx: string) => request<{ volumes: DockerVolume[] }>(`/api/docker/${encodeURIComponent(ctx)}/volumes`),
    removeVolume: (ctx: string, name: string, force = false) => request<unknown>(`/api/docker/${encodeURIComponent(ctx)}/volumes/${encodeURIComponent(name)}?force=${force}`, { method: 'DELETE' }),
    networks: (ctx: string) => request<{ networks: DockerNetwork[] }>(`/api/docker/${encodeURIComponent(ctx)}/networks`),
    removeNetwork: (ctx: string, id: string) => request<unknown>(`/api/docker/${encodeURIComponent(ctx)}/networks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    system: (ctx: string) => request<{ info: Record<string, unknown>; df: Record<string, unknown>; version: Record<string, unknown> }>(`/api/docker/${encodeURIComponent(ctx)}/system`),
    prune: (ctx: string, what: string) => request<{ ok: boolean; reclaimed: number }>(`/api/docker/${encodeURIComponent(ctx)}/prune/${what}`, { method: 'POST', body: '{}' }),
  },
  storage: {
    connections: () => request<{ connections: StorageConnection[] }>('/api/storage/connections'),
    addConnection: (body: Partial<StorageConnection>) => request<{ connection: StorageConnection }>('/api/storage/connections', { method: 'POST', body: JSON.stringify(body) }),
    removeConnection: (id: string) => request<{ ok: boolean }>(`/api/storage/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    buckets: (id: string) => request<{ buckets: Array<{ name: string; created: string }> }>(`/api/storage/connections/${encodeURIComponent(id)}/buckets`),
    createBucket: (id: string, name: string) => request<{ ok: boolean }>(`/api/storage/connections/${encodeURIComponent(id)}/buckets`, { method: 'POST', body: JSON.stringify({ name }) }),
    objects: (id: string, bucket: string, prefix: string, token?: string) =>
      request<{ objects: StorageObject[]; prefixes: string[]; next?: string }>(`/api/storage/connections/${encodeURIComponent(id)}/buckets/${encodeURIComponent(bucket)}/objects?prefix=${encodeURIComponent(prefix)}${token ? `&token=${encodeURIComponent(token)}` : ''}`),
    /**
     * A URL for an object.
     *
     * `inline` limits the read to the first few megabytes, for a text
     * preview. `download` decides what the browser does with it. They are
     * separate because a PDF wants every byte *and* to be rendered, and one
     * flag could not say that: it is why PDFs downloaded instead of opening.
     */
    objectUrl: (id: string, bucket: string, key: string, inline = false, download = false) =>
      `${base()}/api/storage/connections/${encodeURIComponent(id)}/buckets/${encodeURIComponent(bucket)}/object?key=${encodeURIComponent(key)}${inline ? '&inline=1' : ''}${download ? '&download=1' : ''}`,
    head: (id: string, bucket: string, key: string) => request<{ size: number; type: string; lastModified: string }>(`/api/storage/connections/${encodeURIComponent(id)}/buckets/${encodeURIComponent(bucket)}/head?key=${encodeURIComponent(key)}`),
    upload: async (id: string, bucket: string, key: string, file: Blob) => {
      const response = await fetch(`${base()}/api/storage/connections/${encodeURIComponent(id)}/buckets/${encodeURIComponent(bucket)}/object?key=${encodeURIComponent(key)}`, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? response.statusText);
      return (await response.json()) as { ok: boolean; size: number };
    },
    remove: (id: string, bucket: string, key: string) => request<{ ok: boolean }>(`/api/storage/connections/${encodeURIComponent(id)}/buckets/${encodeURIComponent(bucket)}/object?key=${encodeURIComponent(key)}`, { method: 'DELETE' }),
    presign: (id: string, bucket: string, key: string, expires: number) => request<{ url: string; expires: number }>(`/api/storage/connections/${encodeURIComponent(id)}/buckets/${encodeURIComponent(bucket)}/presign`, { method: 'POST', body: JSON.stringify({ key, expires }) }),
  },
  helm: {
    releases: (context: string, namespace?: string) => request<{ releases: HelmReleaseSummary[] }>(`/api/helm/${encodeURIComponent(context)}/releases${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`),
    release: (context: string, namespace: string, name: string, revision?: number) =>
      request<{ release: HelmReleaseFull; history: HelmReleaseSummary[] }>(`/api/helm/${encodeURIComponent(context)}/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}${revision ? `?revision=${revision}` : ''}`),
  },
  drift: {
    check: (context: string, kind: string, name: string, namespace?: string) =>
      request<DriftResult>(
        `/api/drift/${encodeURIComponent(context)}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`,
      ),
  },

  certificates: {
    list: (context: string, namespace?: string) =>
      request<CertificateReport>(
        `/api/certificates/${encodeURIComponent(context)}${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`,
      ),
  },

  diagnose: {
    /**
     * What broke, for the cluster, a namespace, or one workload.
     *
     * Scoped by query rather than by path because the scope is genuinely
     * optional at every level: "what broke in this cluster" is the question
     * people ask first and it takes no arguments at all.
     */
    run: (context: string, scope: { namespace?: string; kind?: string; name?: string } = {}) => {
      const query = new URLSearchParams();
      if (scope.namespace) query.set('namespace', scope.namespace);
      if (scope.kind) query.set('kind', scope.kind);
      if (scope.name) query.set('name', scope.name);
      const search = query.toString();
      return request<Diagnosis>(`/api/diagnose/${encodeURIComponent(context)}${search ? `?${search}` : ''}`);
    },
  },

  scan: {
    status: () => request<{ available: boolean; path: string | null; install: string }>('/api/scan'),
    image: (image: string, force = false) => request<ScanReport>('/api/scan/image', { method: 'POST', body: JSON.stringify({ image, force }) }),
    /** Every distinct image the cluster runs, with any scan already in hand. */
    cluster: (context: string, namespace?: string) =>
      request<ClusterImages>(
        `/api/scan/cluster/${encodeURIComponent(context)}${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`,
      ),
  },

  forwards: {
    list: () => request<{ forwards: ForwardRecord[] }>('/api/forwards'),
    start: (body: { context: string; namespace: string; pod: string; port: number; localPort?: number }) =>
      request<ForwardRecord>('/api/forwards', { method: 'POST', body: JSON.stringify(body) }),
    stop: (id: string) => request<{ ok: boolean }>(`/api/forwards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    /** Everything in the cluster with a port, so the panel can offer it. */
    targets: (context: string, namespace?: string) =>
      request<{ targets: ForwardTarget[] }>(
        `/api/forwards/targets/${encodeURIComponent(context)}${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`,
      ),
  },

  /** Creates an object from YAML, `kubectl create -f`. */
  create: (context: string, kind: string, yamlText: string, namespace?: string) => {
    const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return request<unknown>(`/api/resources/${encodeURIComponent(context)}/${encodeURIComponent(kind)}${query}`, {
      method: 'POST',
      body: JSON.stringify({ yaml: yamlText }),
    });
  },

  /** Evicts a pod through the Eviction API, so disruption budgets apply. */
  evict: (context: string, namespace: string, pod: string) =>
    request<unknown>(
      `/api/resources/${encodeURIComponent(context)}/Pod/${encodeURIComponent(pod)}/evict?namespace=${encodeURIComponent(namespace)}`,
      { method: 'POST', body: '{}' },
    ),

  /** JSON merge patch: send only what changes; null removes a key. */
  patch: (context: string, kind: string, name: string, patch: unknown, namespace?: string) => {
    const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return request<unknown>(
      `/api/resources/${encodeURIComponent(context)}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}${query}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  },

  remove: (context: string, kind: string, name: string, namespace?: string) => {
    const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return request<unknown>(
      `/api/resources/${encodeURIComponent(context)}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}${query}`,
      { method: 'DELETE' },
    );
  },

  logs: (
    context: string,
    namespace: string,
    pod: string,
    options: { container?: string; previous?: boolean; tailLines?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.container) params.set('container', options.container);
    if (options.previous) params.set('previous', 'true');
    if (options.tailLines !== undefined) params.set('tailLines', String(options.tailLines));
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<{ lines: LogLineWire[] }>(
      `/api/logs/${encodeURIComponent(context)}/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}${query}`,
    );
  },
};

/** WebSocket URL for the log stream, respecting an injected API origin. */
export function execSocketUrl(): string {
  return logSocketUrl().replace(/\/ws\/logs$/, '/ws/exec');
}

export function logSocketUrl(): string {
  const origin = base();
  if (origin) return `${origin.replace(/^http/, 'ws')}/ws/logs`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/logs`;
}
