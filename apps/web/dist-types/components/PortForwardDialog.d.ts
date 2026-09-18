import { type ForwardRecord } from '../lib/api.ts';
import type { KubeItem } from './columns.tsx';
/**
 * `kubectl port-forward`, from the pod's own list of ports.
 *
 * Every container port is a row with a Forward button; the local port is
 * chosen for you unless you type one. A port the pod does not declare can be
 * typed too, because plenty of images never fill `ports:` in. Active forwards
 * for this pod show here with Open and Stop, and the same list lives under
 * Tools › Port forwards for every pod at once.
 */
interface PortForwardDialogProps {
    readonly context: string;
    readonly pod: KubeItem | null;
    readonly onClose: () => void;
    readonly onStarted?: ((record: ForwardRecord) => void) | undefined;
}
interface PortRow {
    readonly container: string;
    readonly port: number;
    readonly name?: string | undefined;
    readonly protocol?: string | undefined;
}
export declare function declaredPorts(pod: KubeItem | null): PortRow[];
export declare function PortForwardDialog({ context, pod, onClose, onStarted }: PortForwardDialogProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=PortForwardDialog.d.ts.map