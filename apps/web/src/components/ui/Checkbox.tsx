import { Check, Minus } from 'lucide-react';

/** A checkbox that hands back the click too, so shift can extend a range. */
export function Checkbox({
  checked,
  indeterminate = false,
  label,
  onChange,
  testId,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (next: boolean, event?: React.MouseEvent) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      data-testid={testId}
      data-state={indeterminate ? 'mixed' : checked ? 'checked' : 'unchecked'}
      onClick={(event) => onChange(!checked, event)}
      className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] border transition-[background-color,border-color,transform] duration-100 active:scale-90 ${
        checked || indeterminate
          ? 'border-accent bg-[var(--accent-solid)] text-white'
          : 'border-[var(--border-strong)] bg-sunken hover:border-accent'
      }`}
      style={{ boxShadow: '0 1px 0 var(--highlight) inset' }}
    >
      {indeterminate ? <Minus size={11} strokeWidth={3} /> : checked ? <Check size={11} strokeWidth={3} /> : null}
    </button>
  );
}
