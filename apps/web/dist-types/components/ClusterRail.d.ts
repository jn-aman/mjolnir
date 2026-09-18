import type { ClusterContext } from '@mjolnir/k8s';
interface ClusterRailProps {
    readonly contexts: readonly ClusterContext[];
    readonly current: string | null;
    /** The open workspace, if one is; the cluster marker steps aside for it. */
    readonly workspace: string | null;
    readonly onSelect: (name: string) => void;
    readonly onWorkspace: (id: string) => void;
    readonly onAdd: () => void;
    readonly onSettings: () => void;
    readonly settingsActive: boolean;
}
export declare function ClusterRail({ contexts, current, workspace, onSelect, onWorkspace, onAdd, onSettings, settingsActive }: ClusterRailProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ClusterRail.d.ts.map