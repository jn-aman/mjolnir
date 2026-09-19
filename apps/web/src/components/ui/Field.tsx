import { useState, type InputHTMLAttributes, type ReactNode } from 'react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly id: string;
  readonly label: string;
  /** Hide the label visually but keep it for screen readers. */
  readonly hideLabel?: boolean;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly error?: string;
  /** Live rule: a sentence when the value is wrong, shown once the field was touched. */
  readonly validate?: ((value: string) => string | null) | undefined;
  readonly mono?: boolean;
}

/**
 * A labelled input.
 *
 * The label is never optional, a placeholder disappears exactly when someone
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
  validate,
  mono = false,
  className = '',
  ...rest
}: FieldProps) {
  const [touched, setTouched] = useState(false);
  const value = typeof rest.value === 'string' ? rest.value : typeof rest.defaultValue === 'string' ? rest.defaultValue : '';
  const live = validate && (touched || value !== '') ? validate(value) : null;
  const shown = error ?? live ?? undefined;
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
          shown ? 'border-[var(--status-error)]' : 'border-line'
        }`}
        style={{ transitionProperty: 'border-color', transitionDuration: '90ms' }}
      >
        {leading}
        <input
          id={id}
          {...rest}
          onBlur={(event) => {
            setTouched(true);
            rest.onBlur?.(event);
          }}
          aria-invalid={shown ? true : undefined}
          className={`min-w-0 flex-1 bg-transparent text-[12.5px] text-primary outline-none placeholder:text-tertiary ${
            mono ? 'font-mono' : ''
          }`}
        />
        {trailing}
      </div>
      {shown ? <div className="mt-1.5 text-[11.5px] text-error" data-testid={`${id}-error`}>{shown}</div> : null}
    </div>
  );
}
