import type { ResourceDefinition } from '@mjolnir/k8s';
/** What the sidebar can select: a resource kind, or one of the app's own pages. */
export type NavSelection = {
    kind: 'resource';
    value: string;
} | {
    kind: 'page';
    value: 'overview' | 'settings';
};
interface SidebarProps {
    readonly kinds: ResourceDefinition[];
    readonly selection: NavSelection;
    readonly counts: Record<string, number>;
    readonly onSelect: (selection: NavSelection) => void;
}
export declare function Sidebar({ kinds, selection, counts, onSelect }: SidebarProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Sidebar.d.ts.map