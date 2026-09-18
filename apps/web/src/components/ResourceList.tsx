import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import type { WatchState } from '@mjolnir/k8s';
import { type Column, type KubeItem, columnsFor } from './columns.tsx';

/**
 * One virtualized list for every resource kind.
 *
 * Rows are **not** animated. Easing a row into view misstates when it arrived,
 * and this is a tool people use to establish what happened when. The container
 * animates; the data does not.
 */

interface ResourceListProps {
  readonly kind: string;
  readonly items: KubeItem[];
  readonly state: WatchState;
  readonly error: string | null;
  readonly filter: string;
  readonly selectedName?: string | undefined;
  readonly onSelect?: (item: KubeItem) => void;
}

const ROW_HEIGHT = 32;

type SortState = { readonly columnId: string; readonly direction: 'asc' | 'desc' } | null;

export function ResourceList({ kind, items, state, error, filter, selectedName, onSelect }: ResourceListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<SortState>(null);

  const columns = useMemo(() => columnsFor(kind), [kind]);

  const template = useMemo(
    () => columns.map((column) => column.width).join(' '),
    [columns],
  );

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? items.filter((item) => {
          const haystack = [
            item.metadata?.name,
            item.metadata?.namespace,
            ...columns.map((column) => column.searchText?.(item)),
          ];
          return haystack.some((value) => value?.toLowerCase().includes(needle));
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
      <div
        role="row"
        className="grid shrink-0 items-center gap-4 border-b border-line bg-raised px-4 text-[11px] font-semibold uppercase tracking-[0.05em] text-tertiary"
        style={{ gridTemplateColumns: template, height: 30 }}
      >
        {columns.map((column) => (
          <button
            key={column.id}
            type="button"
            onClick={() => toggleSort(column)}
            disabled={!column.sortBy}
            className={`flex items-center gap-1 truncate text-inherit ${
              column.align === 'right' ? 'justify-end' : 'justify-start'
            } ${column.sortBy ? 'cursor-pointer hover:text-secondary' : 'cursor-default'}`}
            style={{ transitionDuration: '90ms' }}
          >
            {column.header}
            {sort?.columnId === column.id ? (
              <span aria-hidden className="text-accent">
                {sort.direction === 'asc' ? '↑' : '↓'}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <ListMessage testId="resource-empty">
          {filter ? `Nothing matches “${filter}”.` : `No ${kind.toLowerCase()}s here.`}
        </ListMessage>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const item = visible[row.index];
              if (!item) return null;
              return (
                <div
                  key={item.metadata?.name ?? row.index}
                  data-testid="resource-row"
                  role="row"
                  tabIndex={0}
                  onClick={() => onSelect?.(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect?.(item);
                    }
                  }}
                  data-selected={item.metadata?.name === selectedName}
                  className={`absolute inset-x-0 grid cursor-pointer items-center gap-4 border-b border-subtle px-4 ${
                    item.metadata?.name === selectedName ? 'bg-pressed' : 'hover:bg-hover'
                  }`}
                  style={{
                    gridTemplateColumns: template,
                    height: row.size,
                    transform: `translateY(${row.start}px)`,
                    transitionProperty: 'background-color',
                    transitionDuration: '90ms',
                  }}
                >
                  {columns.map((column) => (
                    <div
                      key={column.id}
                      data-testid={`cell-${column.id}`}
                      className={`flex min-w-0 items-center ${
                        column.align === 'right' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {column.content(item)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
