import type { ClusterContext, ResourceDefinition, WatchState } from '@mjolnir/k8s';
export type ErrorCode = 'bad-request' | 'auth' | 'not-found' | 'upstream' | 'internal';
export declare class ApiError extends Error {
    readonly code: ErrorCode;
    readonly status: number;
    constructor(code: ErrorCode, message: string, status: number);
    /** The cue to offer a session refresh rather than show a failure. */
    get isAuth(): boolean;
}
export interface ClustersResponse {
    readonly hidden?: string[];
    readonly contexts: ClusterContext[];
    readonly currentContext: string | null;
    readonly failures: Array<{
        path: string;
        error: string;
    }>;
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
    general: {
        showSystemNamespaces: boolean;
        defaultNamespace: string;
    };
    clusters: {
        hidden: string[];
        kubeconfigs: string[];
        perContext: Record<string, {
            namespace?: string;
            namespaces?: string[];
            label?: string;
            color?: string;
        }>;
    };
    ai: {
        provider: 'anthropic' | 'openai';
        preset: string;
        baseUrl: string;
        apiKey: string;
        model: string;
        allowWrites: boolean;
        instructions: string;
    };
    mcp: {
        http: boolean;
        token: string;
        allowWrites: boolean;
    };
    licence: {
        key: string;
    };
    install: {
        id: string;
        firstRun: string;
    };
    flags: {
        overrides: Record<string, boolean>;
        remote: {
            enabled: boolean;
            url: string;
            token: string;
            environment: string;
            refreshSeconds: number;
        };
    };
    telemetry: {
        usage: boolean;
        crashes: boolean;
        decided: boolean;
    };
    updates: {
        channel: 'stable' | 'beta';
        automatic: boolean;
        checkOnLaunch: boolean;
        skipped: string;
    };
    onboarding: {
        completed: boolean;
        step: string;
        version: number;
    };
}
/** A kind this cluster defines, discovered from its CustomResourceDefinitions. */
export interface CustomResource extends ResourceDefinition {
    definition: string;
    shortNames: string[];
    versions: string[];
    columns: Array<{
        name: string;
        jsonPath: string;
        type: string;
        priority?: number;
    }>;
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
    consent: {
        usage: boolean;
        crashes: boolean;
        decided: boolean;
    };
    catalogue: Array<{
        name: string;
        strings: Record<string, string[]>;
        numbers: string[];
    }>;
    queue: unknown[];
    envelope: Record<string, unknown>;
    lastSend?: string;
    lastError?: string;
}
export interface UpdateView {
    version: string;
    feed: string;
    preferences: AppSettings['updates'];
    state: {
        status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'current' | 'error' | 'unsupported';
        version?: string;
        percent?: number;
        error?: string;
        checkedAt?: string;
    };
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
    ports: Array<{
        host?: number;
        container: number;
        protocol: string;
        ip?: string;
    }>;
    mounts: Array<{
        type: string;
        source?: string;
        destination: string;
    }>;
    networks: Array<{
        name: string;
        ip?: string;
    }>;
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
export interface ScanReport {
    cached?: boolean;
    image: string;
    scannedAt: string;
    os?: {
        Family?: string;
        Name?: string;
    };
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
    chart: {
        name: string;
        version: string;
        appVersion?: string;
        description?: string;
    };
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
    source?: {
        context: string;
        namespace: string;
        pod: string;
        port: number;
    };
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
export declare const api: {
    clusters: () => Promise<ClustersResponse>;
    reloadClusters: () => Promise<ClustersResponse>;
    clusterStatus: (context: string) => Promise<ClusterStatus>;
    kinds: () => Promise<{
        resources: ResourceDefinition[];
    }>;
    /** The kinds one cluster serves: built-ins plus its own custom resources. */
    kindsFor: (context: string, fresh?: boolean) => Promise<{
        resources: ResourceDefinition[];
        custom: CustomResource[];
    }>;
    list: <T = Record<string, unknown>>(context: string, kind: string, namespace?: string) => Promise<ResourceListResponse<T>>;
    get: <T = Record<string, unknown>>(context: string, kind: string, name: string, namespace?: string) => Promise<T>;
    /** Replaces an object with the YAML given. The server parses and PUTs it. */
    apply: (context: string, kind: string, name: string, yamlText: string, namespace?: string) => Promise<unknown>;
    settings: {
        get: () => Promise<{
            settings: AppSettings;
            path: string;
            mcpCommand?: string;
        }>;
        update: (patch: unknown) => Promise<{
            settings: AppSettings;
        }>;
        mcpToken: () => Promise<{
            token: string;
        }>;
    };
    flags: {
        list: () => Promise<{
            flags: FlagState[];
            remote: RemoteFlagStatus;
            context: Record<string, unknown>;
        }>;
        set: (id: string, value: boolean | null) => Promise<{
            flags: FlagState[];
        }>;
        refresh: () => Promise<{
            flags: FlagState[];
            remote: RemoteFlagStatus;
        }>;
        test: (config: {
            url: string;
            token: string;
            environment: string;
        }) => Promise<{
            ok: boolean;
            count?: number;
            matched?: string[];
            ignored?: string[];
            error?: string;
        }>;
    };
    telemetry: {
        get: () => Promise<TelemetryView>;
        consent: (usage: boolean, crashes: boolean) => Promise<{
            consent: TelemetryView['consent'];
        }>;
        flush: () => Promise<{
            sent: number;
            error?: string;
        }>;
        clear: () => Promise<{
            ok: boolean;
        }>;
        event: (name: string, props?: Record<string, unknown>) => Promise<{
            ok: boolean;
        } | {
            ok: boolean;
        }>;
    };
    updates: {
        get: () => Promise<UpdateView>;
        preferences: (patch: Partial<AppSettings['updates']>) => Promise<{
            preferences: AppSettings['updates'];
        }>;
        check: () => Promise<{
            state: UpdateView['state'];
            message?: string;
        }>;
        install: () => Promise<{
            ok: boolean;
        }>;
    };
    ai: {
        tools: () => Promise<{
            tools: Array<{
                name: string;
                description: string;
                kind: 'read' | 'write';
            }>;
        }>;
    };
    licence: {
        get: () => Promise<LicenceStatus>;
        activate: (key: string) => Promise<LicenceStatus>;
        deactivate: () => Promise<LicenceStatus>;
    };
    kubeconfigs: {
        list: () => Promise<{
            files: string[];
        }>;
        add: (body: {
            path?: string;
            name?: string;
            content?: string;
        }) => Promise<{
            files: string[];
        }>;
        remove: (path: string) => Promise<{
            files: string[];
        }>;
    };
    removeCluster: (name: string, scope: 'hide' | 'kubeconfig') => Promise<unknown>;
    unhideCluster: (name: string) => Promise<unknown>;
    docker: {
        contexts: () => Promise<{
            contexts: DockerContextInfo[];
            current: string;
        }>;
        containers: (ctx: string) => Promise<{
            containers: DockerContainer[];
        }>;
        container: (ctx: string, id: string) => Promise<Record<string, unknown>>;
        action: (ctx: string, id: string, action: string) => Promise<{
            ok: boolean;
        }>;
        removeContainer: (ctx: string, id: string, options?: {
            force?: boolean;
            volumes?: boolean;
        }) => Promise<{
            ok: boolean;
        }>;
        images: (ctx: string) => Promise<{
            images: DockerImage[];
        }>;
        removeImage: (ctx: string, id: string, force?: boolean) => Promise<unknown>;
        pull: (ctx: string, image: string) => Promise<{
            ok: boolean;
            status?: string;
        }>;
        volumes: (ctx: string) => Promise<{
            volumes: DockerVolume[];
        }>;
        removeVolume: (ctx: string, name: string, force?: boolean) => Promise<unknown>;
        networks: (ctx: string) => Promise<{
            networks: DockerNetwork[];
        }>;
        removeNetwork: (ctx: string, id: string) => Promise<unknown>;
        system: (ctx: string) => Promise<{
            info: Record<string, unknown>;
            df: Record<string, unknown>;
            version: Record<string, unknown>;
        }>;
        prune: (ctx: string, what: string) => Promise<{
            ok: boolean;
            reclaimed: number;
        }>;
    };
    storage: {
        connections: () => Promise<{
            connections: StorageConnection[];
        }>;
        addConnection: (body: Partial<StorageConnection>) => Promise<{
            connection: StorageConnection;
        }>;
        removeConnection: (id: string) => Promise<{
            ok: boolean;
        }>;
        buckets: (id: string) => Promise<{
            buckets: Array<{
                name: string;
                created: string;
            }>;
        }>;
        createBucket: (id: string, name: string) => Promise<{
            ok: boolean;
        }>;
        objects: (id: string, bucket: string, prefix: string, token?: string) => Promise<{
            objects: StorageObject[];
            prefixes: string[];
            next?: string;
        }>;
        objectUrl: (id: string, bucket: string, key: string, inline?: boolean) => string;
        head: (id: string, bucket: string, key: string) => Promise<{
            size: number;
            type: string;
            lastModified: string;
        }>;
        upload: (id: string, bucket: string, key: string, file: Blob) => Promise<{
            ok: boolean;
            size: number;
        }>;
        remove: (id: string, bucket: string, key: string) => Promise<{
            ok: boolean;
        }>;
        presign: (id: string, bucket: string, key: string, expires: number) => Promise<{
            url: string;
            expires: number;
        }>;
    };
    helm: {
        releases: (context: string, namespace?: string) => Promise<{
            releases: HelmReleaseSummary[];
        }>;
        release: (context: string, namespace: string, name: string, revision?: number) => Promise<{
            release: HelmReleaseFull;
            history: HelmReleaseSummary[];
        }>;
    };
    scan: {
        status: () => Promise<{
            available: boolean;
            path: string | null;
            install: string;
        }>;
        image: (image: string, force?: boolean) => Promise<ScanReport>;
    };
    forwards: {
        list: () => Promise<{
            forwards: ForwardRecord[];
        }>;
        start: (body: {
            context: string;
            namespace: string;
            pod: string;
            port: number;
            localPort?: number;
        }) => Promise<ForwardRecord>;
        stop: (id: string) => Promise<{
            ok: boolean;
        }>;
    };
    /** Creates an object from YAML, `kubectl create -f`. */
    create: (context: string, kind: string, yamlText: string, namespace?: string) => Promise<unknown>;
    /** Evicts a pod through the Eviction API, so disruption budgets apply. */
    evict: (context: string, namespace: string, pod: string) => Promise<unknown>;
    /** JSON merge patch: send only what changes; null removes a key. */
    patch: (context: string, kind: string, name: string, patch: unknown, namespace?: string) => Promise<unknown>;
    remove: (context: string, kind: string, name: string, namespace?: string) => Promise<unknown>;
    logs: (context: string, namespace: string, pod: string, options?: {
        container?: string;
        previous?: boolean;
        tailLines?: number;
    }) => Promise<{
        lines: LogLineWire[];
    }>;
};
/** WebSocket URL for the log stream, respecting an injected API origin. */
export declare function execSocketUrl(): string;
export declare function logSocketUrl(): string;
//# sourceMappingURL=api.d.ts.map