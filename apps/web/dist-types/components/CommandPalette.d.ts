import type { ClusterContext, ResourceDefinition } from '@mjolnir/k8s';
import type { NavSelection } from './Sidebar.tsx';
import type { KubeItem } from './columns.tsx';
/**
 * ⌘K.
 *
 * One box that reaches everything: a page, a kind, a tool, a cluster, a
 * namespace, or a specific object in the list you are looking at. It is the
 * fastest route to anything for people who know what they want, and the map
 * for people who do not. Every entry it offers exists elsewhere as a click.
 */
interface CommandPaletteProps {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly kinds: readonly ResourceDefinition[];
    readonly clusters: readonly ClusterContext[];
    readonly namespaces: readonly string[];
    readonly kind: string;
    readonly items: readonly KubeItem[];
    readonly theme: 'dark' | 'light';
    readonly onNavigate: (selection: NavSelection) => void;
    readonly onCluster: (name: string) => void;
    readonly onNamespace: (namespace: string) => void;
    readonly onOpenItem: (item: KubeItem) => void;
    readonly onToggleTheme: () => void;
}
export declare function CommandPalette({ open, onOpenChange, kinds, clusters, namespaces, kind, items, theme, onNavigate, onCluster, onNamespace, onOpenItem, onToggleTheme, }: CommandPaletteProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=CommandPalette.d.ts.map