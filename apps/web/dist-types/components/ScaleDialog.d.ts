import type { KubeItem } from './columns.tsx';
/**
 * Scale a workload.
 *
 * A number, two nudge buttons, and the current value shown so the change is a
 * change and not a guess. Zero is allowed, scaling to zero is how you stop a
 * workload without deleting it, but it is called out, because it is usually
 * not what a slip of the finger meant.
 */
interface ScaleDialogProps {
    readonly item: KubeItem | null;
    readonly kind: string;
    readonly onClose: () => void;
    readonly onScale: (replicas: number) => Promise<void>;
}
export declare function ScaleDialog({ item, kind, onClose, onScale }: ScaleDialogProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ScaleDialog.d.ts.map