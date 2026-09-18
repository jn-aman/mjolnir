/**
 * Which namespaces you are looking at.
 *
 * One, several, or all: tick them from the cluster's list, or type one that
 * is not listed yet (RBAC often hides the list but not the namespace). The
 * choice is remembered per cluster.
 */
interface NamespacePickerProps {
    readonly all: readonly string[];
    readonly selected: readonly string[];
    readonly onChange: (next: string[]) => void;
}
export declare function NamespacePicker({ all, selected, onChange }: NamespacePickerProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=NamespacePicker.d.ts.map