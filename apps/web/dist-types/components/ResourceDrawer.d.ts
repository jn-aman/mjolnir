import { type KubeItem } from './columns.tsx';
/**
 * The detail panel.
 *
 * It overlays the list rather than squeezing it: a table that loses its Name
 * column the moment you open something is not a table any more. Escape closes.
 *
 * Every action the right-click menu offers is also here, in the header. A
 * context menu is a shortcut, never the only route.
 */
interface DrawerProps {
    readonly context: string;
    readonly kind: string;
    readonly item: KubeItem | null;
    readonly metrics?: {
        cpu: Array<{
            t: number;
            v: number;
        }>;
        memory: Array<{
            t: number;
            v: number;
        }>;
    };
    readonly initialTab?: string;
    readonly onClose: () => void;
    readonly onNavigate?: (target: {
        kind: string;
        name?: string;
        namespace?: string;
        workspace?: string;
    }) => void;
    /** Called after a successful delete so the list can drop the row at once. */
    readonly onDeleted?: () => void;
    readonly onForward?: ((item: KubeItem, port?: number) => void) | undefined;
}
export declare function ResourceDrawer({ context, kind, item, metrics, initialTab, onClose, onNavigate, onDeleted, onForward, }: DrawerProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=ResourceDrawer.d.ts.map