import type { WatchState } from '@mjolnir/k8s';
import { type KubeItem, type PrinterColumn } from './columns.tsx';
import { type MenuEntry } from './ui/ContextMenu.tsx';
/**
 * One table for every resource kind.
 *
 * Columns can be resized, reordered by dragging a header, and hidden, stored
 * per kind, because the columns that matter for Pods are not the ones that
 * matter for Secrets and one shared layout would be wrong for both.
 *
 * Rows are virtualized and **never animated**. Easing a row into view misstates
 * when it arrived, and this is a tool people use to establish what happened
 * when. The container animates; the data does not.
 */
interface ResourceListProps {
    readonly kind: string;
    readonly items: KubeItem[];
    readonly state: WatchState;
    readonly error: string | null;
    readonly filter: string;
    /** Extra columns a CustomResourceDefinition asks kubectl to print. */
    readonly printerColumns?: readonly PrinterColumn[];
    /** Lets an empty result clear the search that caused it. */
    readonly onClearFilter?: (() => void) | undefined;
    /** The kind's label as people say it: "Role bindings", not "rolebindings". */
    readonly label?: string | undefined;
    readonly namespace?: string | undefined;
    readonly selectedName?: string | undefined;
    readonly onSelect?: (item: KubeItem) => void;
    readonly onAction?: (action: string, item: KubeItem) => void;
    /** Replaces the Kubernetes row menu, for lists of other things. */
    readonly menu?: ((item: KubeItem) => MenuEntry[]) | undefined;
    /** Verbs for several rows at once. A checkbox column appears when given. */
    readonly bulk?: readonly BulkAction[] | undefined;
}
export interface BulkAction {
    readonly id: string;
    readonly label: string;
    readonly icon?: React.ReactNode;
    readonly danger?: boolean;
    /** Runs on the selected rows; the selection clears when it resolves. */
    readonly run: (items: KubeItem[]) => Promise<void> | void;
    /** Offered only when every selected row passes. */
    readonly applies?: (item: KubeItem) => boolean;
}
export declare function ResourceList({ kind, items, state, error, filter, printerColumns, onClearFilter, label, namespace, selectedName, onSelect, onAction, menu, bulk, }: ResourceListProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ResourceList.d.ts.map