import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
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
 * Radix gives us the menu as real DOM, so it inherits the tokens, while
 * keeping the keyboard and screen-reader behaviour a native select has and a
 * hand-rolled div never does: typeahead, arrow keys, Home/End, Escape, focus
 * return, and a correct `aria` tree.
 */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  /** Rendered to the right of the label, a count, a status, a hint. */
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
  /** A fixed trigger width so the toolbar does not shift when the value changes. */
  readonly width?: number;
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
  width = 176,
}: SelectProps) {
  const selected = options.find((option) => option.value === value);
  // Every list gets a search box, however short: typing is the one gesture
  // that works the same on a 3-item list and a 400-item one.
  const searchable = true;
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((option) => `${option.label} ${option.value} ${option.hint ?? ''}`.toLowerCase().includes(needle)) : options;

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (!open) setQuery('');
        // Radix focuses the first item on open; the search box takes over a tick later.
        else if (searchable) setTimeout(() => searchRef.current?.focus(), 0);
      }}
    >
      <DropdownMenu.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            data-testid={testId}
            aria-label={label}
            className="group flex h-[30px] items-center gap-1.5 rounded-md border border-line bg-sunken pl-2.5 pr-2 text-[12.5px] text-primary outline-none hover:border-strong data-[state=open]:border-focus"
            style={{ width, transitionProperty: 'border-color', transitionDuration: '90ms' }}
          >
            {selected?.icon}
            <span className={`min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-left ${mono ? 'font-mono' : ''}`}>
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
          ref={contentRef}
          align={align}
          sideOffset={5}
          collisionPadding={8}
          data-testid={testId ? `${testId}-menu` : undefined}
          className="z-50 max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-lg border border-line bg-overlay p-1 shadow-[var(--shadow-lg)]"
          style={{
            // Grows from the trigger it belongs to, so the eye keeps its place.
            transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)',
          }}
        >
          {searchable ? (
            <div className="sticky -top-1 z-10 -mx-1 -mt-1 mb-1 border-b border-line bg-overlay p-1.5">
              <div className="flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2">
                <Search size={12} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    // Typing must not trigger the menu's typeahead; arrows hand off to the list.
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
                      return;
                    }
                    if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
                  }}
                  placeholder={`Search ${options.length}…`}
                  aria-label={`Search ${label}`}
                  data-testid={testId ? `${testId}-search` : undefined}
                  className="h-[28px] w-full bg-transparent text-[12.5px] text-primary outline-none placeholder:text-tertiary"
                />
              </div>
            </div>
          ) : null}
          {shown.length === 0 ? <div className="px-2 py-2 text-[12px] text-tertiary">Nothing matches.</div> : null}
          {shown.map((option) => {
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
                <span className={`min-w-0 flex-1 break-words [overflow-wrap:anywhere] ${mono ? 'font-mono' : ''}`}>
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
