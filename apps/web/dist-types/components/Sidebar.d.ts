import type { ResourceDefinition } from '@mjolnir/k8s';
import { type ToolDefinition } from '../lib/tools.ts';
import type { CustomResource } from '../lib/api.ts';
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
    /** Kinds this cluster defines itself, grouped under their API group. */
    readonly custom?: readonly CustomResource[];
    readonly selection: NavSelection;
    readonly counts: Record<string, number>;
    readonly onSelect: (selection: NavSelection) => void;
    readonly width: number;
    /** When set, this is a module other than Kubernetes: its sections are the nav. */
    readonly module?: ToolDefinition | undefined;
    /** Icons only. */
    readonly compact?: boolean;
}
export declare function Sidebar({ kinds, custom, selection, counts, onSelect, width, module, compact }: SidebarProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Sidebar.d.ts.map