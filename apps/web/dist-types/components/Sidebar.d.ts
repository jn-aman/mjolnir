import type { ResourceDefinition } from '@mjolnir/k8s';
import { type ToolDefinition } from '../lib/tools.ts';
/** What the sidebar can select: a resource kind, or one of the app's own pages. */
export type NavSelection = {
    kind: 'resource';
    value: string;
} | {
    kind: 'page';
    value: 'overview' | 'settings' | 'app-settings';
}
/** A cluster tool from the TOOLS registry: Helm, port forwards, … */
 | {
    kind: 'tool';
    value: string;
}
/** Something that is not about one cluster: cloud access, containers, buckets. */
 | {
    kind: 'workspace';
    value: string;
};
interface SidebarProps {
    readonly kinds: ResourceDefinition[];
    readonly selection: NavSelection;
    readonly counts: Record<string, number>;
    readonly onSelect: (selection: NavSelection) => void;
    readonly width: number;
    /** When set, this is a module other than Kubernetes: its sections are the nav. */
    readonly module?: ToolDefinition | undefined;
    /** Icons only. */
    readonly compact?: boolean;
}
export declare function Sidebar({ kinds, selection, counts, onSelect, width, module, compact }: SidebarProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Sidebar.d.ts.map