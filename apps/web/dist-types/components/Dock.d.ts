/**
 * The dock: a strip along the bottom that holds things you want to keep open
 * while you go somewhere else.
 *
 * A log tail in the dock stays streaming while you inspect the deployment
 * that owns the pod. Terminals and port forwards land here for the same
 * reason. It is one component so every kind of tab is closed, resized and
 * reordered the same way, and it is gone entirely when it has nothing to show.
 */
export interface DockTab {
    readonly id: string;
    readonly kind: 'logs' | 'terminal' | 'assistant';
    readonly title: string;
    readonly subtitle?: string;
    readonly context: string;
    readonly namespace?: string;
    readonly pod?: string;
    readonly containers?: readonly string[];
}
interface DockProps {
    readonly tabs: readonly DockTab[];
    readonly activeId: string | null;
    readonly height: number;
    readonly dragging: boolean;
    readonly onResizeStart: (event: React.PointerEvent) => void;
    readonly onActivate: (id: string) => void;
    readonly onClose: (id: string) => void;
    readonly onCloseAll: () => void;
    /** Opens the tab's subject in the details panel, full size. */
    readonly onExpand: (tab: DockTab) => void;
    readonly assistant?: {
        readonly incoming: {
            readonly id: number;
            readonly text: string;
        } | null;
        readonly onOpenSettings: () => void;
    } | undefined;
}
export declare function Dock({ tabs, activeId, height, dragging, onResizeStart, onActivate, onClose, onCloseAll, onExpand, assistant }: DockProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=Dock.d.ts.map