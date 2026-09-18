import type { ClusterContext } from '@mjolnir/k8s';
interface ClusterStripProps {
    readonly contexts: readonly ClusterContext[];
    readonly current: string | null;
    readonly onSelect: (name: string) => void;
    readonly onAdd: () => void;
}
export declare function ClusterStrip({ contexts, current, onSelect, onAdd }: ClusterStripProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ClusterStrip.d.ts.map