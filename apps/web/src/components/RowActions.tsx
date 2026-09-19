import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, Pin } from 'lucide-react';
import type { MenuEntry, MenuItem } from './ui/ContextMenu.tsx';

/**
 * What you can do to a row, on the row.
 *
 * Visible, always. Actions that appear only on hover are actions people do not
 * know exist, and a button that fades out the moment you click it, because the
 * click moved the pointer into a portal and ended the row's hover, is worse
 * than no button. So the verbs sit at a resting weight and brighten on hover
 * rather than appearing from nothing.
 *
 * Which verbs get a button is decided by id, not by the caller, so Kubernetes
 * rows, containers and bucket objects all promote the same shapes: the thing
 * you read (logs, preview), the thing you keep (pin), the thing you change
 * (edit), the thing you destroy (delete). Everything else is behind the
 * ellipsis, which still holds the full menu.
 */

/** Promoted to their own button, in this order. Destructive ones sit last. */
const PRIMARY = ['logs', 'shell', 'preview', 'download', 'pin', 'yaml', 'edit'] as const;
const DESTRUCTIVE = ['delete', 'remove'] as const;
/** Beyond this the row turns into a toolbar; the rest stays in the menu. */
const MAX_PRIMARY = 4;

type Item = Extract<MenuEntry, MenuItem>;

const rank = (id: string) => {
  const at = PRIMARY.indexOf(id as (typeof PRIMARY)[number]);
  return at === -1 ? Number.MAX_SAFE_INTEGER : at;
};

export function RowActions({ entries, name }: { entries: readonly MenuEntry[]; name: string }) {
  const [open, setOpen] = useState(false);
  const items = entries.filter((entry): entry is Item => entry.type !== 'separator' && entry.type !== 'heading');

  const primary = items
    .filter((entry) => PRIMARY.includes(entry.id as (typeof PRIMARY)[number]))
    .sort((a, b) => rank(a.id) - rank(b.id))
    .slice(0, MAX_PRIMARY);
  const destructive = items.filter((entry) => DESTRUCTIVE.includes(entry.id as (typeof DESTRUCTIVE)[number]));
  const shown = new Set<Item>([...primary, ...destructive]);
  const rest = items.filter((entry) => !shown.has(entry));

  return (
    <span data-testid="row-actions" data-open={open} className="flex items-center gap-0.5">
      {primary.map((entry) => (
        <Action key={entry.id} entry={entry} name={name} />
      ))}
      {destructive.map((entry) => (
        <Action key={entry.id} entry={entry} name={name} danger />
      ))}
      {rest.length ? (
        <DropdownMenu.Root open={open} onOpenChange={setOpen}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              data-testid="row-more"
              aria-label={`More actions for ${name}`}
              title="More actions"
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
              className="z-50 min-w-[216px] max-w-[340px] rounded-lg border border-line bg-overlay p-1 shadow-[var(--shadow-lg)]"
              style={{ transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)' }}
            >
              <DropdownMenu.Label title={name} className="block max-w-full truncate px-2 py-1 font-mono text-[11px] text-tertiary">{name}</DropdownMenu.Label>
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

function Action({ entry, name, danger }: { entry: Item; name: string; danger?: boolean }) {
  // Pin earns the accent: it is the one verb here that is not obvious from an
  // icon alone, and it is how the dock gets used at all.
  const pin = entry.id === 'pin';
  return (
    <button
      type="button"
      data-testid={`row-${entry.id}`}
      aria-label={`${entry.label} ${name}`}
      title={entry.label}
      disabled={entry.disabled ?? false}
      onClick={(event) => {
        event.stopPropagation();
        entry.onSelect();
      }}
      className={`flex h-[26px] w-[26px] items-center justify-center rounded-md transition-colors duration-100 disabled:opacity-40 ${
        danger
          ? 'text-tertiary hover:bg-error-bg hover:text-error'
          : pin
            ? 'text-tertiary hover:bg-accent-subtle hover:text-accent'
            : 'text-tertiary hover:bg-hover hover:text-primary'
      }`}
    >
      {entry.icon ?? <Pin size={13} strokeWidth={1.9} />}
    </button>
  );
}
