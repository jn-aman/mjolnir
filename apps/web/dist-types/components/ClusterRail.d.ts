import type { ClusterContext } from '@mjolnir/k8s';
interface ClusterRailProps {
    readonly contexts: readonly ClusterContext[];
    readonly current: string | null;
    readonly onSelect: (name: string) => void;
    readonly onAdd: () => void;
}
export declare function ClusterRail({ contexts, current, onSelect, onAdd }: ClusterRailProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ClusterRail.d.ts.map