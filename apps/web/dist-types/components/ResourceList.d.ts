import type { WatchState } from '@mjolnir/k8s';
import { type KubeItem } from './columns.tsx';
/**
 * One virtualized list for every resource kind.
 *
 * Rows are **not** animated. Easing a row into view misstates when it arrived,
 * and this is a tool people use to establish what happened when. The container
 * animates; the data does not.
 */
interface ResourceListProps {
    readonly kind: string;
    readonly items: KubeItem[];
    readonly state: WatchState;
    readonly error: string | null;
    readonly filter: string;
    readonly selectedName?: string | undefined;
    readonly onSelect?: (item: KubeItem) => void;
}
export declare function ResourceList({ kind, items, state, error, filter, selectedName, onSelect }: ResourceListProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ResourceList.d.ts.map