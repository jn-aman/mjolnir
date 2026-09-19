import { EventEmitter } from 'node:events';
import type { KubeObject } from '@mjolnir/schemas';
import { DEMO_RESOURCES } from './cluster.ts';

/**
 * The demo cluster's memory.
 *
 * The fixtures are the starting state; this is where writes go. A label you
 * add is there on the next read, a pod you evict is gone, a deployment you
 * scale reports the new count, because a demo that forgets what you did is a
 * demo of a screenshot, not of the app. It resets when the process does.
 */
class DemoStore {
  readonly #data = new Map<string, KubeObject[]>();
  readonly #events = new EventEmitter();

  /** Fires with the plural whenever that collection changes. */
  onChange(listener: (plural: string) => void): () => void {
    this.#events.on('change', listener);
    return () => void this.#events.off('change', listener);
  }

  constructor() {
    for (const [plural, items] of Object.entries(DEMO_RESOURCES)) {
      this.#data.set(plural, structuredClone(items) as KubeObject[]);
    }
  }

  list(plural: string, namespace?: string): readonly KubeObject[] {
    const all = this.#data.get(plural) ?? [];
    return namespace ? all.filter((item) => item.metadata?.namespace === namespace) : all;
  }

  get(plural: string, namespace: string | undefined, name: string): KubeObject | undefined {
    return this.list(plural, namespace).find((item) => item.metadata?.name === name);
  }

  /** Inserts or replaces by namespace and name; returns what is now stored. */
  put(plural: string, object: KubeObject): KubeObject {
    const items = this.#data.get(plural) ?? [];
    const index = items.findIndex(
      (item) => item.metadata?.name === object.metadata?.name && item.metadata?.namespace === object.metadata?.namespace,
    );
    const stored: KubeObject = {
      ...object,
      metadata: {
        ...object.metadata,
        uid: object.metadata?.uid ?? `demo-${Math.random().toString(16).slice(2)}`,
        creationTimestamp: object.metadata?.creationTimestamp ?? new Date().toISOString(),
        resourceVersion: String(Date.now()),
      },
    } as KubeObject;
    if (index === -1) items.push(stored);
    else items[index] = stored;
    this.#data.set(plural, items);
    this.#events.emit('change', plural);
    return stored;
  }

  remove(plural: string, namespace: string | undefined, name: string): boolean {
    const items = this.#data.get(plural) ?? [];
    const index = items.findIndex((item) => item.metadata?.name === name && (!namespace || item.metadata?.namespace === namespace));
    if (index === -1) return false;
    items.splice(index, 1);
    this.#events.emit('change', plural);
    return true;
  }
}

export const demoStore = new DemoStore();

/** RFC 7386 merge: objects recurse, null deletes, anything else replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out: Record<string, unknown> =
    target && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out;
}
