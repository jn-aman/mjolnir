import { type KubeItem } from './columns.tsx';
/**
 * The detail panel.
 *
 * Slides in from the edge it belongs to — the container animates, its contents
 * do not. Everything about one object lives here rather than on a separate
 * route, because the list is the context: losing it to look at a pod and then
 * navigating back is the interaction this replaces.
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
}
export declare function ResourceDrawer({ context, kind, item, metrics, initialTab, onClose }: DrawerProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=ResourceDrawer.d.ts.map