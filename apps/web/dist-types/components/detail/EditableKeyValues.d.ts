/**
 * Labels and annotations, edited in place.
 *
 * These are the one thing that is patchable on every object in the cluster, so
 * they are where "the overview is editable" starts. Each chip edits on click;
 * a key is removed with its ×; a new pair is added from the trailing +. Every
 * change is one merge patch, `{ [key]: value }` to set, `{ [key]: null }` to
 * remove, so nothing else on the object is touched and a concurrent change to
 * a different field cannot be overwritten.
 *
 * Keys are not renamed in place: Kubernetes has no rename, only remove-and-add,
 * and pretending otherwise would hide that two operations happen.
 */
interface EditableKeyValuesProps {
    readonly values: Record<string, string>;
    /** Sends a merge patch for this map alone and resolves when applied. */
    readonly onPatch: (patch: Record<string, string | null>) => Promise<void>;
    readonly truncate?: boolean;
    readonly testId?: string;
}
export declare function EditableKeyValues({ values, onPatch, truncate, testId }: EditableKeyValuesProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=EditableKeyValues.d.ts.map