/**
 * A ConfigMap or a Secret, key by key.
 *
 * ConfigMap values are shown as they are. Secret values are hidden until
 * asked for, one key at a time, and decoded here from base64; nothing is
 * stored and nothing is sent anywhere. Copy gives the decoded value, which
 * is what you were going to paste anyway.
 */
interface ConfigDataDetailProps {
    readonly kind: 'ConfigMap' | 'Secret';
    readonly object: {
        metadata?: {
            name?: string;
            labels?: Record<string, string>;
            annotations?: Record<string, string>;
        };
        type?: string;
        data?: Record<string, string>;
        binaryData?: Record<string, string>;
        stringData?: Record<string, string>;
        immutable?: boolean;
    };
    readonly onPatchMetadata?: ((patch: Record<string, unknown>) => Promise<void>) | undefined;
}
export declare function ConfigDataDetail({ kind, object, onPatchMetadata }: ConfigDataDetailProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ConfigDataDetail.d.ts.map