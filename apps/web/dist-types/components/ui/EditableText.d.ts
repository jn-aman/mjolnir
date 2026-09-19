/**
 * A value you can click to change.
 *
 * The affordance is a dashed underline, always visible. A pencil that appears
 * on hover tells you nothing until you are already hovering, and then it does
 * not say what it edits. An underline on the value itself says "this, here".
 * Where a value cannot change, the underline is gone and the tooltip says why.
 */
interface EditableTextProps {
    readonly value: string;
    readonly label: string;
    readonly onCommit: (next: string) => Promise<void>;
    readonly mono?: boolean;
    readonly disabledReason?: string | undefined;
    readonly className?: string;
    readonly testId?: string;
    /** Returns a sentence when the draft is not acceptable; saving is blocked. */
    readonly validate?: ((next: string) => string | null) | undefined;
}
export declare function EditableText({ value, label, onCommit, mono, disabledReason, className, testId, validate }: EditableTextProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=EditableText.d.ts.map