import type { InputHTMLAttributes, ReactNode } from 'react';
interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
    readonly id: string;
    readonly label: string;
    /** Hide the label visually but keep it for screen readers. */
    readonly hideLabel?: boolean;
    readonly leading?: ReactNode;
    readonly trailing?: ReactNode;
    readonly error?: string;
    readonly mono?: boolean;
}
/**
 * A labelled input.
 *
 * The label is never optional, a placeholder disappears exactly when someone
 * needs it, which is while they are typing. `hideLabel` hides it visually and
 * keeps it in the accessibility tree.
 */
export declare function Field({ id, label, hideLabel, leading, trailing, error, mono, className, ...rest }: FieldProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Field.d.ts.map