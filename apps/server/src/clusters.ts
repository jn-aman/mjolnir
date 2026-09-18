import type { KubeConfig } from '@kubernetes/client-node';
import {
  ClusterTransport,
  type ClusterContext,
  ResourceWatch,
  type ResourceDefinition,
  configForContext,
  loadKubeconfig,
} from '@odin/k8s';
import { logger } from '@odin/logger';

const log = logger.child('clusters');

/** One connected cluster: its pinned config, transport, and live watches. */
class Connection {
  readonly transport: ClusterTransport;
  readonly #watches = new Map<string, ResourceWatch>();

  constructor(
    readonly context: ClusterContext,
    readonly config: KubeConfig,
  ) {
    this.transport = new ClusterTransport(config);
  }

  /**
   * A watch for one kind, created on first use and shared thereafter.
   *
   * Sharing matters: two screens showing pods must not open two watches against
   * the same collection. The API server tracks every watch, and a UI that opens
   * one per component is how a dashboard ends up rate-limited on a large
   * cluster.
   */
  watch(resource: ResourceDefinition, namespace?: string): ResourceWatch {
    const key = `${resource.kind}/${namespace ?? '*'}`;
    const existing = this.#watches.get(key);
    if (existing) return existing;

    const created = new ResourceWatch({
      config: this.config,
      transport: this.transport,
      resource,
      ...(namespace ? { namespace } : {}),
    });
    this.#watches.set(key, created);
    void created.start();
    return created;
  }

  async close(): Promise<void> {
    await Promise.all([...this.#watches.values()].map((watch) => watch.stop()));
    this.#watches.clear();
  }
}

/**
 * Holds every cluster the user has open.
 *
 * Connections are lazy — loading a kubeconfig with forty contexts must not open
 * forty connections, because most of them are clusters the user is not looking
 * at and some are unreachable VPN-only endpoints that would each cost a
 * timeout.
 */
export class ClusterRegistry {
  #contexts: ClusterContext[] = [];
  #current: string | null = null;
  #failures: Array<{ path: string; error: string }> = [];
  #kubeconfig: KubeConfig | null = null;
  readonly #connections = new Map<string, Connection>();

  async reload(): Promise<void> {
    const result = await loadKubeconfig();
    this.#kubeconfig = result.config;
    this.#contexts = result.contexts;
    this.#current = result.currentContext;
    this.#failures = result.failures;

    // Drop connections whose context vanished from the kubeconfig.
    const names = new Set(result.contexts.map((context) => context.name));
    for (const [name, connection] of this.#connections) {
      if (!names.has(name)) {
        this.#connections.delete(name);
        void connection.close();
      }
    }

    log.info('kubeconfig loaded', {
      contexts: this.#contexts.length,
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

  /** Connect on demand, reusing an existing connection. */
  connect(contextName: string): Connection {
    const existing = this.#connections.get(contextName);
    if (existing) return existing;

    if (!this.#kubeconfig) throw new Error('kubeconfig has not been loaded');
    const context = this.#contexts.find((entry) => entry.name === contextName);
    if (!context) throw new Error(`unknown context: ${contextName}`);

    const connection = new Connection(context, configForContext(this.#kubeconfig, contextName));
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

export type { Connection };
