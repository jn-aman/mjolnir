import * as ContextMenu from '@radix-ui/react-context-menu';
import { Copy, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { ReactNode } from 'react';

/**
 * The right-click menu, once.
 *
 * Everything in Mjolnir that names a thing, a row, a cluster tile, a label
 * chip, a log line, a legend entry, a stat tile, carries one of these. A
 * context menu is a shortcut, never the only route: every action here is also
 * reachable from a visible control, because an action that exists only behind
 * right-click is an action most people never find.
 *
 * Entries are data, not JSX, so callers describe *what* can be done and this
 * component owns how a menu looks, animates and separates its groups. Runs of
 * separators collapse and edge separators are dropped, so callers can build
 * lists conditionally without counting.
 */

export interface MenuItem {
  readonly type?: 'item';
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly shortcut?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export type MenuEntry = MenuItem | { readonly type: 'separator' } | { readonly type: 'heading'; readonly label: string };

export const SEPARATOR: MenuEntry = { type: 'separator' };

/** Writes to the clipboard and says so; silent copying leaves people clicking twice. */
export function copyText(text: string, what = 'Copied'): void {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(what, { duration: 1400 }),
    () => toast.error('Clipboard is not available'),
  );
}

/** A "Copy X" entry, or nothing when there is no X. Spread it into a list. */
export function copyEntry(id: string, label: string, text: string | undefined | null): MenuEntry[] {
  if (!text) return [];
  const what = `${label.replace(/^Copy /i, '')} copied`;
  return [
    {
      id,
      label,
      icon: <Copy size={13} strokeWidth={1.9} />,
      onSelect: () => copyText(text, what.charAt(0).toUpperCase() + what.slice(1)),
    },
  ];
}

/**
 * "Ask the assistant" from anywhere. The prompt carries what was right-clicked
 * so the model starts with the context instead of asking for it. Dispatched as
 * an event because every menu in the app would otherwise need a prop for it.
 */
export function askAssistant(prompt: string): void {
  window.dispatchEvent(new CustomEvent('mjolnir:ask', { detail: prompt }));
}

export function askEntry(label: string, prompt: string): MenuEntry {
  return { id: 'ask', label, icon: <Sparkles size={13} strokeWidth={1.9} />, onSelect: () => askAssistant(prompt) };
}

function tidy(entries: readonly MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    const isSeparator = entry.type === 'separator';
    if (isSeparator && (out.length === 0 || out[out.length - 1]?.type === 'separator')) continue;
    out.push(entry);
  }
  while (out.length && out[out.length - 1]?.type === 'separator') out.pop();
  return out;
}

interface MenuProps {
  /** Shown as a monospace heading at the top, the name of the thing. */
  readonly label?: string | undefined;
  readonly entries: readonly MenuEntry[];
  readonly children: ReactNode;
  readonly testId?: string;
}

export function Menu({ label, entries, children, testId = 'context-menu' }: MenuProps) {
  const visible = tidy(entries);
  if (visible.length === 0) return <>{children}</>;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          data-testid={testId}
          className="z-50 min-w-[216px] rounded-lg border border-line bg-overlay p-1 shadow-[var(--shadow-lg)]"
        >
          {label ? (
            <>
              <ContextMenu.Label className="truncate px-2 py-1 font-mono text-[11px] text-tertiary">{label}</ContextMenu.Label>
              <Separator />
            </>
          ) : null}
          {visible.map((entry, index) => {
            if (entry.type === 'separator') return <Separator key={`sep-${index}`} />;
            if (entry.type === 'heading') {
              return (
                <ContextMenu.Label key={`head-${index}`} className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">
                  {entry.label}
                </ContextMenu.Label>
              );
            }
            return (
              <ContextMenu.Item
                key={entry.id}
                data-testid={`menu-${entry.id}`}
                disabled={entry.disabled ?? false}
                onSelect={entry.onSelect}
                className={`flex cursor-pointer select-none items-center gap-2.5 rounded-sm px-2 py-[6px] text-[12.5px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${
                  entry.danger
                    ? 'text-error data-[highlighted]:bg-error-bg'
                    : 'text-secondary data-[highlighted]:bg-hover data-[highlighted]:text-primary'
                }`}
              >
                <span className="flex w-[14px] shrink-0 justify-center">{entry.icon}</span>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.shortcut ? (
                  <kbd className="ml-4 shrink-0 font-sans text-[10.5px] text-tertiary">{entry.shortcut}</kbd>
                ) : null}
              </ContextMenu.Item>
            );
          })}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function Separator() {
  return <ContextMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />;
}
