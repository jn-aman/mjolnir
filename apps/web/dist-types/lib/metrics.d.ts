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
/** Cores, shown the way kubectl shows them: millicores below one. */
export declare function formatCpu(cores: number): string;
/** Bytes in binary units, because that is what Kubernetes quotes limits in. */
export declare function formatMemory(bytes: number): string;
//# sourceMappingURL=metrics.d.ts.map