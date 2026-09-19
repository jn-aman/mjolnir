import { useVirtualizer } from '@tanstack/react-virtual';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Columns3, GripVertical, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WatchState } from '@mjolnir/k8s';
import { type Column, type KubeItem, type PrinterColumn, columnsFor } from './columns.tsx';
import { rowMenuEntries, type RowActionId } from './RowMenu.tsx';
import { RowActions } from './RowActions.tsx';
import { Checkbox } from './ui/Checkbox.tsx';
import { Menu, type MenuEntry } from './ui/ContextMenu.tsx';
import { KindMark } from './ui/KindMark.tsx';
import { OverflowTip } from './ui/OverflowTip.tsx';
import { EmptyState, LoadingState } from './ui/States.tsx';
import { useTablePrefs } from '../lib/tablePrefs.ts';
import { useFlags } from '../lib/flags.tsx';

/**
 * One table for every resource kind.
 *
 * Columns can be resized, reordered by dragging a header, and hidden, stored
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
  /** Extra columns a CustomResourceDefinition asks kubectl to print. */
  readonly printerColumns?: readonly PrinterColumn[];
  /** Lets an empty result clear the search that caused it. */
  readonly onClearFilter?: (() => void) | undefined;
  /** The kind's label as people say it: "Role bindings", not "rolebindings". */
  readonly label?: string | undefined;
  readonly namespace?: string | undefined;
  readonly selectedName?: string | undefined;
  readonly onSelect?: (item: KubeItem) => void;
  readonly onAction?: (action: string, item: KubeItem) => void;
  /** Replaces the Kubernetes row menu, for lists of other things. */
  readonly menu?: ((item: KubeItem) => MenuEntry[]) | undefined;
  /** Verbs for several rows at once. A checkbox column appears when given. */
  readonly bulk?: readonly BulkAction[] | undefined;
  /**
   * What "there is nothing here" means for this list. The default talks about
   * namespaces and watches, which is right for Kubernetes and nonsense for a
   * bucket or a container list.
   */
  readonly empty?: { readonly title: string; readonly detail: string } | undefined;
  /**
   * Reports the count and the watch state so the toolbar can show them.
   *
   * They used to live in a status bar along the bottom, which spent a whole
   * row of the window on two short words and put them as far from the filter
   * that changes them as the window allows. The toolbar already had the empty
   * space and already holds everything else about what is on screen.
   */
  readonly onStatus?: ((status: { visible: number; total: number; state: WatchState }) => void) | undefined;
}

const ROW_HEIGHT = 42;
const HEADER_HEIGHT = 36;
const MIN_WIDTH = 60;

type SortState = { readonly columnId: string; readonly direction: 'asc' | 'desc' } | null;

/** Parses a grid track like `minmax(260px, 2fr)` or `72px` into a start width. */
function defaultWidth(track: string): number {
  const minmax = /minmax\((\d+)px/.exec(track);
  if (minmax?.[1]) return Number(minmax[1]);
  const fixed = /(\d+)px/.exec(track);
  return fixed?.[1] ? Number(fixed[1]) : 140;
}

const deepTextCache = new WeakMap<object, string>();
/** Every string and number in the object, lowercased, once per object. */
function deepText(item: object): string {
  const cached = deepTextCache.get(item);
  if (cached !== undefined) return cached;
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') parts.push(String(value));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object') {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'managedFields') continue;
        parts.push(key);
        walk(inner);
      }
    }
  };
  walk(item);
  const text = parts.join(' ').toLowerCase();
  deepTextCache.set(item, text);
  return text;
}

export interface BulkAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: React.ReactNode;
  readonly danger?: boolean;
  /** Runs on the selected rows; the selection clears when it resolves. */
  readonly run: (items: KubeItem[]) => Promise<void> | void;
  /** Offered only when every selected row passes. */
  readonly applies?: (item: KubeItem) => boolean;
}

const rowKey = (item: KubeItem) => `${item.metadata?.namespace ?? ''}/${item.metadata?.name ?? ''}`;

export function ResourceList({
  kind,
  items,
  state,
  error,
  filter,
  printerColumns,
  onClearFilter,
  label,
  namespace,
  selectedName,
  onSelect,
  onAction,
  menu,
  bulk,
  empty,
  onStatus,
}: ResourceListProps) {
  const { values: flags } = useFlags();
  // Each surface asks for itself rather than reading one "advanced table"
  // flag, so a build can keep the columns and drop the bulk verbs, which is
  // the combination people actually ask for.
  const canColumns = flags['ui.columns'] ?? true;
  const canBulk = (flags['ui.bulk-actions'] ?? true) && Boolean(bulk?.length);
  const deepSearch = flags['ui.deep-search'] ?? true;

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const chosen = () => visible.filter((item) => picked.has(rowKey(item)));
  useEffect(() => {
    // A row that goes away takes its tick with it.
    setPicked((current) => {
      if (current.size === 0) return current;
      const present = new Set(items.map(rowKey));
      if ([...current].every((k) => present.has(k))) return current;
      return new Set([...current].filter((k) => present.has(k)));
    });
  }, [items]);
  useEffect(() => {
    setPicked(new Set());
  }, [kind]);
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Freeze the actions only when there is something to scroll.
   *
   * A frozen column floats over whatever is beneath it, which is the point
   * when the table is wider than the window and the wrong thing entirely when
   * it is not: the actions sat on top of the last two columns and hid them
   * for no gain, because nothing was out of reach in the first place.
   */
  const [overflowing, setOverflowing] = useState(false);
  /**
   * Whether there is anything left to scroll to, in each direction.
   *
   * Needed because a frozen column is an excellent way to hide the fact that
   * a table scrolls at all. With the actions pinned flush right and every
   * other column ending before them, the table looks finished: the last thing
   * you can see is the last thing there is, except it is not. The edges say
   * so, and stop saying so when it is true.
   */
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const check = () => {
      const scrollable = element.scrollWidth - element.clientWidth;
      setOverflowing(scrollable > 1);
      setMore({
        left: element.scrollLeft > 1,
        // One pixel of slack: sub-pixel column widths mean the maximum
        // scrollLeft is rarely exactly the scrollable distance.
        right: element.scrollLeft < scrollable - 1,
      });
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    element.addEventListener('scroll', check, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', check);
    };
  });
  const [sort, setSort] = useState<SortState>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const resizing = useRef<{ id: string; startX: number; startWidth: number } | null>(null);

  const { prefs, update, reset } = useTablePrefs(kind);
  const all = useMemo(() => columnsFor(kind, printerColumns), [kind, printerColumns]);

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
    () =>
      columns
        .map((column) => {
          const px = widthOf(column);
          // The name column soaks up whatever is left, unless the user has
          // dragged it to a size, a chosen width is a chosen width.
          if (column.id === 'name' && prefs.widths[column.id] === undefined) {
            return `minmax(${Math.min(px, 220)}px, 340px)`;
          }
          return `${px}px`;
        })
        .join(' '),
    [columns, widthOf, prefs.widths],
  );

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    // Column text first because it is what the eye compared against; then the
    // whole object, so an image tag, a label, an env value or an IP finds the
    // row even when no column shows it. Multiple words all have to match.
    const words = needle.split(/\s+/).filter(Boolean);
    const filtered = words.length
      ? items.filter((item) => {
          const shown = [item.metadata?.name, item.metadata?.namespace, ...columns.map((column) => column.searchText?.(item))]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          // Without the deep flag the filter only sees what is on screen,
          // which is the behaviour every other table has and is a defensible
          // build; with it, an image tag or an env value finds its row.
          const whole = deepSearch ? deepText(item) : '';
          return words.every((word) => shown.includes(word) || whole.includes(word));
        })
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
  }, [items, filter, sort, columns, deepSearch]);

  /**
   * Reports what is on screen, for the toolbar above it.
   *
   * Up rather than rendered here, because the thing that shows it sits in
   * the toolbar beside the filter that changes it.
   */
  useEffect(() => {
    onStatus?.({ visible: visible.length, total: items.length, state });
  }, [onStatus, visible.length, items.length, state]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    // The header shares the scroll container, so the rows start this far in.
    scrollMargin: HEADER_HEIGHT,
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
    return (
      <LoadingState
        testId="resource-loading"
        title={`Watching ${(label ?? kind).toLowerCase()}`}
        detail={namespace ? `in ${namespace}` : 'across every namespace'}
      />
    );
  }

  if (state === 'error' && items.length === 0) {
    return (
      <EmptyState
        testId="resource-error"
        tone="error"
        title="The watch could not be established"
        detail={error ?? 'The cluster did not answer. The connection pill in the header says whether it is reachable at all.'}
      />
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-testid="resource-list" data-kind={kind}>
      {/*
        One scroll container, both axes. Nesting an overflow-y box inside an
        overflow-x box gave the table two horizontal scrollbars stacked at the
        bottom, because an element with one axis set to `auto` computes the
        other from `visible` to `auto` as well. It also clipped the rows to the
        viewport width while the header scrolled past them.
      */}
      {/*
        A scrollbar, on purpose, whenever the table is wider than the window.
        
        macOS hides overlay scrollbars until you touch the trackpad, so a wide
        table looks finished: the last column you can see reads as the last
        column there is. A gradient at the edge was tried and reads as a
        smudge rather than as "there is more"; the control everybody already
        understands is the scrollbar, so the table keeps one.
      */}
      <div ref={scrollRef} className={`min-h-0 min-w-0 flex-1 overflow-auto ${overflowing ? 'table-scroller' : ''}`}>
       <div className="flex min-h-full min-w-max flex-col">
        <div
          role="row"
          className="sticky top-0 z-10 grid h-[36px] shrink-0 items-center border-b border-line bg-raised text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary"
          style={{ gridTemplateColumns: `${canBulk ? '38px ' : ''}${template} minmax(176px, max-content)` }}
        >
          {canBulk ? (
            <div className="flex h-full items-center justify-center">
              <Checkbox
                checked={visible.length > 0 && visible.every((item) => picked.has(rowKey(item)))}
                indeterminate={picked.size > 0 && !visible.every((item) => picked.has(rowKey(item)))}
                label="Select every row"
                testId="select-all"
                onChange={(next) => setPicked(next ? new Set(visible.map(rowKey)) : new Set())}
              />
            </div>
          ) : null}
          {columns.map((column) => (
            <div
              key={column.id}
              draggable={canColumns}
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
              {canColumns ? (
                <GripVertical
                  size={11}
                  strokeWidth={2}
                  aria-hidden
                  className="absolute left-0.5 cursor-grab text-transparent group-hover:text-[var(--border-strong)]"
                />
              ) : null}
              <button
                type="button"
                onClick={() => toggleSort(column)}
                disabled={!column.sortBy}
                className={`break-words [overflow-wrap:anywhere] text-inherit transition-colors duration-100 ${
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
              {canColumns ? (
              <span
                onPointerDown={(event) => startResize(event, column)}
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${column.header}`}
                className="absolute right-0 top-0 h-full w-[7px] cursor-col-resize after:absolute after:right-[3px] after:top-[6px] after:h-[20px] after:w-px after:bg-[var(--border-default)] hover:after:bg-accent"
              />
              ) : null}
            </div>
          ))}

          <div className={`flex h-full items-center justify-end pl-2 pr-1.5 ${overflowing ? 'cell-pinned-header' : ''} ${more.right ? 'cell-covering' : ''}`}>
            {canColumns ? (
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
            ) : null}
          </div>
        </div>

        {visible.length === 0 ? (
          filter ? (
            <EmptyState
              testId="resource-empty"
              title={`Nothing matches “${filter}”`}
              detail={`${items.length} ${(label ?? kind).toLowerCase()} ${items.length === 1 ? 'is' : 'are'} here, and none of them match. The filter searches every field, not only the columns on screen.`}
              action={
                onClearFilter ? (
                  <button type="button" data-testid="clear-filter" onClick={onClearFilter} className="btn-secondary flex h-[28px] items-center rounded-md border border-line px-2.5 text-[12px] text-secondary hover:text-primary">
                    Clear the filter
                  </button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              testId="resource-empty"
              title={empty?.title ?? `No ${(label ?? kind).toLowerCase()} ${namespace ? `in ${namespace}` : 'in this cluster'}`}
              detail={
                empty?.detail ??
                (namespace
                  ? 'Nothing is wrong. Another namespace may have some, or the namespace picker in the toolbar can widen the search.'
                  : 'Nothing is wrong: this cluster genuinely has none. The watch is live, so any that appear will show up here without a refresh.')
              }
            />
          )
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((row) => {
                const item = visible[row.index];
                if (!item) return null;
                const selected = item.metadata?.name === selectedName;
                const act = (action: string) => onAction?.(action, item);

                const entries = menu ? menu(item) : rowMenuEntries(item, kind, act as (action: RowActionId) => void, flags);
                const key = rowKey(item);
                return (
                  <Menu key={item.metadata?.name ?? row.index} label={item.metadata?.name ?? ''} entries={entries} testId="row-menu">
                    <div
                      data-testid="resource-row"
                      data-selected={selected}
                      role="row"
                      tabIndex={0}
                      onClick={(event) => {
                        if (canBulk && (event.metaKey || event.ctrlKey)) {
                          setPicked((current) => {
                            const out = new Set(current);
                            if (out.has(key)) out.delete(key);
                            else out.add(key);
                            return out;
                          });
                          setAnchor(key);
                          return;
                        }
                        onSelect?.(item);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelect?.(item);
                        }
                      }}
                      data-index={row.index}
                      ref={virtualizer.measureElement}
                      className={`group/row absolute inset-x-0 grid cursor-pointer items-center border-b border-subtle data-[state=open]:bg-hover data-[state=open]:shadow-[inset_0_0_0_1px_var(--border-strong)] ${
                        selected ? 'row-selected' : 'row-hover'
                      }`}
                      style={{
                        // A spacer as wide as the frozen cell, so scrolling
                        // right brings every column out from under it instead
                        // of leaving the last one permanently covered.
                        gridTemplateColumns: `${canBulk ? '38px ' : ''}${template} minmax(176px, max-content)`,
                        minHeight: ROW_HEIGHT,
                        transform: `translateY(${row.start - HEADER_HEIGHT}px)`,
                      }}
                    >
                      {selected ? (
                        <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-accent" />
                      ) : null}
                      {canBulk ? (
                        <div className="flex h-full items-center justify-center" onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={picked.has(key)}
                            label={`Select ${item.metadata?.name ?? ''}`}
                            testId="row-select"
                            onChange={(next, event) => {
                              setPicked((current) => {
                                const out = new Set(current);
                                // Shift extends from the last row you ticked.
                                if (event?.shiftKey && anchor) {
                                  const keys = visible.map(rowKey);
                                  const from = keys.indexOf(anchor);
                                  const to = keys.indexOf(key);
                                  if (from !== -1 && to !== -1) {
                                    for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) {
                                      const k = keys[i];
                                      if (!k) continue;
                                      if (next) out.add(k);
                                      else out.delete(k);
                                    }
                                    return out;
                                  }
                                }
                                if (next) out.add(key);
                                else out.delete(key);
                                return out;
                              });
                              setAnchor(key);
                            }}
                          />
                        </div>
                      ) : null}
                      {columns.map((column) => (
                        <OverflowTip
                          key={column.id}
                          testId={`cell-${column.id}`}
                          align={column.align === 'right' ? 'end' : 'start'}
                          className={`flex min-w-0 items-center gap-2.5 overflow-hidden px-3 py-2 ${
                            column.align === 'right' ? 'justify-end' : 'justify-start'
                          }`}
                        >
                          {column.id === 'name' ? <KindMark kind={(item.spec as { kind?: string } | undefined)?.kind === 'prefix' ? 'StoragePrefix' : kind} /> : null}
                          {column.content(item)}
                        </OverflowTip>
                      ))}
                      <div className={`flex h-full items-center justify-end pl-2 pr-1.5 ${overflowing ? 'cell-pinned' : ''} ${more.right ? 'cell-covering' : ''}`} onClick={(event) => event.stopPropagation()}>
                        <RowActions entries={entries} name={item.metadata?.name ?? ''} />
                      </div>
                    </div>
                  </Menu>
                );
              })}
          </div>
        )}
       </div>
      </div>

      <AnimatePresence>
        {canBulk && bulk && picked.size > 0 ? (
          <motion.div
            key="bulk-bar"
            data-testid="bulk-bar"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="surface-card absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 !rounded-full px-2 py-1.5"
            style={{ boxShadow: 'var(--shadow-lift)' }}
          >
            <span className="whitespace-nowrap px-2 text-[12.5px] text-secondary">
              <span className="font-mono text-primary">{picked.size}</span> selected
            </span>
            <span className="h-4 w-px bg-[var(--border-default)]" />
            {bulk
              .filter((action) => !action.applies || chosen().every(action.applies))
              .map((action) => (
                <button
                  key={action.id}
                  type="button"
                  data-testid={`bulk-${action.id}`}
                  disabled={running !== null}
                  onClick={() => {
                    setRunning(action.id);
                    void Promise.resolve(action.run(chosen()))
                      .then(() => setPicked(new Set()))
                      .catch(() => undefined)
                      .finally(() => setRunning(null));
                  }}
                  className={`flex h-[28px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] transition-colors duration-100 disabled:opacity-50 ${action.danger ? 'text-error hover:bg-error-bg' : 'text-primary hover:bg-hover'}`}
                >
                  {action.icon}
                  {running === action.id ? 'Working…' : action.label}
                </button>
              ))}
            <span className="h-4 w-px bg-[var(--border-default)]" />
            <button type="button" data-testid="bulk-clear" onClick={() => setPicked(new Set())} className="flex h-[28px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] text-tertiary hover:bg-hover hover:text-primary">
              <X size={12} strokeWidth={2} aria-hidden /> Clear
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
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

