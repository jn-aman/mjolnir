/**
 * What this object looked like twenty minutes ago.
 *
 * Kubernetes keeps no history. `kubectl get` shows you now, events expire in
 * an hour and say nothing about fields, and `last-applied` records one
 * version by one tool. The question people actually have during an incident is
 * "what changed just before this started", and nothing in the API answers it.
 *
 * Watch events already stream through this app to keep the lists live, and
 * every one of them carries the whole object. Keeping a bounded window of them
 * costs memory and answers the question. That is the entire idea.
 *
 * ## What makes it affordable
 *
 * **Only real changes are kept.** An informer fires updates constantly for
 * things nobody did: `resourceVersion` moves on every write anywhere in the
 * object, `managedFields` records who touched what and when, and a dozen
 * status fields carry heartbeats. Recording those would fill the window with
 * noise in minutes and bury the one change that matters.
 *
 * **Everything is capped**, per object and in total, and the oldest goes
 * first. An app that quietly grows until the machine swaps is not a feature.
 */

export interface Revision<T = Record<string, unknown>> {
  /** When this version was seen, not when the cluster says it was written. */
  readonly at: number;
  readonly resourceVersion: string;
  readonly object: T;
  /** `deleted` is recorded too: an object vanishing is the change you want. */
  readonly kind: 'created' | 'changed' | 'deleted';
  /**
   * Whether anybody did this, or it followed from something they did.
   *
   * A single `kubectl scale` produces one change to `spec.replicas` and then
   * eight to `status`, as replicas terminate and conditions settle. Both are
   * worth keeping, and treating them the same buries the one somebody did
   * under the eight that followed it.
   */
  readonly origin: 'spec' | 'status';
}

export interface FieldChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly kind: 'added' | 'removed' | 'changed';
}

/**
 * Fields that move without anybody moving them.
 *
 * Every entry here has been checked against a real cluster: these change on
 * writes to unrelated parts of the object, or on a timer, and a history full
 * of them is a history nobody reads.
 */
const NOISE: readonly RegExp[] = [
  /^metadata\.resourceVersion$/,
  /^metadata\.generation$/,
  /^metadata\.managedFields/,
  /^metadata\.annotations\.(kubectl\.kubernetes\.io\/restartedAt|control-plane\.alpha\.kubernetes\.io\/leader)$/,
  // Lease objects and node heartbeats, which tick every few seconds.
  /^spec\.renewTime$/,
  /^spec\.holderIdentity$/,
  /\.lastHeartbeatTime$/,
  /^status\.observedGeneration$/,
  // A condition whose status has not changed but whose probe time has.
  /^status\.conditions\[\d+\]\.lastUpdateTime$/,
  /^status\.conditions\[\d+\]\.lastProbeTime$/,
];

function noisy(path: string): boolean {
  return NOISE.some((pattern) => pattern.test(path));
}

/**
 * Every field that differs, in both directions.
 *
 * Deliberately not the one-directional walk drift uses. Drift asks "has what I
 * declared been changed", so it looks only at paths somebody declared. History
 * asks "what is different", and a field the controller added is exactly as
 * interesting as one it removed.
 */
export function changesBetween(before: unknown, after: unknown, path = '', out: FieldChange[] = []): FieldChange[] {
  if (path && noisy(path)) return out;

  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      changesBetween(before[key], after[key], path ? `${path}.${key}` : key, out);
    }
    return out;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
      changesBetween(before[index], after[index], `${path}[${index}]`, out);
    }
    return out;
  }

  if (before === undefined && after !== undefined) {
    out.push({ path, before, after, kind: 'added' });
  } else if (before !== undefined && after === undefined) {
    out.push({ path, before, after, kind: 'removed' });
  } else if (!same(before, after)) {
    out.push({ path, before, after, kind: 'changed' });
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface RevisionStoreOptions {
  /** Versions kept per object. Beyond this the oldest goes. */
  readonly perObject?: number;
  /** Objects tracked at once, across every cluster and kind. */
  readonly objects?: number;
  /** How far back to keep anything at all. */
  readonly windowMs?: number;
  /**
   * How long a run of status-only updates counts as one settling.
   *
   * A rollout's status moves eight times over a few seconds as pods come and
   * go. That is one thing happening, not eight, and recording it as eight
   * both reads badly and evicts the real changes underneath it.
   */
  readonly settleMs?: number;
  readonly now?: () => number;
}

const MINUTE = 60_000;

/**
 * A bounded window of what every watched object used to look like.
 *
 * The three limits are all load bearing and they bound different things: a
 * single object being edited in a loop, a cluster with a hundred thousand
 * pods, and an app left open overnight.
 */
export class RevisionStore {
  readonly #perObject: number;
  readonly #objects: number;
  readonly #windowMs: number;
  readonly #settleMs: number;
  readonly #now: () => number;
  /** Insertion-ordered, which a Map gives us, so the oldest key is first. */
  readonly #history = new Map<string, Revision[]>();

  constructor(options: RevisionStoreOptions = {}) {
    this.#perObject = options.perObject ?? 40;
    this.#objects = options.objects ?? 2000;
    this.#windowMs = options.windowMs ?? 60 * MINUTE;
    this.#settleMs = options.settleMs ?? 30_000;
    this.#now = options.now ?? (() => Date.now());
  }

  static key(context: string, kind: string, namespace: string | undefined, name: string): string {
    return `${context}/${kind}/${namespace ?? ''}/${name}`;
  }

  /**
   * Records a version, unless nothing anybody cares about changed.
   *
   * Returns whether it was kept, which is what the tests assert on: the
   * expensive mistake here is recording churn, and it is invisible until the
   * window holds four hundred copies of a Lease.
   */
  record(key: string, object: Record<string, unknown>, kind: Revision['kind'] = 'changed'): boolean {
    const at = this.#now();
    const existing = this.#history.get(key);
    const previous = existing?.at(-1);

    if (previous && kind !== 'deleted') {
      // Nothing meaningful moved, so this is the same object arriving again.
      if (changesBetween(previous.object, object).length === 0) return false;
    }

    const changes = previous ? changesBetween(previous.object, object) : [];
    const origin: Revision['origin'] = previous && changes.every((change) => change.path.startsWith('status')) ? 'status' : 'spec';

    const revision: Revision = {
      at,
      resourceVersion: String(((object['metadata'] ?? {}) as { resourceVersion?: unknown }).resourceVersion ?? ''),
      object: redact(object),
      kind: previous ? kind : 'created',
      origin,
    };

    const list = existing ?? [];

    /*
     * A rollout settling is one entry, not eight.
     *
     * When the last thing recorded was also status-only and it was a moment
     * ago, this replaces it rather than appending. The entry then spans the
     * whole settle, which is what happened, and the spec change that caused
     * it stays in the window instead of being evicted by its own consequences.
     */
    const last = list.at(-1);
    const settling =
      last !== undefined &&
      origin === 'status' &&
      last.origin === 'status' &&
      kind !== 'deleted' &&
      at - last.at <= this.#settleMs;

    if (settling) list[list.length - 1] = { ...revision, at: last.at };
    else list.push(revision);
    while (list.length > this.#perObject) list.shift();

    // Re-inserting moves the key to the end, which is what makes the Map's
    // insertion order an LRU rather than a creation order.
    this.#history.delete(key);
    this.#history.set(key, list);

    this.#evict(at);
    return true;
  }

  /** Everything kept for one object, oldest first. */
  revisions(key: string): readonly Revision[] {
    const list = this.#history.get(key) ?? [];
    const cutoff = this.#now() - this.#windowMs;
    return list.filter((revision) => revision.at >= cutoff);
  }

  /** What changed between two consecutive versions. */
  diff(key: string, index: number): readonly FieldChange[] {
    const list = this.revisions(key);
    const after = list[index];
    const before = list[index - 1];
    if (!after) return [];
    if (!before) return [];
    return changesBetween(before.object, after.object);
  }

  get size(): number {
    return this.#history.size;
  }

  forget(context: string): void {
    for (const key of [...this.#history.keys()]) {
      if (key.startsWith(`${context}/`)) this.#history.delete(key);
    }
  }

  #evict(at: number): void {
    const cutoff = at - this.#windowMs;
    for (const [key, list] of this.#history) {
      const kept = list.filter((revision) => revision.at >= cutoff);
      if (kept.length === 0) this.#history.delete(key);
      else if (kept.length !== list.length) this.#history.set(key, kept);
    }
    // Oldest touched first, because the Map is ordered by last write.
    while (this.#history.size > this.#objects) {
      const oldest = this.#history.keys().next().value;
      if (oldest === undefined) break;
      this.#history.delete(oldest);
    }
  }
}

/**
 * A version with nothing in it that should not be held in memory.
 *
 * A Secret's `data` is the obvious one: keeping twenty versions of every
 * secret in a cluster, in a desktop app, for an hour, is not a feature
 * anybody asked for. The keys are kept because "somebody added a key to this
 * secret" is exactly the change worth seeing, and the values are not.
 */
export function redact(object: Record<string, unknown>): Record<string, unknown> {
  const kind = String(object['kind'] ?? '');
  if (kind !== 'Secret') return object;
  const data = object['data'];
  if (!isRecord(data)) return object;
  return {
    ...object,
    data: Object.fromEntries(Object.keys(data).map((key) => [key, '(not kept)'])),
  };
}

/**
 * A change in words, where the field is one whose movement has a usual cause.
 *
 * The same idea as the drift notes and a different list: this is about what
 * happened, not about what was declared.
 */
export function explainChange(change: FieldChange): string | undefined {
  if (/^spec\.replicas$/.test(change.path)) {
    const from = Number(change.before);
    const to = Number(change.after);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      return to > from
        ? `Scaled up from ${from} to ${to}. An autoscaler or a person.`
        : to === 0
          ? `Scaled to zero, which stops it serving without deleting it.`
          : `Scaled down from ${from} to ${to}.`;
    }
  }
  if (/containers\[\d+\]\.image$/.test(change.path)) {
    return `The image changed to ${String(change.after)}. This is a deploy, and everything after it is downstream of this line.`;
  }
  if (/^status\.readyReplicas$/.test(change.path)) {
    const to = Number(change.after);
    return to === 0 ? 'Every pod stopped being ready here.' : `Ready pods moved to ${String(change.after)}.`;
  }
  if (/^spec\.paused$/.test(change.path)) {
    return change.after === true ? 'The rollout was paused here.' : 'The rollout was resumed here.';
  }
  if (/^metadata\.deletionTimestamp$/.test(change.path) && change.kind === 'added') {
    return 'Something asked for this to be deleted at this point.';
  }
  return undefined;
}
