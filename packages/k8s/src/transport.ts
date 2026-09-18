import type { KubeConfig } from '@kubernetes/client-node';
import { logger } from '@odin/logger';
import https from 'node:https';
import http from 'node:http';
import type { Readable } from 'node:stream';

const log = logger.child('transport');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${status} on ${path}: ${summarize(body)}`);
    this.name = 'ApiError';
  }

  /** The object is gone, or was never there. Callers usually render empty, not an error. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Credentials are missing, expired or insufficient — the cue to offer a session refresh. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Kubernetes returns a Status object on error; its `message` is the useful part. */
function summarize(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const { message } = parsed as { message?: unknown };
      if (typeof message === 'string') return message;
    }
  } catch {
    /* fall through to the raw body */
  }
  return body.slice(0, 500);
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: string;
  readonly contentType?: string;
  readonly signal?: AbortSignal;
}

function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const rendered = params.toString();
  return rendered === '' ? '' : `?${rendered}`;
}

/**
 * Authenticated HTTP to one cluster's API server.
 *
 * This sits below the generated API clients on purpose. Two things Odin needs
 * are awkward through them: listing an arbitrary group/version/plural with one
 * code path for core and non-core resources, and holding a log response open as
 * a stream. Both are trivial against the raw agent that `applyToHTTPSOptions`
 * configures, and both are load-bearing here.
 */
export class ClusterTransport {
  readonly #config: KubeConfig;

  constructor(config: KubeConfig) {
    this.#config = config;
  }

  get server(): string {
    const cluster = this.#config.getCurrentCluster();
    if (!cluster?.server) throw new Error('kubeconfig has no server for the current context');
    return cluster.server.replace(/\/+$/, '');
  }

  /** Open a request and hand back the live response stream. Used for logs and watches. */
  async stream(path: string, options: RequestOptions = {}): Promise<Readable> {
    const url = new URL(`${this.server}${path}${buildQuery(options.query)}`);
    const requestOptions: https.RequestOptions = {
      method: options.method ?? 'GET',
      host: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers: {},
    };
    await this.#config.applyToHTTPSOptions(requestOptions);

    if (options.body !== undefined) {
      requestOptions.headers = {
        ...requestOptions.headers,
        'content-type': options.contentType ?? 'application/json',
        'content-length': Buffer.byteLength(options.body).toString(),
      };
    }

    const transport = url.protocol === 'http:' ? http : https;

    return new Promise<Readable>((resolve, reject) => {
      const request = transport.request(requestOptions, (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          resolve(response);
          return;
        }
        // Drain the error body before rejecting; leaving it unread keeps the
        // socket out of the agent's pool until it times out.
        collect(response)
          .then((body) => reject(new ApiError(status, path, body)))
          .catch(() => reject(new ApiError(status, path, '')));
      });

      request.on('error', reject);

      if (options.signal) {
        if (options.signal.aborted) {
          request.destroy();
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        options.signal.addEventListener('abort', () => request.destroy(), { once: true });
      }

      if (options.body !== undefined) request.write(options.body);
      request.end();
    });
  }

  /** Read a whole response as text. */
  async text(path: string, options: RequestOptions = {}): Promise<string> {
    const response = await this.stream(path, options);
    return collect(response);
  }

  /** Read and parse a whole JSON response. Validation is the caller's job. */
  async json<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const body = await this.text(path, options);
    try {
      return JSON.parse(body) as T;
    } catch (error) {
      log.error('API returned a non-JSON body', { path, error });
      throw new ApiError(200, path, body);
    }
  }
}

function collect(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}
