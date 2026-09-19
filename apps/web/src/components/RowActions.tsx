import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { MenuEntry } from './ui/ContextMenu.tsx';

/**
 * What you can do to a row, on the row.
 *
 * The same verbs the right-click menu offers, because an action that lives
 * only behind right-click is an action most people never find. Edit and
 * delete get their own buttons since they are what people reach for; the
 * rest are behind the ellipsis. Visible on hover and whenever the menu is
 * open, so the row never flickers.
 */
export function RowActions({ entries, name }: { entries: readonly MenuEntry[]; name: string }) {
  // Opening the menu moves the pointer into a portal, which ends the row's
  // hover and used to fade the buttons out from under the cursor. The wrapper
  // has always had the rule for this; nothing was setting the attribute.
  const [open, setOpen] = useState(false);
  const items = entries.filter((entry): entry is Extract<MenuEntry, { id: string }> => entry.type !== 'separator' && entry.type !== 'heading');
  const edit = items.find((entry) => entry.id === 'yaml' || entry.id === 'edit');
  const remove = items.find((entry) => entry.id === 'delete' || entry.id === 'remove');
  const rest = items.filter((entry) => entry !== edit && entry !== remove);

  return (
    <span
      data-testid="row-actions"
      data-open={open}
      className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover/row:opacity-100 data-[open=true]:opacity-100"
    >
      {edit ? (
        <button
          type="button"
          data-testid="row-edit"
          aria-label={`Edit ${name}`}
          title={edit.label}
          disabled={edit.disabled ?? false}
          onClick={edit.onSelect}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-tertiary transition-colors duration-100 hover:bg-hover hover:text-primary disabled:opacity-40"
        >
          <Pencil size={13} strokeWidth={1.9} />
        </button>
      ) : null}
      {remove ? (
        <button
          type="button"
          data-testid="row-delete"
          aria-label={`Delete ${name}`}
          title={remove.label}
          disabled={remove.disabled ?? false}
          onClick={remove.onSelect}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-tertiary transition-colors duration-100 hover:bg-error-bg hover:text-error disabled:opacity-40"
        >
          <Trash2 size={13} strokeWidth={1.9} />
        </button>
      ) : null}
      {rest.length ? (
        <DropdownMenu.Root open={open} onOpenChange={setOpen}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              data-testid="row-more"
              aria-label={`More actions for ${name}`}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-tertiary transition-colors duration-100 hover:bg-hover hover:text-primary data-[state=open]:bg-hover data-[state=open]:text-primary"
            >
              <MoreHorizontal size={14} strokeWidth={2} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              collisionPadding={8}
              data-testid="row-more-menu"
              className="z-50 min-w-[216px] rounded-lg border border-line bg-overlay p-1 shadow-[var(--shadow-lg)]"
              style={{ transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)' }}
            >
              <DropdownMenu.Label className="break-words [overflow-wrap:anywhere] px-2 py-1 font-mono text-[11px] text-tertiary">{name}</DropdownMenu.Label>
              <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />
              {rest.map((entry) => (
                <DropdownMenu.Item
                  key={entry.id}
                  disabled={entry.disabled ?? false}
                  onSelect={entry.onSelect}
                  data-testid={`menu-${entry.id}`}
                  className={`flex cursor-pointer select-none items-center gap-2.5 rounded-sm px-2 py-[6px] text-[12.5px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${
                    entry.danger ? 'text-error data-[highlighted]:bg-error-bg' : 'text-secondary data-[highlighted]:bg-hover data-[highlighted]:text-primary'
                  }`}
                >
                  <span className="flex w-[14px] shrink-0 justify-center">{entry.icon}</span>
                  <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{entry.label}</span>
                  {entry.shortcut ? <kbd className="ml-4 shrink-0 font-sans text-[10.5px] text-tertiary">{entry.shortcut}</kbd> : null}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
    </span>
  );
}
