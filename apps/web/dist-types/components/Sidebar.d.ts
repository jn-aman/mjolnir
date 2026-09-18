import type { ResourceDefinition } from '@mjolnir/k8s';
interface SidebarProps {
    readonly kinds: ResourceDefinition[];
    readonly selected: string;
    readonly counts: Record<string, number>;
    readonly onSelect: (kind: string) => void;
}
export declare function Sidebar({ kinds, selected, counts, onSelect }: SidebarProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Sidebar.d.ts.map