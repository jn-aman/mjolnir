import type { ClusterContext, ResourceDefinition, WatchState } from '@mjolnir/k8s';

/**
 * Client for the local API.
 *
 * The server binds to loopback and the desktop shell injects its port, so there
 * is no base URL to configure and no auth to carry — the only thing that can
 * reach it is this window.
 */

const base = (): string => {
  const injected = (globalThis as { __MJOLNIR_API__?: string }).__MJOLNIR_API__;
  return injected ?? '';
};

export type ErrorCode = 'bad-request' | 'auth' | 'not-found' | 'upstream' | 'internal';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
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

export const api = {
  clusters: () => request<ClustersResponse>('/api/clusters'),

  reloadClusters: () => request<ClustersResponse>('/api/clusters/reload', { method: 'POST' }),

  clusterStatus: (context: string) =>
    request<ClusterStatus>(`/api/clusters/${encodeURIComponent(context)}/status`),

  kinds: () => request<{ resources: ResourceDefinition[] }>('/api/resources/kinds'),

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
export function logSocketUrl(): string {
  const origin = base();
  if (origin) return `${origin.replace(/^http/, 'ws')}/ws/logs`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/logs`;
}
