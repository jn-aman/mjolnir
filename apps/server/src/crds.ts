import type { ResourceDefinition } from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from './clusters.ts';

const log = logger.child('crds');

/**
 * Custom resources, discovered per cluster.
 *
 * Mjolnir's built-in kinds are a table in `packages/k8s`, which is right for
 * the twenty-seven kinds every cluster has and wrong for everything else: the
 * interesting half of a real cluster is Argo Applications, Cert-Manager
 * Certificates, Prometheus ServiceMonitors, Crossplane claims and whatever
 * that team wrote last quarter. A tool that cannot show those is a tool you
 * still keep a terminal open beside.
 *
 * So the definitions are read from the cluster itself and turned into the same
 * `ResourceDefinition` shape the built-ins use. Everything downstream, the
 * watch cache, the list route, YAML editing, delete, the command palette, the
 * detail pane, works on custom resources without knowing they are custom.
 *
 * Cached per context with a short life, because CRDs change when an operator
 * is installed and that is exactly when someone is looking.
 */

export interface CrdInfo extends ResourceDefinition {
  /** The CRD object's own name, `plural.group`. */
  readonly definition: string;
  /** Short names kubectl accepts, folded into the aliases. */
  readonly shortNames: readonly string[];
  /** Every served version, newest first as the API server orders them. */
  readonly versions: readonly string[];
  /** Printed by `kubectl get`; the client uses these as extra columns. */
  readonly columns: ReadonlyArray<{ name: string; jsonPath: string; type: string; priority?: number }>;
  readonly group: string;
  /** The operator or chart that owns it, when it says so. */
  readonly owner?: string | undefined;
}

interface CrdListShape {
  items?: Array<{
    metadata?: { name?: string; labels?: Record<string, string>; annotations?: Record<string, string> };
    spec?: {
      group?: string;
      scope?: string;
      names?: { kind?: string; plural?: string; singular?: string; shortNames?: string[]; listKind?: string };
      versions?: Array<{
        name?: string;
        served?: boolean;
        storage?: boolean;
        additionalPrinterColumns?: Array<{ name?: string; jsonPath?: string; type?: string; priority?: number }>;
      }>;
    };
  }>;
}

const TTL_MS = 30_000;

export class CrdCatalogue {
  readonly #registry: ClusterRegistry;
  readonly #cache = new Map<string, { at: number; items: CrdInfo[] }>();
  readonly #inflight = new Map<string, Promise<CrdInfo[]>>();

  constructor(registry: ClusterRegistry) {
    this.#registry = registry;
  }

  /** The custom kinds this cluster serves. Empty when the cluster has none or refuses. */
  async list(contextName: string, options: { fresh?: boolean } = {}): Promise<CrdInfo[]> {
    const cached = this.#cache.get(contextName);
    if (!options.fresh && cached && Date.now() - cached.at < TTL_MS) return cached.items;

    const running = this.#inflight.get(contextName);
    if (running) return running;

    const request = this.#fetch(contextName).finally(() => this.#inflight.delete(contextName));
    this.#inflight.set(contextName, request);
    return request;
  }

  /** Resolve a kind, plural or short name against this cluster's custom kinds. */
  async resolve(contextName: string, input: string): Promise<CrdInfo | undefined> {
    const needle = input.trim().toLowerCase();
    const items = await this.list(contextName);
    return items.find(
      (crd) =>
        crd.kind.toLowerCase() === needle ||
        crd.plural.toLowerCase() === needle ||
        `${crd.plural}.${crd.group}`.toLowerCase() === needle ||
        crd.shortNames.some((short) => short.toLowerCase() === needle),
    );
  }

  forget(contextName: string): void {
    this.#cache.delete(contextName);
  }

  async #fetch(contextName: string): Promise<CrdInfo[]> {
    try {
      const connection = this.#registry.connect(contextName);
      const response = await connection.json<CrdListShape>('/apis/apiextensions.k8s.io/v1/customresourcedefinitions');
      const items = (response.items ?? []).flatMap((crd) => toDefinition(crd)).sort(byGroupThenKind);
      this.#cache.set(contextName, { at: Date.now(), items });
      log.info('custom resources discovered', { context: contextName, count: items.length });
      return items;
    } catch (error) {
      // A cluster where we cannot read CRDs is common: a namespace-scoped
      // token has no business listing them. That is not an error worth showing,
      // it just means this cluster contributes no custom kinds.
      log.debug('custom resources unavailable', { context: contextName, error: String(error) });
      this.#cache.set(contextName, { at: Date.now(), items: [] });
      return [];
    }
  }
}

function toDefinition(crd: NonNullable<CrdListShape['items']>[number]): CrdInfo[] {
  const spec = crd.spec;
  const names = spec?.names;
  if (!spec?.group || !names?.kind || !names.plural) return [];

  const served = (spec.versions ?? []).filter((version) => version.served && version.name);
  if (served.length === 0) return [];
  // The storage version is the one to read and write by default; the API
  // server converts the others, and reading a non-storage version invites
  // surprises when a field only exists in one of them.
  const preferred = served.find((version) => version.storage) ?? served[0];
  if (!preferred?.name) return [];

  const columns = (preferred.additionalPrinterColumns ?? [])
    .filter((column) => column.name && column.jsonPath)
    .map((column) => ({
      name: column.name ?? '',
      jsonPath: column.jsonPath ?? '',
      type: column.type ?? 'string',
      ...(column.priority === undefined ? {} : { priority: column.priority }),
    }));

  const owner =
    crd.metadata?.labels?.['app.kubernetes.io/name'] ??
    crd.metadata?.labels?.['app.kubernetes.io/part-of'] ??
    crd.metadata?.annotations?.['meta.helm.sh/release-name'];

  return [
    {
      kind: names.kind,
      group: spec.group,
      version: preferred.name,
      plural: names.plural,
      namespaced: spec.scope !== 'Cluster',
      category: 'custom',
      label: names.kind.replace(/([a-z])([A-Z])/g, '$1 $2'),
      aliases: [...(names.shortNames ?? []), names.singular ?? ''].filter(Boolean),
      definition: crd.metadata?.name ?? `${names.plural}.${spec.group}`,
      shortNames: names.shortNames ?? [],
      versions: served.map((version) => version.name ?? '').filter(Boolean),
      columns,
      ...(owner ? { owner } : {}),
    },
  ];
}

function byGroupThenKind(a: CrdInfo, b: CrdInfo): number {
  return a.group === b.group ? a.kind.localeCompare(b.kind) : a.group.localeCompare(b.group);
}

/** Read a `.spec.foo[0].bar` printer-column path out of an object. */
export function readJsonPath(object: unknown, path: string): unknown {
  const steps = path.replace(/^\./, '').split(/\.(?![^[]*\])/);
  let current: unknown = object;
  for (const step of steps) {
    if (current === null || current === undefined) return undefined;
    const match = /^([^[]*)((?:\[[^\]]*\])*)$/.exec(step);
    const key = match?.[1] ?? step;
    if (key) {
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    for (const index of (match?.[2] ?? '').matchAll(/\[([^\]]*)\]/g)) {
      const inner = index[1] ?? '';
      if (Array.isArray(current)) {
        const position = Number(inner);
        current = Number.isFinite(position) ? current[position] : undefined;
      } else if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[inner.replace(/^['"]|['"]$/g, '')];
      } else {
        return undefined;
      }
    }
  }
  return current;
}
