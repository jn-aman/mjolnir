import { logger } from '@mjolnir/logger';
import { parseQuantity } from '@mjolnir/schemas';
import type { ClusterRegistry } from './clusters.ts';

const log = logger.child('metrics');

/**
 * Usage over time, which Kubernetes does not keep.
 *
 * `metrics.k8s.io` answers one question: what is this node using *right now*.
 * It stores nothing. So a chart of the last hour cannot be fetched, it has to
 * be accumulated, and something has to do the accumulating.
 *
 * That is this. It polls every connected cluster on an interval and keeps a
 * ring buffer per node and per pod. The consequence is honest and worth
 * saying in the UI rather than hiding: **the history starts when the app
 * starts.** Two minutes after launch you have two minutes of chart. A tool
 * that drew a full hour of flat line from a single sample would be inventing
 * data, and someone would make a capacity decision on it.
 *
 * In memory only. This is a desktop app watching a cluster, not a monitoring
 * system, and persisting it would mean deciding how much of someone's disk to
 * spend on a chart they may never open. Prometheus exists and is what to read
 * when real history matters; this is for the question "what is happening now,
 * and was it different ten minutes ago".
 */

export interface MetricPoint {
  /**
   * Milliseconds since epoch.
   *
   * Named `t` because that is what every chart in the app reads, and the
   * synthetic metrics have always used it. Calling it `at` here made the
   * server's own data the odd one out, and the symptom was a chart full of
   * `NaN` path commands rather than anything that said which field was wrong.
   */
  readonly t: number;
  /** Cores. */
  readonly cpu: number;
  /** Bytes. */
  readonly memory: number;
}

export interface MetricSeries {
  readonly name: string;
  readonly kind: 'node' | 'pod';
  readonly points: readonly MetricPoint[];
  readonly cpuCapacity?: number;
  readonly memoryCapacity?: number;
  /** For pods, the namespace, so two pods with one name are distinguishable. */
  readonly namespace?: string;
}

export type Availability =
  | { readonly available: true; readonly series: MetricSeries[]; readonly since: number }
  | { readonly available: false; readonly reason: string; readonly series: [] };

/** Every 30 seconds: metrics-server itself only refreshes every 15 to 60. */
const POLL_MS = 30_000;
/** Two hours at 30s is 240 points per subject, which is nothing to hold. */
const KEEP = 240;
/** Stop polling a cluster nobody has looked at for this long. */
const IDLE_MS = 10 * 60_000;

interface NodeMetricsList {
  items?: Array<{ metadata?: { name?: string }; usage?: { cpu?: string; memory?: string } }>;
}
interface PodMetricsList {
  items?: Array<{
    metadata?: { name?: string; namespace?: string };
    containers?: Array<{ usage?: { cpu?: string; memory?: string } }>;
  }>;
}
interface NodeList {
  items?: Array<{ metadata?: { name?: string }; status?: { allocatable?: { cpu?: string; memory?: string } } }>;
}

interface Buffer {
  readonly points: MetricPoint[];
  cpuCapacity?: number;
  memoryCapacity?: number;
  namespace?: string;
}

interface ClusterState {
  readonly nodes: Map<string, Buffer>;
  readonly pods: Map<string, Buffer>;
  available: boolean | null;
  reason: string;
  since: number;
  lastAsked: number;
  timer?: NodeJS.Timeout;
}

export class MetricsCollector {
  readonly #registry: ClusterRegistry;
  readonly #clusters = new Map<string, ClusterState>();

  constructor(registry: ClusterRegistry) {
    this.#registry = registry;
  }

  /**
   * Starts collecting for a context if it is not already, and returns what
   * there is so far.
   *
   * Collection begins on the first ask rather than for every context in a
   * kubeconfig, because someone with forty clusters configured is looking at
   * one of them and polling the other thirty-nine would be rude to their
   * laptop and to those clusters' API servers.
   */
  nodes(context: string): Availability {
    const state = this.#ensure(context);
    return this.#answer(state, state.nodes, 'node');
  }

  pods(context: string): Availability {
    const state = this.#ensure(context);
    return this.#answer(state, state.pods, 'pod');
  }

  stop(): void {
    for (const state of this.#clusters.values()) if (state.timer) clearInterval(state.timer);
    this.#clusters.clear();
  }

  #answer(state: ClusterState, buffers: Map<string, Buffer>, kind: 'node' | 'pod'): Availability {
    if (state.available === false) return { available: false, reason: state.reason, series: [] };
    if (state.available === null) {
      return { available: false, reason: 'Reading metrics for the first time.', series: [] };
    }
    const series: MetricSeries[] = [...buffers.entries()]
      .map(([name, buffer]) => ({
        name,
        kind,
        points: buffer.points,
        ...(buffer.cpuCapacity === undefined ? {} : { cpuCapacity: buffer.cpuCapacity }),
        ...(buffer.memoryCapacity === undefined ? {} : { memoryCapacity: buffer.memoryCapacity }),
        ...(buffer.namespace === undefined ? {} : { namespace: buffer.namespace }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { available: true, series, since: state.since };
  }

  #ensure(context: string): ClusterState {
    const existing = this.#clusters.get(context);
    if (existing) {
      existing.lastAsked = Date.now();
      return existing;
    }
    const state: ClusterState = {
      nodes: new Map(),
      pods: new Map(),
      available: null,
      reason: '',
      since: Date.now(),
      lastAsked: Date.now(),
    };
    this.#clusters.set(context, state);
    void this.#sample(context, state);
    state.timer = setInterval(() => {
      // A cluster nobody is looking at stops being polled. It resumes the
      // moment someone opens a chart for it.
      if (Date.now() - state.lastAsked > IDLE_MS) {
        if (state.timer) clearInterval(state.timer);
        this.#clusters.delete(context);
        log.debug('stopped collecting for an idle cluster', { context });
        return;
      }
      void this.#sample(context, state);
    }, POLL_MS);
    state.timer.unref();
    return state;
  }

  async #sample(context: string, state: ClusterState): Promise<void> {
    let connection;
    try {
      connection = this.#registry.connect(context);
    } catch (error) {
      state.available = false;
      state.reason = error instanceof Error ? error.message : String(error);
      return;
    }

    const at = Date.now();
    try {
      const [nodes, pods] = await Promise.all([
        connection.json<NodeMetricsList>('/apis/metrics.k8s.io/v1beta1/nodes'),
        connection.json<PodMetricsList>('/apis/metrics.k8s.io/v1beta1/pods'),
      ]);

      for (const item of nodes.items ?? []) {
        const name = item.metadata?.name;
        if (!name) continue;
        push(state.nodes, name, { t: at, cpu: cores(item.usage?.cpu), memory: bytes(item.usage?.memory) });
      }

      for (const item of pods.items ?? []) {
        const name = item.metadata?.name;
        const namespace = item.metadata?.namespace ?? '';
        if (!name) continue;
        // A pod's usage is the sum of its containers, which is the number
        // `kubectl top pod` prints and therefore the one people expect.
        let cpu = 0;
        let memory = 0;
        for (const container of item.containers ?? []) {
          cpu += cores(container.usage?.cpu);
          memory += bytes(container.usage?.memory);
        }
        const buffer = push(state.pods, `${namespace}/${name}`, { t: at, cpu, memory });
        buffer.namespace = namespace;
      }

      // Capacity turns "1.4 cores" into "35% of this node", which is the
      // question anyone looking at a node actually has.
      if (state.available !== true) await this.#capacities(connection, state);

      if (state.available !== true) {
        state.available = true;
        state.since = at;
        log.info('collecting metrics', { context, nodes: state.nodes.size, pods: state.pods.size });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.available = false;
      // The common case by far, and it deserves a sentence someone can act on
      // rather than a 404 from a path they have never heard of.
      state.reason = /404|not found|could not find/i.test(message)
        ? 'metrics-server is not installed on this cluster. Without it Kubernetes does not report CPU or memory usage at all, and `kubectl top` does not work either.'
        : `Could not read metrics: ${message}`;
      log.debug('metrics unavailable', { context, error: message });
    }
  }

  async #capacities(connection: { json<T>(path: string): Promise<T> }, state: ClusterState): Promise<void> {
    try {
      const list = await connection.json<NodeList>('/api/v1/nodes');
      for (const item of list.items ?? []) {
        const name = item.metadata?.name;
        if (!name) continue;
        const buffer = state.nodes.get(name);
        if (!buffer) continue;
        buffer.cpuCapacity = cores(item.status?.allocatable?.cpu);
        buffer.memoryCapacity = bytes(item.status?.allocatable?.memory);
      }
    } catch {
      // Charts without a ceiling are still charts.
    }
  }
}

function push(buffers: Map<string, Buffer>, key: string, point: MetricPoint): Buffer {
  const buffer = buffers.get(key) ?? { points: [] };
  buffer.points.push(point);
  if (buffer.points.length > KEEP) buffer.points.shift();
  buffers.set(key, buffer);
  return buffer;
}

/** `250m` is a quarter of a core; `1` is one. */
function cores(quantity: string | undefined): number {
  return parseQuantity(quantity ?? '0') ?? 0;
}

/** `1234567` or `512Mi`. */
function bytes(quantity: string | undefined): number {
  return parseQuantity(quantity ?? '0') ?? 0;
}
