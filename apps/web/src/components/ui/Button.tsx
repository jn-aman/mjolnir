import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Tip } from './Tooltip.tsx';

/**
 * Four variants, one size.
 *
 * `danger` is deliberately not a solid red fill: a solid red button is easy to
 * hit by accident, and the two-step confirm behind it matters more than the
 * colour shouting.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn-primary text-inverse border-transparent hover:brightness-110 hover:-translate-y-px',
  secondary: 'btn-secondary text-primary border-line hover:border-strong hover:-translate-y-px',
  ghost: 'bg-transparent text-secondary border-transparent hover:bg-hover hover:text-primary',
  danger: 'bg-error-bg text-error border-[var(--status-error-border)] hover:brightness-110',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly icon?: ReactNode;
  /** Square, icon-only. Requires aria-label. */
  readonly iconOnly?: boolean;
  /** Overrides the tooltip text, which is otherwise the aria-label. */
  readonly tip?: ReactNode;
  readonly shortcut?: string;
  /** A second tooltip line: the consequence, or the caveat. */
  readonly hint?: ReactNode;
  readonly tipSide?: 'top' | 'right' | 'bottom' | 'left';
}

export function Button({
  variant = 'secondary',
  icon,
  iconOnly = false,
  className = '',
  tip,
  shortcut,
  hint,
  tipSide = 'top',
  children,
  ...rest
}: ButtonProps) {
  // An icon-only button labels itself, always. Asking every call site to
  // remember is how half of them end up unlabelled; the aria-label it already
  // needs for screen readers is the same sentence a tooltip wants.
  const label = tip ?? (iconOnly ? rest['aria-label'] : undefined);

  const button = (
    <button
      type="button"
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border text-[13px] font-medium outline-none transition-[transform,background-color,border-color,color] duration-[90ms] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 ${
        iconOnly ? 'h-[30px] w-[30px]' : 'h-[30px] px-3'
      } ${VARIANT[variant]} ${className}`}
      style={{
        transitionProperty: 'background-color, border-color, color, filter',
        transitionDuration: '90ms',
      }}
    >
      {icon}
      {iconOnly ? null : children}
    </button>
  );

  if (!label && !hint) return button;
  return (
    <Tip label={label} side={tipSide} {...(shortcut ? { shortcut } : {})} {...(hint ? { hint } : {})}>
      {button}
    </Tip>
  );
}
