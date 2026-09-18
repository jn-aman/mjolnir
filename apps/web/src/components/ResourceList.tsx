import { useVirtualizer } from '@tanstack/react-virtual';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { motion } from 'motion/react';
import { Check, Columns3, GripVertical, RotateCcw } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { WatchState } from '@mjolnir/k8s';
import { type Column, type KubeItem, columnsFor } from './columns.tsx';
import { RowMenu } from './RowMenu.tsx';
import { useTablePrefs } from '../lib/tablePrefs.ts';

/**
 * One table for every resource kind.
 *
 * Columns can be resized, reordered by dragging a header, and hidden — stored
 * per kind, because the columns that matter for Pods are not the ones that
 * matter for Secrets and one shared layout would be wrong for both.
 *
 * Rows are virtualized and **never animated**. Easing a row into view misstates
 * when it arrived, and this is a tool people use to establish what happened
 * when. The container animates; the data does not.
 */

interface ResourceListProps {
  readonly kind: string;
  readonly items: KubeItem[];
  readonly state: WatchState;
  readonly error: string | null;
  readonly filter: string;
  readonly selectedName?: string | undefined;
  readonly onSelect?: (item: KubeItem) => void;
  readonly onAction?: (action: string, item: KubeItem) => void;
}

const ROW_HEIGHT = 34;
const MIN_WIDTH = 60;

type SortState = { readonly columnId: string; readonly direction: 'asc' | 'desc' } | null;

/** Parses a grid track like `minmax(260px, 2fr)` or `72px` into a start width. */
function defaultWidth(track: string): number {
  const minmax = /minmax\((\d+)px/.exec(track);
  if (minmax?.[1]) return Number(minmax[1]);
  const fixed = /(\d+)px/.exec(track);
  return fixed?.[1] ? Number(fixed[1]) : 140;
}

export function ResourceList({
  kind,
  items,
  state,
  error,
  filter,
  selectedName,
  onSelect,
  onAction,
}: ResourceListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const resizing = useRef<{ id: string; startX: number; startWidth: number } | null>(null);

  const { prefs, update, reset } = useTablePrefs(kind);
  const all = useMemo(() => columnsFor(kind), [kind]);

  /** Columns in the user's order, with hidden ones removed. */
  const columns = useMemo(() => {
    const byId = new Map(all.map((column) => [column.id, column]));
    const ordered = prefs.order.length
      ? [
          ...prefs.order.map((id) => byId.get(id)).filter((c): c is Column<KubeItem> => Boolean(c)),
          ...all.filter((column) => !prefs.order.includes(column.id)),
        ]
      : all;
    return ordered.filter((column) => !prefs.hidden.includes(column.id));
  }, [all, prefs.order, prefs.hidden]);

  const widthOf = useCallback(
    (column: Column<KubeItem>) => prefs.widths[column.id] ?? defaultWidth(column.width),
    [prefs.widths],
  );

  // Fixed pixel tracks once a width is known, so a resize moves one edge rather
  // than re-flowing every other column at the same time.
  const template = useMemo(
    () => columns.map((column) => `${widthOf(column)}px`).join(' '),
    [columns, widthOf],
  );

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? items.filter((item) =>
          [
            item.metadata?.name,
            item.metadata?.namespace,
            ...columns.map((column) => column.searchText?.(item)),
          ].some((value) => value?.toLowerCase().includes(needle)),
        )
      : items;

    if (!sort) return filtered;
    const column = columns.find((entry) => entry.id === sort.columnId);
    if (!column?.sortBy) return filtered;

    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = column.sortBy?.(a) ?? '';
      const right = column.sortBy?.(b) ?? '';
      if (left === right) return 0;
      return left > right ? direction : -direction;
    });
  }, [items, filter, sort, columns]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const toggleSort = (column: Column<KubeItem>) => {
    if (!column.sortBy) return;
    setSort((current) => {
      if (current?.columnId !== column.id) return { columnId: column.id, direction: 'asc' };
      if (current.direction === 'asc') return { columnId: column.id, direction: 'desc' };
      return null;
    });
  };

  const startResize = (event: React.PointerEvent, column: Column<KubeItem>) => {
    event.preventDefault();
    event.stopPropagation();
    resizing.current = { id: column.id, startX: event.clientX, startWidth: widthOf(column) };

    const move = (moveEvent: PointerEvent) => {
      const context = resizing.current;
      if (!context) return;
      const next = Math.max(MIN_WIDTH, context.startWidth + (moveEvent.clientX - context.startX));
      update({ widths: { ...prefs.widths, [context.id]: next } });
    };
    const stop = () => {
      resizing.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const dropColumn = (targetId: string) => {
    if (!dragging || dragging === targetId) return;
    const ids = columns.map((column) => column.id);
    const from = ids.indexOf(dragging);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    update({ order: [...ids, ...prefs.hidden] });
    setDragging(null);
    setDropTarget(null);
  };

  // "Connecting" and "genuinely empty" look identical if you only check length.
  // Conflating them is the most common way a cluster UI lies to you.
  if (state === 'connecting' && items.length === 0) {
    return <ListMessage testId="resource-loading">Connecting to the cluster…</ListMessage>;
  }

  if (state === 'error' && items.length === 0) {
    return (
      <ListMessage testId="resource-error" tone="error">
        {error ?? 'The watch could not be established.'}
      </ListMessage>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="resource-list" data-kind={kind}>
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
        <div
          role="row"
          className="sticky top-0 z-10 grid h-[32px] shrink-0 items-center border-b border-line bg-raised text-[11px] font-semibold uppercase tracking-[0.05em] text-tertiary"
          style={{ gridTemplateColumns: `${template} 1fr` }}
        >
          {columns.map((column) => (
            <div
              key={column.id}
              draggable
              onDragStart={() => setDragging(column.id)}
              onDragOver={(event) => {
                event.preventDefault();
                setDropTarget(column.id);
              }}
              onDragLeave={() => setDropTarget((current) => (current === column.id ? null : current))}
              onDrop={() => dropColumn(column.id)}
              onDragEnd={() => {
                setDragging(null);
                setDropTarget(null);
              }}
              className={`group relative flex h-full items-center gap-1 px-3 ${
                column.align === 'right' ? 'justify-end' : 'justify-start'
              } ${dragging === column.id ? 'opacity-40' : ''} ${
                dropTarget === column.id ? 'bg-accent-subtle' : ''
              }`}
            >
              <GripVertical
                size={11}
                strokeWidth={2}
                aria-hidden
                className="absolute left-0.5 cursor-grab text-transparent group-hover:text-[var(--border-strong)]"
              />
              <button
                type="button"
                onClick={() => toggleSort(column)}
                disabled={!column.sortBy}
                className={`truncate text-inherit transition-colors duration-100 ${
                  column.sortBy ? 'cursor-pointer hover:text-secondary' : 'cursor-default'
                }`}
              >
                {column.header}
              </button>
              {sort?.columnId === column.id ? (
                <motion.span
                  layoutId="sort-indicator"
                  aria-hidden
                  className="text-accent"
                  transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                >
                  {sort.direction === 'asc' ? '↑' : '↓'}
                </motion.span>
              ) : null}

              {/* A wide invisible grip: a 1px divider is not a usable target. */}
              <span
                onPointerDown={(event) => startResize(event, column)}
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${column.header}`}
                className="absolute right-0 top-0 h-full w-[7px] cursor-col-resize after:absolute after:right-[3px] after:top-[6px] after:h-[20px] after:w-px after:bg-[var(--border-default)] hover:after:bg-accent"
              />
            </div>
          ))}

          <div className="flex h-full items-center justify-end pr-2">
            <ColumnMenu
              all={all}
              hidden={prefs.hidden}
              onToggle={(id) =>
                update({
                  hidden: prefs.hidden.includes(id)
                    ? prefs.hidden.filter((entry) => entry !== id)
                    : [...prefs.hidden, id],
                })
              }
              onReset={reset}
            />
          </div>
        </div>

        {visible.length === 0 ? (
          <ListMessage testId="resource-empty">
            {filter ? `Nothing matches “${filter}”.` : `No ${kind.toLowerCase()}s here.`}
          </ListMessage>
        ) : (
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((row) => {
                const item = visible[row.index];
                if (!item) return null;
                const selected = item.metadata?.name === selectedName;
                const act = (action: string) => onAction?.(action, item);

                return (
                  <RowMenu
                    key={item.metadata?.name ?? row.index}
                    item={item}
                    kind={kind}
                    onOpen={() => onSelect?.(item)}
                    onLogs={() => act('logs')}
                    onShell={() => act('shell')}
                    onYaml={() => act('yaml')}
                    onRestart={() => act('restart')}
                    onScale={() => act('scale')}
                    onDelete={() => act('delete')}
                  >
                    <div
                      data-testid="resource-row"
                      data-selected={selected}
                      role="row"
                      tabIndex={0}
                      onClick={() => onSelect?.(item)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelect?.(item);
                        }
                      }}
                      className={`absolute inset-x-0 grid cursor-pointer items-center border-b border-subtle transition-colors duration-100 ${
                        selected ? 'bg-pressed' : 'hover:bg-hover'
                      }`}
                      style={{
                        gridTemplateColumns: `${template} 1fr`,
                        height: row.size,
                        transform: `translateY(${row.start}px)`,
                      }}
                    >
                      {selected ? (
                        <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-accent" />
                      ) : null}
                      {columns.map((column) => (
                        <div
                          key={column.id}
                          data-testid={`cell-${column.id}`}
                          className={`flex min-w-0 items-center px-3 ${
                            column.align === 'right' ? 'justify-end' : 'justify-start'
                          }`}
                        >
                          {column.content(item)}
                        </div>
                      ))}
                      <div />
                    </div>
                  </RowMenu>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-raised px-4 font-mono text-[11px] text-tertiary">
        <span data-testid="resource-count">
          {visible.length === items.length
            ? `${items.length} ${kind.toLowerCase()}`
            : `${visible.length} of ${items.length}`}
        </span>
        {state === 'synced' ? <span className="text-ok">watching</span> : null}
        {state === 'error' ? <span className="text-warn">reconnecting</span> : null}
      </div>
    </div>
  );
}

function ColumnMenu({
  all,
  hidden,
  onToggle,
  onReset,
}: {
  all: Array<Column<KubeItem>>;
  hidden: string[];
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="column-menu"
          aria-label="Choose columns"
          className="flex h-[22px] w-[22px] items-center justify-center rounded-sm text-tertiary transition-colors duration-100 hover:bg-hover hover:text-primary"
        >
          <Columns3 size={13} strokeWidth={1.9} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[190px] rounded-lg border border-line bg-overlay p-1 shadow-[var(--shadow-lg)]"
          style={{ animation: 'mjolnir-menu-in 140ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          <DropdownMenu.Label className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-tertiary">
            Columns
          </DropdownMenu.Label>
          {all.map((column) => {
            const shown = !hidden.includes(column.id);
            return (
              <DropdownMenu.Item
                key={column.id}
                onSelect={(event) => {
                  // Keeps the menu open so several columns can be toggled at once.
                  event.preventDefault();
                  onToggle(column.id);
                }}
                className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-[6px] text-[12.5px] text-secondary outline-none data-[highlighted]:bg-hover data-[highlighted]:text-primary"
              >
                <Check
                  size={13}
                  strokeWidth={2.4}
                  aria-hidden
                  className="shrink-0 text-accent"
                  style={{ opacity: shown ? 1 : 0 }}
                />
                {column.header}
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />
          <DropdownMenu.Item
            onSelect={onReset}
            className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-[6px] text-[12.5px] text-secondary outline-none data-[highlighted]:bg-hover data-[highlighted]:text-primary"
          >
            <RotateCcw size={13} strokeWidth={1.9} aria-hidden className="shrink-0" />
            Reset layout
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ListMessage({
  children,
  testId,
  tone = 'muted',
}: {
  children: React.ReactNode;
  testId: string;
  tone?: 'muted' | 'error';
}) {
  return (
    <div
      data-testid={testId}
      className={`flex min-h-0 flex-1 items-center justify-center p-8 text-[13px] ${
        tone === 'error' ? 'text-error' : 'text-tertiary'
      }`}
    >
      {children}
    </div>
  );
}
