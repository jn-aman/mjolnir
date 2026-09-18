import * as RadixSwitch from '@radix-ui/react-switch';

/** The toggle, on Radix so it is a real switch to a screen reader. */
export function Switch({ checked, onChange, label, disabled = false, testId }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      className="relative h-[20px] w-[34px] shrink-0 rounded-full bg-[var(--border-strong)] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-45 data-[state=checked]:bg-[var(--accent-solid)]"
    >
      <RadixSwitch.Thumb
        className="block h-[16px] w-[16px] translate-x-[2px] rounded-full bg-white data-[state=checked]:translate-x-[16px]"
        style={{ transitionProperty: 'transform', transitionDuration: '160ms', transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
      />
    </RadixSwitch.Root>
  );
}
