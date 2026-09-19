import type { ClusterContext } from '@mjolnir/k8s';
interface ClusterStripProps {
    readonly contexts: readonly ClusterContext[];
    readonly current: string | null;
    readonly decor?: Record<string, {
        label?: string;
        color?: string;
    }> | undefined;
    readonly onSelect: (name: string) => void;
    readonly onAdd: () => void;
}
export declare function ClusterStrip({ contexts, current, decor, onSelect, onAdd }: ClusterStripProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ClusterStrip.d.ts.map