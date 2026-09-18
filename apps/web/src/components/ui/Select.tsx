import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * A select built on Radix, not a native `<select>`.
 *
 * A native select renders an **operating-system** popup: system fonts, system
 * colours, system corner radius, ignoring every token in the design system. On
 * a dense dark interface it lands like a hole punched through the app, and no
 * amount of styling the closed state fixes the open one, because the menu is
 * drawn by the OS and not by us.
 *
 * Radix gives us the menu as real DOM — so it inherits the tokens — while
 * keeping the keyboard and screen-reader behaviour a native select has and a
 * hand-rolled div never does: typeahead, arrow keys, Home/End, Escape, focus
 * return, and a correct `aria` tree.
 */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  /** Rendered to the right of the label — a count, a status, a hint. */
  readonly hint?: string | undefined;
  readonly icon?: ReactNode;
}

interface SelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly testId?: string;
  /** Rendered in place of the default pill. */
  readonly trigger?: ReactNode;
  readonly align?: 'start' | 'end';
  readonly mono?: boolean;
}

export function Select({
  label,
  value,
  options,
  onChange,
  testId,
  trigger,
  align = 'start',
  mono = false,
}: SelectProps) {
  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            data-testid={testId}
            aria-label={label}
            className="group flex h-[30px] max-w-[260px] items-center gap-1.5 rounded-md border border-line bg-sunken pl-2.5 pr-2 text-[12.5px] text-primary outline-none hover:border-strong data-[state=open]:border-focus"
            style={{ transitionProperty: 'border-color', transitionDuration: '90ms' }}
          >
            {selected?.icon}
            <span className={`min-w-0 flex-1 truncate text-left ${mono ? 'font-mono' : ''}`}>
              {selected?.label ?? label}
            </span>
            <ChevronDown
              size={13}
              strokeWidth={2}
              aria-hidden
              className="shrink-0 text-tertiary group-data-[state=open]:text-secondary"
            />
          </button>
        )}
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={5}
          collisionPadding={8}
          data-testid={testId ? `${testId}-menu` : undefined}
          className="z-50 max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-lg border border-line bg-overlay p-1 shadow-[var(--shadow-lg)]"
          style={{
            // Grows from the trigger it belongs to, so the eye keeps its place.
            transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)',
            animation: 'mjolnir-menu-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <DropdownMenu.Item
                key={option.value}
                onSelect={() => onChange(option.value)}
                className={`flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-[6px] text-[12.5px] outline-none data-[highlighted]:bg-hover ${
                  active ? 'text-primary' : 'text-secondary'
                }`}
              >
                <Check
                  size={13}
                  strokeWidth={2.4}
                  aria-hidden
                  className="shrink-0 text-accent"
                  style={{ opacity: active ? 1 : 0 }}
                />
                {option.icon}
                <span className={`min-w-0 flex-1 truncate ${mono ? 'font-mono' : ''}`}>
                  {option.label}
                </span>
                {option.hint ? (
                  <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-tertiary">
                    {option.hint}
                  </span>
                ) : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
