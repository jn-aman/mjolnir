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
export declare const api: {
    clusters: () => Promise<ClustersResponse>;
    reloadClusters: () => Promise<ClustersResponse>;
    clusterStatus: (context: string) => Promise<ClusterStatus>;
    kinds: () => Promise<{
        resources: ResourceDefinition[];
    }>;
    list: <T = Record<string, unknown>>(context: string, kind: string, namespace?: string) => Promise<ResourceListResponse<T>>;
    get: <T = Record<string, unknown>>(context: string, kind: string, name: string, namespace?: string) => Promise<T>;
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