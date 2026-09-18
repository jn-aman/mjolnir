import type { ButtonHTMLAttributes, ReactNode } from 'react';
/**
 * Four variants, one size.
 *
 * `danger` is deliberately not a solid red fill: a solid red button is easy to
 * hit by accident, and the two-step confirm behind it matters more than the
 * colour shouting.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    readonly variant?: ButtonVariant;
    readonly icon?: ReactNode;
    /** Square, icon-only. Requires aria-label. */
    readonly iconOnly?: boolean;
}
export declare function Button({ variant, icon, iconOnly, className, children, ...rest }: ButtonProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Button.d.ts.map