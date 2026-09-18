/**
 * `kubectl create -f`, without the file: a skeleton for the kind you are
 * looking at, in the same editor the YAML tab uses, sent when you say so.
 */
interface CreateDialogProps {
    readonly open: boolean;
    readonly kind: string;
    readonly apiVersion: string;
    readonly namespace: string | undefined;
    readonly onClose: () => void;
    readonly onCreate: (yaml: string) => Promise<void>;
}
export declare function CreateDialog({ open, kind, apiVersion, namespace, onClose, onCreate }: CreateDialogProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=CreateDialog.d.ts.map