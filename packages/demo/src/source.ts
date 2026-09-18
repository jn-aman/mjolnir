import type { KubeObject } from '@mjolnir/schemas';
import type { ResourceDefinition, WatchListener, WatchSnapshot, WatchState } from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';
import { DEMO_RESOURCES } from './cluster.ts';

const log = logger.child('demo');

/**
 * A watch over the synthetic cluster.
 *
 * Matches the real `ResourceWatch` surface exactly, so nothing above it knows
 * the difference. It also *changes over time* — the crash-looper's restart
 * count climbs — because a frozen fixture hides every bug that only shows when
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
    const all = DEMO_RESOURCES[this.#resource.plural] ?? [];
    const scoped =
      this.#resource.namespaced && this.#namespace
        ? all.filter((item) => item.metadata?.namespace === this.#namespace)
        : all;

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

/** The subset of the cluster transport the demo needs to answer for. */
export class DemoTransport {
  get server(): string {
    return 'https://demo.mjolnir.local';
  }

  async json<T = unknown>(path: string): Promise<T> {
    if (path === '/version') {
      return { gitVersion: 'v1.31.4-demo', major: '1', minor: '31' } as T;
    }

    const match = /\/(?:api|apis)\/(?:[^/]+\/)?[^/]+\/(?:namespaces\/([^/]+)\/)?([^/?]+)(?:\/([^/?]+))?/.exec(
      path,
    );
    const namespace = match?.[1];
    const plural = match?.[2];
    const name = match?.[3];

    const all = plural ? (DEMO_RESOURCES[plural] ?? []) : [];
    const scoped = namespace ? all.filter((item) => item.metadata?.namespace === namespace) : all;

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
}
