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
        perContext: Record<string, {
            namespace?: string;
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
}
export interface LicenceStatus {
    kind: 'none' | 'valid' | 'grace' | 'expired' | 'invalid' | 'unconfigured';
    tier: 'free' | 'pro';
    email?: string;
    plan?: string;
    expiresAt?: string | null;
    reason?: string;
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
    removeCluster: (name: string, scope: 'hide' | 'kubeconfig') => Promise<unknown>;
    unhideCluster: (name: string) => Promise<unknown>;
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
export declare function logSocketUrl(): string;
//# sourceMappingURL=api.d.ts.map