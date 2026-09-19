import { type ReactNode } from 'react';
/**
 * One line of text that ends in an ellipsis, and a tooltip that does not.
 *
 * A table whose rows grow to three lines because one container is called
 * `k8s_local-path-provisioner_local-path-provisioner-5db9d5cbbb-rlv8d_kube-system_64c61dd6-…_0`
 * has stopped being a table. But an ellipsis that hides the answer is just as
 * useless, so the full value is always one hover away, selectable, and still in
 * the right-click menu as "Copy".
 *
 * Which end to cut is a judgement about the string, not a global setting:
 *
 * - `end` for names and images. Kubernetes identifiers are front-loaded, so
 *   the workload is in the first thirty characters and the replica-set hash,
 *   the pod suffix and the container UID are not.
 * - `middle` for paths and object keys, where the last segment is the file
 *   name and the first is the bucket, and only the directories between them
 *   are skippable.
 *
 * Middle mode pins the tail in its own element rather than measuring text, so
 * it costs nothing per row and the ellipsis appears exactly when the browser
 * decides the head no longer fits.
 */
interface TruncateProps {
    readonly text: string;
    readonly mode?: 'end' | 'middle';
    /** How many characters stay pinned at the end in middle mode. */
    readonly tail?: number;
    readonly className?: string;
    readonly mono?: boolean;
    readonly testId?: string;
    /** Rendered in place of the plain text, for highlighted matches. */
    readonly children?: ReactNode;
    /** A second line under the tooltip's value, for a hint or a full path. */
    readonly hint?: string | undefined;
}
export declare function Truncate({ text, mode, tail, className, mono, testId, children, hint }: TruncateProps): import("react").JSX.Element;
/**
 * Which way a value should be cut, from what kind of value it is.
 *
 * Kept here rather than at each call site so the answer is the same in a table,
 * a drawer and a palette result.
 */
export declare function truncateMode(kind: 'name' | 'image' | 'path' | 'key' | 'url' | 'id' | 'text'): 'end' | 'middle';
export {};
//# sourceMappingURL=Truncate.d.ts.map