import { RevisionStore, type ChangeType } from '@mjolnir/k8s';
import type { ResourceDefinition } from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from './clusters.ts';

const log = logger.child('history');

/**
 * Recording what the cluster used to look like.
 *
 * It hangs off the watches the app already runs for its lists, so the cost is
 * memory and nothing else: no extra API calls, no polling, no load on the
 * cluster. A kind is recorded from the moment somebody looks at it, which is
 * the honest bargain. There is no history of a kind nobody has opened, and
 * saying so is better than quietly watching everything in the background to
 * be ready for a question nobody asked.
 *
 * The window is short and the caps are hard. An app left open overnight must
 * not be holding last night's cluster.
 */
export class HistoryRecorder {
  readonly #registry: ClusterRegistry;
  readonly #store: RevisionStore;
  /** One subscription per context and kind, so opening a list twice is free. */
  readonly #watching = new Map<string, () => void>();

  constructor(registry: ClusterRegistry, store = new RevisionStore()) {
    this.#registry = registry;
    this.#store = store;
  }

  get store(): RevisionStore {
    return this.#store;
  }

  /**
   * Start recording a kind, if it is not already.
   *
   * Called when a list is opened rather than at start-up, and deliberately
   * never stopped: the point of a window is to still be there when somebody
   * finally asks, and unsubscribing when a tab closes would empty it exactly
   * when it became useful.
   */
  follow(contextName: string, resource: ResourceDefinition, namespace?: string): void {
    const key = `${contextName}/${resource.kind}/${namespace ?? '*'}`;
    if (this.#watching.has(key)) return;

    try {
      const watch = this.#registry.connect(contextName).watch(resource, namespace);
      const stop = watch.onChange((type: ChangeType, object: unknown) => {
        this.#record(contextName, resource.kind, type, object as Record<string, unknown>);
      });
      this.#watching.set(key, stop);
      log.debug('recording history', { context: contextName, kind: resource.kind, namespace });
    } catch (error) {
      log.debug('could not record history for a kind', { kind: resource.kind, error: String(error) });
    }
  }

  revisions(contextName: string, kind: string, name: string, namespace?: string) {
    return this.#store.revisions(RevisionStore.key(contextName, kind, namespace, name));
  }

  diff(contextName: string, kind: string, name: string, index: number, namespace?: string) {
    return this.#store.diff(RevisionStore.key(contextName, kind, namespace, name), index);
  }

  /** Whether this kind is being recorded at all, which the UI has to be able to say. */
  following(contextName: string, kind: string): boolean {
    return [...this.#watching.keys()].some((key) => key.startsWith(`${contextName}/${kind}/`));
  }

  forget(contextName: string): void {
    for (const [key, stop] of this.#watching) {
      if (!key.startsWith(`${contextName}/`)) continue;
      stop();
      this.#watching.delete(key);
    }
    this.#store.forget(contextName);
  }

  stop(): void {
    for (const stop of this.#watching.values()) stop();
    this.#watching.clear();
  }

  #record(contextName: string, kind: string, type: ChangeType, object: Record<string, unknown>): void {
    const metadata = (object['metadata'] ?? {}) as { name?: string; namespace?: string };
    if (!metadata.name) return;
    this.#store.record(
      RevisionStore.key(contextName, kind, metadata.namespace, metadata.name),
      // The kind is not always on a watched object: the API server omits it
      // inside a List, and the history needs it to know what it is looking at.
      { kind, ...object },
      type === 'delete' ? 'deleted' : 'changed',
    );
  }
}
