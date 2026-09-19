/**
 * What the cluster is running, against what somebody said it should run.
 *
 * ## The problem this has to solve first
 *
 * A naive diff of a live object against the thing that created it is useless,
 * and that is why most tools do not do this well. Kubernetes defaults dozens
 * of fields on admission, controllers write status and annotations, and the
 * API server adds `resourceVersion`, `uid`, `generation` and `managedFields`.
 * Diff a live Deployment against the YAML it came from and you get two hundred
 * differences, none of which anybody did.
 *
 * So the comparison is **one-directional and declared-only**: every path that
 * appears in the desired object is checked against the live one, and nothing
 * else is looked at. "I said `replicas: 3`, the cluster says 5" is drift. "The
 * cluster also has `terminationGracePeriodSeconds: 30`, which I never
 * mentioned" is not: that is Kubernetes filling in a default, and reporting it
 * is how a drift tool trains people to ignore it.
 *
 * The exception is deletion. A field that was declared and is now absent is
 * reported, because somebody removing a field with `kubectl edit` is exactly
 * the thing this should catch.
 *
 * ## Where desired state comes from
 *
 * Three sources, in descending order of how much they are worth trusting:
 *
 * - **A Helm release manifest**, which is what the chart rendered and is what
 *   the next `helm upgrade` will reassert. Drift against this will be undone.
 * - **The `last-applied-configuration` annotation**, which is what somebody
 *   last ran `kubectl apply` with. Drift against this is somebody having used
 *   `kubectl edit`, `kubectl scale` or the API directly since.
 * - **An Argo CD Application**, which reports its own sync status and does not
 *   need us to compute one.
 */

export type DriftSource = 'helm' | 'last-applied' | 'argocd';

export interface DriftChange {
  /** Dotted, with array indices: `spec.template.spec.containers[0].image`. */
  readonly path: string;
  readonly kind: 'changed' | 'removed' | 'type-changed';
  readonly desired: unknown;
  readonly live: unknown;
  /**
   * What this difference means, where the field is one whose drift has a
   * usual cause. Absent when there is nothing honest to say beyond the values.
   */
  readonly note?: string | undefined;
  /** Some drift is expected and healthy. Say which. */
  readonly expected: boolean;
}

export interface DriftReport {
  readonly source: DriftSource;
  readonly object: { kind: string; name: string; namespace?: string | undefined };
  readonly changes: readonly DriftChange[];
  /** Changes nobody should expect: the ones worth a person's attention. */
  readonly unexpected: number;
  readonly inSync: boolean;
  readonly summary: string;
  /** Where the desired state came from, named for the person reading. */
  readonly against: string;
}

/**
 * Fields Kubernetes or a controller owns, which drift by design.
 *
 * Reporting these is how a drift tool becomes something people scroll past.
 * `spec.replicas` is deliberately not here: an HPA changing it is expected and
 * says so, but a person changing it is the single most common real drift there
 * is, and hiding both to avoid explaining one is the wrong trade.
 */
const OWNED = [
  /^metadata\.(resourceVersion|uid|generation|creationTimestamp|selfLink|managedFields)/,
  /^metadata\.annotations\.(kubectl\.kubernetes\.io\/last-applied-configuration|deployment\.kubernetes\.io\/revision)/,
  /^metadata\.annotations\.(meta\.helm\.sh|helm\.sh)/,
  /^status(\.|$)/,
  /^spec\.template\.metadata\.creationTimestamp$/,
  // The service account token volume the API server injects into every pod.
  /^spec\.template\.spec\.volumes\[\d+\]\.projected/,
  /^spec\.clusterIPs?$/,
  /^spec\.(healthCheckNodePort|ipFamilies|ipFamilyPolicy)$/,
];

/**
 * Fields whose drift usually has one cause, worth naming.
 *
 * Every entry here is a sentence somebody would otherwise have to work out
 * from two values and a path.
 */
interface NoteInput {
  readonly desired: unknown;
  readonly live: unknown;
  /** What the desired side is called: "the acme chart", "the last kubectl apply". */
  readonly against: string;
}

const EXPLAINED: ReadonlyArray<{ match: RegExp; note: (change: NoteInput) => string; expected?: boolean }> = [
  {
    match: /^spec\.replicas$/,
    note: ({ desired, live, against }) =>
      `${sentenceCase(against)} asks for ${String(desired)} and the cluster is running ${String(live)}. A HorizontalPodAutoscaler does this legitimately and will keep doing it; a person running kubectl scale does this too, and the next apply or upgrade will undo it.`,
  },
  {
    match: /containers\[\d+\]\.image$/,
    note: ({ desired, live, against }) =>
      `The running image is ${String(live)}, not ${String(desired)}. Usually kubectl set image, which the next reconcile against ${against} reverts, so whatever this fixed comes back.`,
  },
  {
    match: /containers\[\d+\]\.resources\./,
    note: () => 'Resource requests or limits were changed on the live object. A vertical autoscaler does this; so does someone in a hurry during an incident.',
  },
  {
    match: /^spec\.template\.spec\.nodeSelector/,
    note: () => 'Where these pods are allowed to run was changed on the cluster, not in the source.',
  },
  {
    match: /^spec\.paused$/,
    note: ({ live }) => (live === true ? 'This rollout is paused on the cluster, so changes are being applied and not rolled out.' : 'The rollout was resumed on the cluster.'),
  },
  {
    match: /^metadata\.annotations\.autoscaling\./,
    note: () => 'An autoscaler wrote this. It is meant to.',
    expected: true,
  },
];

export interface DriftInput {
  readonly live: Record<string, unknown>;
  readonly desired: Record<string, unknown>;
  readonly source: DriftSource;
  /** What to call the source on screen: a chart name, or "the last kubectl apply". */
  readonly against: string;
}

export function detectDrift(input: DriftInput): DriftReport {
  const changes = comparePaths(input.desired, input.live).map((change) => decorate(change, input.against));
  const unexpected = changes.filter((change) => !change.expected).length;
  const kind = String((input.live as { kind?: string }).kind ?? 'Object');
  const metadata = (input.live['metadata'] ?? {}) as { name?: string; namespace?: string };

  return {
    source: input.source,
    object: { kind, name: metadata.name ?? 'unknown', namespace: metadata.namespace },
    changes,
    unexpected,
    inSync: changes.length === 0,
    summary: describe(changes, unexpected, input.against),
    against: input.against,
  };
}

function describe(changes: readonly DriftChange[], unexpected: number, against: string): string {
  if (changes.length === 0) return `The cluster matches ${against}.`;
  if (unexpected === 0) {
    return `${changes.length} difference${changes.length === 1 ? '' : 's'} from ${against}, all of them the kind a controller makes.`;
  }
  const first = changes.find((change) => !change.expected)!;
  const others = unexpected - 1;
  const tail = others === 0 ? '' : others === 1 ? ', and one other field' : `, and ${others} other fields`;
  return `${first.path} differs from ${against}${tail}.`;
}

function decorate(change: Omit<DriftChange, 'note' | 'expected'>, against: string): DriftChange {
  const rule = EXPLAINED.find((entry) => entry.match.test(change.path));
  return {
    ...change,
    ...(rule ? { note: rule.note({ desired: change.desired, live: change.live, against }) } : {}),
    expected: rule?.expected ?? false,
  };
}

/**
 * "the acme chart" at the start of a sentence.
 *
 * The name of the source is written to read mid-sentence, because that is
 * where it appears most often. One note needs it first, and a capital there is
 * cheaper than two spellings of every name.
 */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Every path in `desired` that `live` does not match.
 *
 * One direction only. See the note at the top: walking `live` instead would
 * report every field Kubernetes defaulted, which is most of them.
 */
export function comparePaths(
  desired: unknown,
  live: unknown,
  path = '',
  out: Array<Omit<DriftChange, 'note' | 'expected'>> = [],
): Array<Omit<DriftChange, 'note' | 'expected'>> {
  if (path && OWNED.some((pattern) => pattern.test(path))) return out;

  if (Array.isArray(desired)) {
    if (!Array.isArray(live)) {
      out.push({ path, kind: live === undefined ? 'removed' : 'type-changed', desired, live });
      return out;
    }
    for (let index = 0; index < desired.length; index += 1) {
      comparePaths(desired[index], live[index], `${path}[${index}]`, out);
    }
    return out;
  }

  if (isRecord(desired)) {
    if (!isRecord(live)) {
      out.push({ path, kind: live === undefined ? 'removed' : 'type-changed', desired, live });
      return out;
    }
    for (const [key, value] of Object.entries(desired)) {
      comparePaths(value, live[key], path ? `${path}.${key}` : key, out);
    }
    return out;
  }

  if (live === undefined && desired !== undefined) {
    out.push({ path, kind: 'removed', desired, live });
    return out;
  }
  if (!same(desired, live)) out.push({ path, kind: 'changed', desired, live });
  return out;
}

/**
 * Whether two scalars are the same value.
 *
 * Quantities are the reason this is not `===`. A manifest saying `cpu: 1` and a
 * cluster saying `cpu: "1"`, or `memory: 1024Mi` against `1Gi`, are the same
 * request written differently, and reporting them as drift is noise that
 * teaches people to ignore the whole page.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    if (String(a) === String(b)) return true;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    const left = quantity(a);
    const right = quantity(b);
    if (left !== null && right !== null) return left === right;
  }
  return false;
}

const SUFFIXES: Record<string, number> = {
  m: 0.001,
  '': 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
};

/** A Kubernetes quantity as a number, or null when it is not one. */
export function quantity(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)(m|[kKMGTP]i?)?$/.exec(value.trim());
  if (!match) return null;
  const scale = SUFFIXES[match[2] ?? ''];
  return scale === undefined ? null : Number(match[1]) * scale;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The desired object somebody last applied with kubectl.
 *
 * Null when the annotation is absent, which is the normal case for anything
 * created by a controller, by Helm's own apply, or with server-side apply.
 * That is not an error, it means this object has no kubectl history to compare
 * against and the answer is to say so rather than to invent one.
 */
export function lastApplied(live: Record<string, unknown>): Record<string, unknown> | null {
  const annotations = ((live['metadata'] ?? {}) as { annotations?: Record<string, string> }).annotations ?? {};
  const raw = annotations['kubectl.kubernetes.io/last-applied-configuration'];
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The object in a Helm manifest that matches this live one.
 *
 * Matched on kind, name and namespace rather than on position, because a
 * chart's manifest order is whatever the templates happened to render in and
 * changes between versions.
 */
export function findInManifest(
  documents: readonly Record<string, unknown>[],
  target: { kind: string; name: string; namespace?: string | undefined },
): Record<string, unknown> | null {
  return (
    documents.find((document) => {
      const metadata = (document['metadata'] ?? {}) as { name?: string; namespace?: string };
      if (String(document['kind'] ?? '') !== target.kind) return false;
      if (metadata.name !== target.name) return false;
      // A chart often omits the namespace and relies on the release's, so an
      // absent namespace matches anything rather than nothing.
      return !metadata.namespace || !target.namespace || metadata.namespace === target.namespace;
    }) ?? null
  );
}
