import type { Duplex } from 'node:stream';
import { PortForward } from '@kubernetes/client-node';
import type { KubeConfig } from '@kubernetes/client-node';
import {
  ClusterTransport,
  type ClusterContext,
  type LogLine,
  type LogStreamOptions,
  ResourceWatch,
  type ResourceDefinition,
  type WatchSnapshot,
  configForContext,
  loadKubeconfig,
  readPodLogs,
  streamPodLogs,
} from '@mjolnir/k8s';
import { DEMO_CONTEXT, DemoTransport, DemoWatch, demoContainers, streamDemoLogs } from '@mjolnir/demo';
import { logger } from '@mjolnir/logger';

const log = logger.child('clusters');

/**
 * What a route needs from a cluster, real or synthetic.
 *
 * Log streaming lives on the connection rather than beside it so that no route
 * ever asks "is this the demo cluster?". A branch like that starts in one place
 * and ends up in nine, and then the demo drifts from the real thing and stops
 * being worth testing against.
 */
export interface ClusterConnection {
  readonly context: ClusterContext;
  json<T = unknown>(path: string): Promise<T>;
  /** PUT a whole object. Returns what the API server stored. */
  replace<T = unknown>(path: string, body: unknown): Promise<T>;
  /** DELETE an object. The API server answers with a Status or the object. */
  remove<T = unknown>(path: string): Promise<T>;
  /** JSON merge patch (RFC 7386): only the fields given change. */
  patch<T = unknown>(path: string, body: unknown): Promise<T>;
  /** POST: a new object into a collection, or a subresource such as eviction. */
  create<T = unknown>(path: string, body: unknown): Promise<T>;
  /** Pipes one TCP connection to a pod port, the wire behind `kubectl port-forward`. */
  forward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void>;
  watch(resource: ResourceDefinition, namespace?: string): ResourceSource;
  streamLogs(options: LogStreamOptions): AsyncGenerator<LogLine, void, undefined>;
  readLogs(options: Omit<LogStreamOptions, 'follow'>): Promise<LogLine[]>;
  close(): Promise<void>;
}

/** The watch surface routes depend on. Both the real and demo watches satisfy it. */
export interface ResourceSource {
  snapshot(): WatchSnapshot<never>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

class LiveConnection implements ClusterConnection {
  readonly #transport: ClusterTransport;
  readonly #watches = new Map<string, ResourceWatch>();

  constructor(
    readonly context: ClusterContext,
    readonly config: KubeConfig,
  ) {
    this.#transport = new ClusterTransport(config);
  }

  json<T = unknown>(path: string): Promise<T> {
    return this.#transport.json<T>(path);
  }

  replace<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.json<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  remove<T = unknown>(path: string): Promise<T> {
    return this.#transport.json<T>(path, { method: 'DELETE' });
  }

  patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.json<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
      contentType: 'application/merge-patch+json',
    });
  }

  create<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.json<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      contentType: 'application/json',
    });
  }

  async forward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void> {
    const forwarder = new PortForward(this.config);
    await forwarder.portForward(namespace, pod, [port], socket, null, socket);
  }

  /**
   * One watch per kind, shared.
   *
   * Two screens showing pods must not open two watches against the same
   * collection: the API server tracks every watch, and a UI that opens one per
   * component is how a dashboard gets itself rate-limited on a large cluster.
   */
  watch(resource: ResourceDefinition, namespace?: string): ResourceSource {
    const key = `${resource.kind}/${namespace ?? '*'}`;
    const existing = this.#watches.get(key);
    if (existing) return existing as unknown as ResourceSource;

    const created = new ResourceWatch({
      config: this.config,
      transport: this.#transport,
      resource,
      ...(namespace ? { namespace } : {}),
    });
    this.#watches.set(key, created);
    void created.start();
    return created as unknown as ResourceSource;
  }

  streamLogs(options: LogStreamOptions): AsyncGenerator<LogLine, void, undefined> {
    return streamPodLogs(this.#transport, options);
  }

  readLogs(options: Omit<LogStreamOptions, 'follow'>): Promise<LogLine[]> {
    return readPodLogs(this.#transport, options);
  }

  async close(): Promise<void> {
    await Promise.all([...this.#watches.values()].map((watch) => watch.stop()));
    this.#watches.clear();
  }
}

class DemoConnection implements ClusterConnection {
  readonly context: ClusterContext = {
    name: DEMO_CONTEXT,
    cluster: DEMO_CONTEXT,
    user: DEMO_CONTEXT,
    namespace: 'payments',
    source: '(built in)',
    server: 'https://demo.mjolnir.local',
    provider: 'other',
  };

  readonly #transport = new DemoTransport();
  readonly #watches = new Map<string, DemoWatch>();

  json<T = unknown>(path: string): Promise<T> {
    return this.#transport.json<T>(path);
  }

  // Writes land in the demo store, so what you did is what you see next.
  replace<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.replace<T>(path, body);
  }

  remove<T = unknown>(path: string): Promise<T> {
    return this.#transport.remove<T>(path);
  }

  patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.patch<T>(path, body);
  }

  create<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.create<T>(path, body);
  }

  async forward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void> {
    // The demo pod answers every request with one page, so the forward can be
    // opened in a browser and seen to work.
    socket.once('data', () => {
      const body = `<!doctype html><title>${pod}</title><body style="font:14px system-ui;padding:32px"><h1>${pod}:${port}</h1><p>Forwarded from the Mjolnir demo cluster (${namespace}).</p></body>`;
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    });
  }

  watch(resource: ResourceDefinition, namespace?: string): ResourceSource {
    const key = `${resource.kind}/${namespace ?? '*'}`;
    const existing = this.#watches.get(key);
    if (existing) return existing as unknown as ResourceSource;

    const created = new DemoWatch({ resource, ...(namespace ? { namespace } : {}) });
    this.#watches.set(key, created);
    void created.start();
    return created as unknown as ResourceSource;
  }

  streamLogs(options: LogStreamOptions): AsyncGenerator<LogLine, void, undefined> {
    const containers = demoContainers(options.namespace, options.pod);
    return streamDemoLogs({
      namespace: options.namespace,
      pod: options.pod,
      container: options.container ?? containers[0] ?? '',
      ...(options.follow !== undefined ? { follow: options.follow } : {}),
      ...(options.previous !== undefined ? { previous: options.previous } : {}),
      ...(options.tailLines !== undefined ? { tailLines: options.tailLines } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  async readLogs(options: Omit<LogStreamOptions, 'follow'>): Promise<LogLine[]> {
    const lines: LogLine[] = [];
    for await (const line of this.streamLogs({ ...options, follow: false })) lines.push(line);
    return lines;
  }

  async close(): Promise<void> {
    await Promise.all([...this.#watches.values()].map((watch) => watch.stop()));
    this.#watches.clear();
  }
}

/**
 * Every cluster the user has open.
 *
 * Connections are lazy, a kubeconfig with forty contexts must not open forty
 * connections, because most are clusters nobody is looking at and some are
 * VPN-only endpoints that would each cost a timeout.
 */
export class ClusterRegistry {
  #contexts: ClusterContext[] = [];
  #current: string | null = null;
  #failures: Array<{ path: string; error: string }> = [];
  #kubeconfig: KubeConfig | null = null;
  readonly #connections = new Map<string, ClusterConnection>();

  async reload(): Promise<void> {
    const result = await loadKubeconfig();
    this.#kubeconfig = result.config;
    this.#failures = result.failures;

    // The demo cluster is always present. Someone evaluating the app should
    // never have to point it at production to find out whether it is any good.
    const demo = new DemoConnection();
    this.#contexts = [demo.context, ...result.contexts];
    this.#current = result.currentContext ?? DEMO_CONTEXT;

    const names = new Set(this.#contexts.map((context) => context.name));
    for (const [name, connection] of this.#connections) {
      if (!names.has(name)) {
        this.#connections.delete(name);
        void connection.close();
      }
    }

    log.info('kubeconfig loaded', {
      contexts: result.contexts.length,
      current: this.#current,
      failures: this.#failures.length,
    });
  }

  get contexts(): readonly ClusterContext[] {
    return this.#contexts;
  }

  get currentContext(): string | null {
    return this.#current;
  }

  get failures(): ReadonlyArray<{ path: string; error: string }> {
    return this.#failures;
  }

  connect(contextName: string): ClusterConnection {
    const existing = this.#connections.get(contextName);
    if (existing) return existing;

    if (contextName === DEMO_CONTEXT) {
      const demo = new DemoConnection();
      this.#connections.set(contextName, demo);
      return demo;
    }

    if (!this.#kubeconfig) throw new Error('kubeconfig has not been loaded');
    const context = this.#contexts.find((entry) => entry.name === contextName);
    if (!context) throw new Error(`unknown context: ${contextName}`);

    const connection = new LiveConnection(context, configForContext(this.#kubeconfig, contextName));
    this.#connections.set(contextName, connection);
    log.info('connected to cluster', { context: contextName, provider: context.provider });
    return connection;
  }

  async disconnect(contextName: string): Promise<void> {
    const connection = this.#connections.get(contextName);
    if (!connection) return;
    this.#connections.delete(contextName);
    await connection.close();
  }

  async shutdown(): Promise<void> {
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    await Promise.all(connections.map((connection) => connection.close()));
  }
}
