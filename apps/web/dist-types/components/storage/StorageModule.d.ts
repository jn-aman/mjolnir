import type { ToolDefinition } from '../../lib/tools.ts';
/**
 * Buckets as folders.
 *
 * A connection is an S3 endpoint and keys, or a pod the app port-forwards
 * to on demand. Prefixes are folders, objects are rows, preview shows text
 * and images in place, and every object has its menu: download, presign,
 * copy the key, delete.
 */
export type StorageSection = 'connections' | 'buckets' | 'transfers' | 'presigned-links';
interface StorageModuleProps {
    readonly tool: ToolDefinition;
    readonly section: StorageSection;
    /** A connection to select on arrival, e.g. one just created from a pod. */
    readonly focusConnection?: string | undefined;
}
export declare function StorageModule({ tool, section, focusConnection }: StorageModuleProps): import("react").JSX.Element;
export declare function formatObjectDate(value: string | undefined): string;
export {};
//# sourceMappingURL=StorageModule.d.ts.map