/**
 * Synthetic metrics.
 *
 * Shaped like something a cluster would actually produce: a daily rhythm, a
 * visible incident on the payments API, and a worker whose memory climbs until
 * it is killed and resets. A flat sine wave would make every chart look correct
 * and hide the only thing charts are for, which is noticing when a line does
 * something it should not.
 */

export interface MetricPoint {
  /** Milliseconds since epoch. */
  readonly t: number;
  /** CPU in cores. */
  readonly cpu: number;
  /** Memory in bytes. */
  readonly memory: number;
}

export interface MetricSeries {
  readonly name: string;
  readonly kind: 'node' | 'pod';
  readonly points: readonly MetricPoint[];
  /** Allocatable CPU cores, for nodes. */
  readonly cpuCapacity?: number;
  /** Allocatable memory bytes, for nodes. */
  readonly memoryCapacity?: number;
}

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/** Deterministic noise, so a screenshot taken twice looks the same. */
function noise(seed: number): (index: number) => number {
  return (index) => {
    const x = Math.sin(seed * 374.761 + index * 91.373) * 43_758.545;
    return x - Math.floor(x) - 0.5;
  };
}

const WINDOW_MINUTES = 60;
const STEP_MS = 30_000;

function series(
  name: string,
  kind: 'node' | 'pod',
  shape: (fraction: number, index: number, jitter: number) => { cpu: number; memory: number },
  seed: number,
  capacity?: { cpu: number; memory: number },
): MetricSeries {
  const jitter = noise(seed);
  const count = (WINDOW_MINUTES * 60_000) / STEP_MS;
  const end = Date.now();
  const points: MetricPoint[] = [];

  for (let index = 0; index <= count; index += 1) {
    const fraction = index / count;
    const { cpu, memory } = shape(fraction, index, jitter(index));
    points.push({
      t: end - (count - index) * STEP_MS,
      cpu: Math.max(0, cpu),
      memory: Math.max(0, memory),
    });
  }

  return {
    name,
    kind,
    points,
    ...(capacity ? { cpuCapacity: capacity.cpu, memoryCapacity: capacity.memory } : {}),
  };
}

export function demoNodeMetrics(): MetricSeries[] {
  return [
    // The node hosting the payments API. The incident at ~70% through the
    // window is the same one the logs show as acquirer timeouts.
    series(
      'ip-10-0-1-14',
      'node',
      (fraction, _index, jitter) => {
        const incident = fraction > 0.68 && fraction < 0.78 ? 1.35 : 0;
        return {
          cpu: 1.4 + Math.sin(fraction * 6) * 0.25 + incident + jitter * 0.18,
          memory: 7.2 * GiB + Math.sin(fraction * 4) * 0.4 * GiB + jitter * 0.25 * GiB,
        };
      },
      11,
      { cpu: 4, memory: 16 * GiB },
    ),
    series(
      'ip-10-0-2-31',
      'node',
      (fraction, _index, jitter) => ({
        cpu: 2.1 + Math.sin(fraction * 5 + 1) * 0.3 + jitter * 0.2,
        // Climbs steadily — this is the node the ingest worker is OOMing on.
        memory: 9.4 * GiB + fraction * 2.6 * GiB + jitter * 0.2 * GiB,
      }),
      22,
      { cpu: 4, memory: 16 * GiB },
    ),
    series(
      'ip-10-0-3-8',
      'node',
      (fraction, _index, jitter) => ({
        cpu: 0.42 + Math.sin(fraction * 7 + 2) * 0.1 + jitter * 0.08,
        memory: 2.9 * GiB + Math.sin(fraction * 3) * 0.2 * GiB + jitter * 0.12 * GiB,
      }),
      33,
      { cpu: 2, memory: 8 * GiB },
    ),
  ];
}

export function demoPodMetrics(): MetricSeries[] {
  return [
    series(
      'api-7d9f4b8c6-x2mqz',
      'pod',
      (fraction, _index, jitter) => {
        const incident = fraction > 0.68 && fraction < 0.78 ? 0.55 : 0;
        return {
          cpu: 0.32 + Math.sin(fraction * 6) * 0.08 + incident + jitter * 0.05,
          memory: 210 * MiB + Math.sin(fraction * 4) * 18 * MiB + jitter * 12 * MiB,
        };
      },
      101,
    ),
    series(
      'api-7d9f4b8c6-k8lpw',
      'pod',
      (fraction, _index, jitter) => ({
        cpu: 0.29 + Math.sin(fraction * 6 + 1) * 0.07 + jitter * 0.05,
        memory: 198 * MiB + Math.sin(fraction * 4 + 1) * 15 * MiB + jitter * 10 * MiB,
      }),
      102,
    ),
    // The sawtooth: memory climbs to the 512Mi limit, the container is killed,
    // and it starts again. This is the shape that explains a CrashLoopBackOff
    // faster than any log line, which is the whole argument for the chart.
    series(
      'worker-6bb4f9c2d-zt8rw',
      'pod',
      (fraction, _index, jitter) => {
        const cycle = (fraction * 4) % 1;
        return {
          cpu: 0.55 + cycle * 0.3 + jitter * 0.06,
          memory: (120 + cycle * 390) * MiB + jitter * 8 * MiB,
        };
      },
      103,
    ),
    series(
      'web-5c8b9d774-lk4pn',
      'pod',
      (fraction, _index, jitter) => ({
        cpu: 0.18 + Math.sin(fraction * 8) * 0.05 + jitter * 0.04,
        memory: 142 * MiB + Math.sin(fraction * 5) * 12 * MiB + jitter * 8 * MiB,
      }),
      104,
    ),
    series(
      'ledger-6c4d8f9b7-nn4tz',
      'pod',
      (fraction, _index, jitter) => ({
        cpu: 0.24 + Math.sin(fraction * 4) * 0.06 + jitter * 0.04,
        memory: 176 * MiB + fraction * 20 * MiB + jitter * 9 * MiB,
      }),
      105,
    ),
  ];
}

/** Latest sample per series, for a list column or a stat tile. */
export function latest(all: MetricSeries[]): Record<string, MetricPoint> {
  const out: Record<string, MetricPoint> = {};
  for (const entry of all) {
    const point = entry.points.at(-1);
    if (point) out[entry.name] = point;
  }
  return out;
}
