import type { ReactNode } from 'react';
import type { KubeItem } from './columns.tsx';
import { type MenuEntry } from './ui/ContextMenu.tsx';
/**
 * The right-click menu on a resource row.
 *
 * Actions are named, not wired: the row says "restart", the screen decides
 * what restart means for this kind. That keeps the menu a description of the
 * row and lets the same list component serve every kind.
 *
 * Destructive entries are separated, coloured, and still open a confirm. The
 * menu is not the confirmation.
 */
export type RowActionId = 'open' | 'logs' | 'dock-logs' | 'forward' | 'shell' | 'yaml' | 'restart' | 'scale' | 'filter-namespace' | 'filter-node' | 'cordon' | 'uncordon' | 'drain' | 'taint' | 'pause' | 'resume' | 'undo' | 'delete';
interface RowMenuProps {
    readonly item: KubeItem;
    readonly kind: string;
    readonly act: (action: RowActionId) => void;
    readonly children: ReactNode;
}
/**
 * The entries for one row. Shared by the right-click menu and the row's own
 * actions button, so both offer exactly the same verbs.
 */
export declare function rowMenuEntries(item: KubeItem, kind: string, act: (action: RowActionId) => void): MenuEntry[];
export declare function RowMenu({ item, kind, act, children }: RowMenuProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=RowMenu.d.ts.map