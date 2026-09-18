import type { WatchState } from '@mjolnir/k8s';
import { type KubeItem } from './columns.tsx';
/**
 * One table for every resource kind.
 *
 * Columns can be resized, reordered by dragging a header, and hidden — stored
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
    readonly selectedName?: string | undefined;
    readonly onSelect?: (item: KubeItem) => void;
    readonly onAction?: (action: string, item: KubeItem) => void;
}
export declare function ResourceList({ kind, items, state, error, filter, selectedName, onSelect, onAction, }: ResourceListProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ResourceList.d.ts.map