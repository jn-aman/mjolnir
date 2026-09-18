import type { KubeObject } from '@mjolnir/schemas';
import type { ResourceDefinition, WatchListener, WatchSnapshot, WatchState } from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';
import { demoStore, mergePatch } from './store.ts';

const log = logger.child('demo');

/**
 * A watch over the synthetic cluster.
 *
 * Matches the real `ResourceWatch` surface exactly, so nothing above it knows
 * the difference. It also *changes over time*, the crash-looper's restart
 * count climbs, because a frozen fixture hides every bug that only shows when
 * data moves underneath the UI, which is most of the interesting ones.
 */
export class DemoWatch<T extends KubeObject = KubeObject> {
  readonly #resource: ResourceDefinition;
  readonly #namespace: string | undefined;
  readonly #listeners = new Set<WatchListener<T>>();

  #state: WatchState = 'idle';
  #updatedAt: Date | null = null;
  #timer: NodeJS.Timeout | null = null;
  #restarts = 14;

  constructor(options: { resource: ResourceDefinition; namespace?: string }) {
    this.#resource = options.resource;
    this.#namespace = options.namespace;
  }

  get state(): WatchState {
    return this.#state;
  }

  items(): readonly T[] {
    const scoped = demoStore.list(this.#resource.plural, this.#resource.namespaced ? this.#namespace : undefined);

    if (this.#resource.plural !== 'pods') return scoped as readonly T[];

    // Reflect the climbing restart count on the crash-looper. KubeObject is
    // deliberately loose about `status`, so this narrows locally rather than
    // tightening the shared type for one fixture.
    type PodShape = KubeObject & {
      status?: { containerStatuses?: Array<Record<string, unknown>> };
    };

    return scoped.map((item) => {
      const pod = item as PodShape;
      if (pod.metadata?.name !== 'worker-6bb4f9c2d-zt8rw') return pod;
      const statuses = pod.status?.containerStatuses;
      if (!Array.isArray(statuses)) return pod;
      return {
        ...pod,
        status: {
          ...pod.status,
          containerStatuses: statuses.map((status) => ({ ...status, restartCount: this.#restarts })),
        },
      };
    }) as readonly T[];
  }

  snapshot(): WatchSnapshot<T> {
    return { state: this.#state, items: this.items(), error: null, updatedAt: this.#updatedAt };
  }

  subscribe(listener: WatchListener<T>): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.#timer) return;
    // A real watch takes a moment to sync. Resolving instantly would hide every
    // loading state from the E2E suite, which is exactly where they break.
    this.#state = 'connecting';
    this.#emit();

    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    this.#state = 'synced';
    this.#updatedAt = new Date();
    this.#emit();

    if (this.#resource.plural === 'pods') {
      this.#timer = setInterval(() => {
        this.#restarts += 1;
        this.#updatedAt = new Date();
        this.#emit();
      }, 30_000);
      this.#timer.unref?.();
    }
    log.debug('demo watch started', { kind: this.#resource.kind, namespace: this.#namespace });
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#listeners.clear();
    this.#state = 'idle';
  }

  #emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        log.warn('demo watch listener threw', { error });
      }
    }
  }
}

/**
 * Splits a Kubernetes REST path into its parts.
 *
 * `/api/v1/namespaces/payments/pods/api-0` and `/apis/apps/v1/deployments`
 * both come through here. A regex for this looked fine and was wrong: with an
 * optional version segment it read "namespaces" as the version and "payments"
 * as the plural, so every namespaced get returned "no payments/pods". Walking
 * the segments is longer and cannot make that mistake.
 */
function parseApiPath(path: string): { namespace?: string; plural?: string; name?: string } {
  const clean = path.split('?')[0] ?? path;
  const parts = clean.split('/').filter(Boolean);
  let index = 0;

  if (parts[index] === 'api') {
    index += 2; // api, v1
  } else if (parts[index] === 'apis') {
    index += 3; // apis, group, version
  } else {
    return {};
  }

  let namespace: string | undefined;
  if (parts[index] === 'namespaces' && parts[index + 1]) {
    namespace = parts[index + 1];
    index += 2;
  }

  const plural = parts[index];
  const name = parts[index + 1];
  return {
    ...(namespace ? { namespace } : {}),
    ...(plural ? { plural } : {}),
    ...(name ? { name } : {}),
  };
}

/** The subset of the cluster transport the demo needs to answer for. */
export class DemoTransport {
  get server(): string {
    return 'https://demo.mjolnir.local';
  }

  async json<T = unknown>(path: string): Promise<T> {
    if (path === '/version') {
      return { gitVersion: 'v1.31.4-demo', major: '1', minor: '31' } as T;
    }

    const { namespace, plural, name } = parseApiPath(path);
    const scoped = plural ? demoStore.list(plural, namespace) : [];

    if (name) {
      const found = scoped.find((item) => item.metadata?.name === name);
      if (!found) throw new Error(`demo cluster has no ${plural}/${name}`);
      return found as T;
    }

    return {
      apiVersion: 'v1',
      kind: 'List',
      metadata: { resourceVersion: String(Date.now()) },
      items: scoped,
    } as T;
  }

  async text(path: string): Promise<string> {
    return JSON.stringify(await this.json(path));
  }

  /** PUT: the object given becomes the object stored. */
  async replace<T = unknown>(path: string, body: unknown): Promise<T> {
    const { plural } = parseApiPath(path);
    if (!plural) throw new Error(`cannot replace at ${path}`);
    return demoStore.put(plural, body as KubeObject) as T;
  }

  /** PATCH (merge): applied and kept, so the next read shows it. */
  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    const { plural, namespace, name } = parseApiPath(path);
    if (!plural || !name) throw new Error(`cannot patch at ${path}`);
    const current = demoStore.get(plural, namespace, name);
    if (!current) throw new Error(`demo cluster has no ${plural}/${name}`);
    return demoStore.put(plural, mergePatch(current, body) as KubeObject) as T;
  }

  async remove<T = unknown>(path: string): Promise<T> {
    const { plural, namespace, name } = parseApiPath(path);
    if (!plural || !name || !demoStore.remove(plural, namespace, name)) {
      throw new Error(`demo cluster has no ${plural}/${name}`);
    }
    return { kind: 'Status', status: 'Success' } as T;
  }

  /**
   * POST: a new object, or a subresource. Eviction is the one subresource the
   * app writes; against the demo it is simply the pod going away.
   */
  async create<T = unknown>(path: string, body: unknown): Promise<T> {
    const { plural, namespace, name } = parseApiPath(path);
    if (!plural) throw new Error(`cannot create at ${path}`);
    if (path.split('?')[0]?.endsWith('/eviction') && name) {
      demoStore.remove(plural, namespace, name);
      return { kind: 'Status', status: 'Success' } as T;
    }
    const object = body as KubeObject;
    if (!object?.metadata?.name) throw new Error('metadata.name is required');
    if (demoStore.get(plural, object.metadata.namespace, object.metadata.name)) {
      throw new Error(`${plural}/${object.metadata.name} already exists`);
    }
    return demoStore.put(plural, object) as T;
  }
}
