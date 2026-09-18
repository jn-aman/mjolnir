export interface MetricPoint {
  readonly t: number;
  readonly cpu: number;
  readonly memory: number;
}

export interface MetricSeries {
  readonly name: string;
  readonly kind: 'node' | 'pod';
  readonly points: readonly MetricPoint[];
  readonly cpuCapacity?: number;
  readonly memoryCapacity?: number;
}

export interface MetricsResponse {
  readonly available: boolean;
  readonly reason?: string;
  readonly series: MetricSeries[];
}

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/** Cores, shown the way kubectl shows them: millicores below one. */
export function formatCpu(cores: number): string {
  if (cores < 1) return `${Math.round(cores * 1000)}m`;
  return cores.toFixed(2).replace(/\.?0+$/, '');
}

/** Bytes in binary units, because that is what Kubernetes quotes limits in. */
export function formatMemory(bytes: number): string {
  if (bytes >= GiB) return `${(bytes / GiB).toFixed(1)} Gi`;
  return `${Math.round(bytes / MiB)} Mi`;
}
