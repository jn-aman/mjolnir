import type { ReactNode } from 'react';
import type { KubeItem } from './columns.tsx';
/**
 * The right-click menu on a resource row.
 *
 * Every action here is also reachable from the detail panel — a context menu is
 * a shortcut, never the only route, because an action that exists only behind
 * right-click is an action most people never find.
 *
 * Destructive entries are separated, coloured, and still open a confirm. The
 * menu is not the confirmation.
 */
export interface RowAction {
    readonly id: string;
    readonly label: string;
    readonly icon: ReactNode;
    readonly shortcut?: string;
    readonly danger?: boolean;
    readonly disabled?: boolean;
    readonly onSelect: () => void;
}
interface RowMenuProps {
    readonly item: KubeItem;
    readonly kind: string;
    readonly children: ReactNode;
    readonly onOpen: () => void;
    readonly onLogs: () => void;
    readonly onShell: () => void;
    readonly onYaml: () => void;
    readonly onRestart: () => void;
    readonly onScale: () => void;
    readonly onDelete: () => void;
}
export declare function RowMenu({ item, kind, children, onOpen, onLogs, onShell, onYaml, onRestart, onScale, onDelete, }: RowMenuProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=RowMenu.d.ts.map