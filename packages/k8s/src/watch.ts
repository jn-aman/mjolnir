import {
  type Informer,
  type KubeConfig,
  type KubernetesObject,
  type ObjectCache,
  makeInformer,
} from '@kubernetes/client-node';
import { logger } from '@mjolnir/logger';
import type { ClusterTransport } from './transport.ts';
import { type ResourceDefinition, collectionPath } from './resources.ts';

const log = logger.child('watch');

export type WatchState = 'idle' | 'connecting' | 'synced' | 'error';

export interface WatchSnapshot<T> {
  readonly state: WatchState;
  readonly items: readonly T[];
  /** Populated only in the `error` state. */
  readonly error: string | null;
  /** When the cache last changed, for a "last updated" indicator. */
  readonly updatedAt: Date | null;
}

export type WatchListener<T> = (snapshot: WatchSnapshot<T>) => void;

interface KubeList<T> {
  items?: T[];
  metadata?: { resourceVersion?: string };
}

/**
 * A live, watch-backed cache of one resource kind.
 *
 * This is the single biggest difference between a UI that feels instant and one
 * that feels laggy. Polling costs a full list request per interval and still
 * shows stale data between ticks; a watch keeps a local cache that the API
 * server pushes into, so reads are synchronous and updates arrive in
 * milliseconds.
 *
 * Notifications are coalesced. A rolling deployment can produce hundreds of
 * events in a second, and re-rendering a table on each one is how a cluster
 * view locks up, so listeners are told "something changed" on a frame-ish
 * cadence rather than per event.
 */
export class ResourceWatch<T extends KubernetesObject = KubernetesObject> {
  readonly #config: KubeConfig;
  readonly #transport: ClusterTransport;
  readonly #resource: ResourceDefinition;
  readonly #namespace: string | undefined;
  readonly #coalesceMs: number;

  #informer: (Informer<T> & ObjectCache<T>) | null = null;
  #listeners = new Set<WatchListener<T>>();
  #state: WatchState = 'idle';
  #error: string | null = null;
  #updatedAt: Date | null = null;
  #flushTimer: NodeJS.Timeout | null = null;
  #restartTimer: NodeJS.Timeout | null = null;
  #restartAttempt = 0;
  #stopped = false;

  constructor(options: {
    config: KubeConfig;
    transport: ClusterTransport;
    resource: ResourceDefinition;
    namespace?: string;
    coalesceMs?: number;
  }) {
    this.#config = options.config;
    this.#transport = options.transport;
    this.#resource = options.resource;
    this.#namespace = options.namespace;
    this.#coalesceMs = options.coalesceMs ?? 100;
  }

  get state(): WatchState {
    return this.#state;
  }

  /** Current contents of the cache. Synchronous, that is the point. */
  items(): readonly T[] {
    return this.#informer?.list() ?? [];
  }

  snapshot(): WatchSnapshot<T> {
    return {
      state: this.#state,
      items: this.items(),
      error: this.#error,
      updatedAt: this.#updatedAt,
    };
  }

  /** Subscribe to coalesced changes. The returned function unsubscribes. */
  subscribe(listener: WatchListener<T>): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.#informer || this.#stopped) return;

    const path = collectionPath(this.#resource, this.#namespace);
    this.#setState('connecting');

    const listFn = async () => {
      const body = await this.#transport.json<KubeList<T>>(path);
      return {
        ...body,
        items: body.items ?? [],
      } as never;
    };

    const informer = makeInformer<T>(this.#config, path, listFn);
    this.#informer = informer;

    informer.on('add', () => this.#touch());
    informer.on('update', () => this.#touch());
    informer.on('delete', () => this.#touch());

    informer.on('connect', () => {
      this.#restartAttempt = 0;
      this.#setState('synced');
    });

    informer.on('error', (error?: unknown) => {
      // A watch ending is routine, the API server closes idle watches, and
      // resourceVersion expiry is normal on a busy cluster. Reconnect with
      // backoff rather than surfacing every disconnect to the user.
      const message = error instanceof Error ? error.message : String(error ?? 'watch failed');
      this.#error = message;
      this.#setState('error');
      log.debug('watch error, will reconnect', { path, error: message });
      this.#scheduleRestart();
    });

    try {
      await informer.start();
      this.#setState('synced');
      this.#touch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#error = message;
      this.#setState('error');
      log.warn('watch failed to start', { path, error: message });
      this.#scheduleRestart();
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#flushTimer = null;
    this.#restartTimer = null;

    const informer = this.#informer;
    this.#informer = null;
    if (informer) {
      try {
        await informer.stop();
      } catch (error) {
        log.debug('informer stop threw, ignoring', { error });
      }
    }
    this.#listeners.clear();
  }

  #setState(state: WatchState): void {
    if (this.#state === state) return;
    this.#state = state;
    if (state !== 'error') this.#error = null;
    this.#emit();
  }

  #touch(): void {
    this.#updatedAt = new Date();
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#emit();
    }, this.#coalesceMs);
  }

  #emit(): void {
    if (this.#listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        log.warn('watch listener threw', { error });
      }
    }
  }

  /** Exponential backoff, capped, so a cluster that is down does not become a busy loop. */
  #scheduleRestart(): void {
    if (this.#stopped || this.#restartTimer) return;

    const delay = Math.min(1000 * 2 ** this.#restartAttempt, 30_000);
    this.#restartAttempt += 1;
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      void (async () => {
        const informer = this.#informer;
        this.#informer = null;
        if (informer) {
          try {
            await informer.stop();
          } catch {
            /* the informer is already broken; nothing to salvage */
          }
        }
        await this.start();
      })();
    }, delay);
  }
}
