import type { KubeItem } from './columns.tsx';
import type { Taint } from '../lib/edits.ts';
/** `kubectl taint`, as a list you edit rather than a syntax you remember. */
interface TaintDialogProps {
    readonly node: KubeItem | null;
    readonly onClose: () => void;
    readonly onApply: (taints: readonly Taint[]) => Promise<void>;
}
export declare function TaintDialog({ node, onClose, onApply }: TaintDialogProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=TaintDialog.d.ts.map