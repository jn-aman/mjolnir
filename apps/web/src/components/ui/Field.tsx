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
 * The label is never optional — a placeholder disappears exactly when someone
 * needs it, which is while they are typing. `hideLabel` hides it visually and
 * keeps it in the accessibility tree.
 */
export function Field({
  id,
  label,
  hideLabel = false,
  leading,
  trailing,
  error,
  mono = false,
  className = '',
  ...rest
}: FieldProps) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'mb-1.5 block text-[11.5px] font-medium text-secondary'}
      >
        {label}
      </label>
      <div
        className={`flex h-[30px] items-center gap-2 rounded-md border bg-sunken px-2.5 focus-within:border-focus ${
          error ? 'border-[var(--status-error)]' : 'border-line'
        }`}
        style={{ transitionProperty: 'border-color', transitionDuration: '90ms' }}
      >
        {leading}
        <input
          id={id}
          {...rest}
          className={`min-w-0 flex-1 bg-transparent text-[12.5px] text-primary outline-none placeholder:text-tertiary ${
            mono ? 'font-mono' : ''
          }`}
        />
        {trailing}
      </div>
      {error ? <div className="mt-1.5 text-[11.5px] text-error">{error}</div> : null}
    </div>
  );
}
