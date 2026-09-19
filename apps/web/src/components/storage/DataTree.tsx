import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, Copy, Minimize2, Maximize2, Search } from 'lucide-react';
import { copyText } from '../ui/ContextMenu.tsx';
import { Menu, type MenuEntry } from '../ui/ContextMenu.tsx';
import { Tip } from '../ui/Tooltip.tsx';

/**
 * Structured data as structure.
 *
 * Syntax highlighting tells you where the braces are. It does not tell you
 * that this object has 4,000 keys, that the thing you want is nine levels
 * down, or what the path to it is, and those are the three questions anyone
 * opening a JSON blob in a bucket actually has. So: collapsible nodes, counts
 * on the closed ones, a search that reaches into values and opens the path to
 * every hit, and a right-click that hands you the JSONPath.
 *
 * Rows are virtualized, because a Kubernetes audit log or a Terraform state
 * file is a hundred thousand nodes and the tree has to open instantly or
 * people go back to `jq`.
 */

type NodeKind = 'object' | 'array' | 'leaf';

interface Flat {
  readonly path: string;
  readonly label: string;
  readonly value: unknown;
  readonly depth: number;
  readonly kind: NodeKind;
  readonly count: number;
}

const kindOf = (value: unknown): NodeKind =>
  Array.isArray(value) ? 'array' : value !== null && typeof value === 'object' ? 'object' : 'leaf';

const entriesOf = (value: unknown): Array<[string, unknown]> =>
  Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value as Record<string, unknown>);

/** `a.b[2].c`, the path you would paste into jq or a JSONPath box. */
const childPath = (parent: string, key: string, parentKind: NodeKind) =>
  parentKind === 'array' ? `${parent}[${key}]` : parent ? `${parent}.${key}` : key;

function flatten(value: unknown, expanded: Set<string>, matches: Set<string> | null): Flat[] {
  const out: Flat[] = [];
  const walk = (node: unknown, path: string, label: string, depth: number) => {
    const kind = kindOf(node);
    const children = kind === 'leaf' ? [] : entriesOf(node);
    if (matches && !matches.has(path)) return;
    out.push({ path, label, value: node, depth, kind, count: children.length });
    if (kind === 'leaf') return;
    if (!expanded.has(path)) return;
    for (const [key, child] of children) walk(child, childPath(path, key, kind), key, depth + 1);
  };
  // No root row. `$` is jargon from a query language nobody asked to see, and
  // the thing it names is already the title of the window. The top level of
  // the document is the top level of the list.
  const kind = kindOf(value);
  if (kind === 'leaf') {
    walk(value, '$', '$', 0);
  } else {
    for (const [key, child] of entriesOf(value)) walk(child, childPath('', key, kind), key, 0);
  }
  return out;
}

/** Every path whose key or value contains the needle, plus its ancestors. */
function search(value: unknown, needle: string): { keep: Set<string>; open: Set<string>; hits: number } {
  const keep = new Set<string>(['$']);
  const open = new Set<string>(['$']);
  let hits = 0;
  const lower = needle.toLowerCase();

  const walk = (node: unknown, path: string, label: string, ancestors: string[]): boolean => {
    const kind = kindOf(node);
    const selfHit = label.toLowerCase().includes(lower) || (kind === 'leaf' && String(node).toLowerCase().includes(lower));
    let childHit = false;
    if (kind !== 'leaf') {
      for (const [key, child] of entriesOf(node)) {
        if (walk(child, childPath(path, key, kind), key, [...ancestors, path])) childHit = true;
      }
    }
    if (selfHit || childHit) {
      if (selfHit) hits += 1;
      keep.add(path);
      for (const ancestor of ancestors) {
        keep.add(ancestor);
        open.add(ancestor);
      }
      if (childHit) open.add(path);
      return true;
    }
    return false;
  };

  walk(value, '$', '$', []);
  return { keep, open, hits };
}

/** Everything that can be opened, for "expand all". Capped so a huge file cannot hang. */
function allContainers(value: unknown, limit = 20_000): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown, path: string) => {
    if (out.size > limit) return;
    const kind = kindOf(node);
    if (kind === 'leaf') return;
    out.add(path);
    for (const [key, child] of entriesOf(node)) walk(child, childPath(path, key, kind));
  };
  walk(value, '$');
  return out;
}

export function DataTree({ value, testId = 'data-tree' }: { value: unknown; testId?: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Open the root and its immediate children: enough to see the shape
    // without paying for the whole document.
    const start = new Set<string>(['']);
    const kind = kindOf(value);
    if (kind !== 'leaf') for (const [key] of entriesOf(value).slice(0, 200)) start.add(childPath('', key, kind));
    return start;
  });
  const [needle, setNeedle] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const found = useMemo(() => (needle.trim() ? search(value, needle.trim()) : null), [value, needle]);
  const rows = useMemo(
    () => flatten(value, found ? new Set([...expanded, ...found.open]) : expanded, found?.keep ?? null),
    [value, expanded, found],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 24,
    overscan: 20,
  });

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={testId}>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-1.5">
        <span className="relative flex min-w-0 flex-1 items-center">
          <Search size={12} strokeWidth={2} aria-hidden className="pointer-events-none absolute left-2 text-tertiary" />
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Search keys and values"
            data-testid="tree-search"
            className="h-[26px] w-full rounded-md border border-line bg-sunken pl-[26px] pr-2 font-mono text-[12px] text-primary outline-none placeholder:text-tertiary focus:border-strong"
          />
        </span>
        {found ? (
          <span className="shrink-0 font-mono text-[11px] text-tertiary" data-testid="tree-hits">
            {found.hits} {found.hits === 1 ? 'match' : 'matches'}
          </span>
        ) : null}
        <Tip label="Expand everything" hint="Every node, however deep">
          <button
            type="button"
            aria-label="Expand everything"
            data-testid="tree-expand"
            onClick={() => setExpanded(allContainers(value))}
            className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
          >
            <Maximize2 size={12} strokeWidth={2} />
          </button>
        </Tip>
        <Tip label="Collapse everything" hint="Back to the root">
          <button
            type="button"
            aria-label="Collapse everything"
            data-testid="tree-collapse"
            onClick={() => setExpanded(new Set([''])) }
            className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
          >
            <Minimize2 size={12} strokeWidth={2} />
          </button>
        </Tip>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[12.5px]">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const node = rows[row.index];
            if (!node) return null;
            return (
              <Row
                key={node.path}
                node={node}
                needle={needle.trim()}
                open={expanded.has(node.path) || Boolean(found?.open.has(node.path))}
                onToggle={() => toggle(node.path)}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: row.size, transform: `translateY(${row.start}px)` }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({
  node,
  open,
  needle,
  onToggle,
  style,
}: {
  node: Flat;
  open: boolean;
  needle: string;
  onToggle: () => void;
  style: React.CSSProperties;
}) {
  const entries: MenuEntry[] = [
    { id: 'copy-path', label: 'Copy path', icon: <Copy size={13} strokeWidth={1.9} />, onSelect: () => copyText(node.path, 'Path copied') },
    { id: 'copy-value', label: 'Copy value', icon: <Copy size={13} strokeWidth={1.9} />, onSelect: () => copyText(node.kind === 'leaf' ? String(node.value) : JSON.stringify(node.value, null, 2), 'Value copied') },
    ...(node.kind === 'leaf' ? [] : [{ id: 'copy-json', label: 'Copy as JSON', icon: <Copy size={13} strokeWidth={1.9} />, onSelect: () => copyText(JSON.stringify(node.value), 'JSON copied') }]),
  ];

  // An array index is not a name. Showing `0 :` beside `sku :` invites the eye
  // to read them as the same kind of thing when one is a label and the other
  // is a position, so indices are bracketed and dimmed.
  const isIndex = /^\d+$/.test(node.label) && node.path.endsWith(`[${node.label}]`);

  return (
    <Menu label={node.path} entries={entries} testId="tree-menu">
      <div
        style={{ ...style, paddingLeft: 10 + node.depth * 16 }}
        data-testid="tree-row"
        className="group/row relative flex items-center gap-1.5 pr-8 leading-[24px] hover:bg-hover"
      >
        {/*
          One guide per level of depth. Without them, a value nine levels down
          is a string floating in whitespace and there is no way to see what it
          belongs to; with them the eye follows a line back to the parent.
        */}
        {Array.from({ length: node.depth }, (_, level) => (
          <span
            key={level}
            aria-hidden
            className="pointer-events-none absolute top-0 h-full border-l border-[var(--border-subtle)]"
            style={{ left: 14 + level * 16 }}
          />
        ))}

        {node.kind === 'leaf' ? (
          <span className="w-[14px] shrink-0" />
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? `Collapse ${node.label}` : `Expand ${node.label}`}
            className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-xs text-tertiary hover:bg-hover hover:text-primary"
          >
            <ChevronRight size={11} strokeWidth={2.4} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />
          </button>
        )}

        <span className={`shrink-0 ${isIndex ? 'text-tertiary' : 'font-medium text-primary'}`}>
          {isIndex ? `[${node.label}]` : <Highlight text={node.label} needle={needle} />}
        </span>

        {node.kind === 'leaf' ? (
          <>
            <span className="shrink-0 text-tertiary">:</span>
            <Leaf value={node.value} needle={needle} />
          </>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <Count kind={node.kind} count={node.count} />
            {open ? null : <span className="min-w-0 truncate text-tertiary opacity-80">{preview(node.value)}</span>}
          </span>
        )}

        {/* Copy appears under the pointer, not in a column of its own. */}
        <button
          type="button"
          aria-label={`Copy ${node.path}`}
          title="Copy this value"
          onClick={(event) => {
            event.stopPropagation();
            copyText(node.kind === 'leaf' ? String(node.value) : JSON.stringify(node.value, null, 2), 'Copied');
          }}
          className="absolute right-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-xs text-transparent hover:bg-hover hover:text-primary group-hover/row:text-tertiary"
        >
          <Copy size={11} strokeWidth={1.9} />
        </button>
      </div>
    </Menu>
  );
}

/**
 * How many are inside, said quietly.
 *
 * It was a coloured pill and that was too loud: a document with thirty
 * containers in it became thirty orange badges, and the thing you were
 * reading was the values. Dim text carries the same fact and stays out of the
 * way, which is what a count is for.
 */
function Count({ kind, count }: { kind: NodeKind; count: number }) {
  return (
    <span className="shrink-0 text-tertiary">
      {count} {kind === 'array' ? (count === 1 ? 'item' : 'items') : count === 1 ? 'key' : 'keys'}
    </span>
  );
}

/** A one-line taste of a collapsed container, so you can skip it without opening it. */
function preview(value: unknown): string {
  const text = Array.isArray(value)
    ? value.slice(0, 4).map(short).join(', ')
    : entriesOf(value)
        .slice(0, 4)
        .map(([key, inner]) => `${key}: ${short(inner)}`)
        .join(', ');
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

function short(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') return '{…}';
  if (typeof value === 'string') return value.length > 22 ? `"${value.slice(0, 22)}…"` : `"${value}"`;
  return String(value);
}

/**
 * A value, typed by colour and shape rather than by punctuation.
 *
 * The quotes around a string go: in a tree the column already tells you it is
 * a value, and `"Sunglasses"` is harder to read than `Sunglasses` for no
 * information gained. `null` and booleans keep a shape of their own because
 * the difference between the string "false" and the boolean false is the sort
 * of thing people are actually looking for in here.
 */
function Leaf({ value, needle }: { value: unknown; needle: string }) {
  if (value === null || value === undefined) {
    return <span className="shrink-0 italic text-tertiary">null</span>;
  }
  if (typeof value === 'boolean') {
    // A word, coloured. The badge version shouted, and true is not an alert.
    return <span className={`shrink-0 ${value ? 'text-ok' : 'text-tertiary'}`}>{String(value)}</span>;
  }
  if (typeof value === 'number') {
    return (
      <span className="min-w-0 truncate tabular-nums text-[var(--series-3)]" title={String(value)}>
        <Highlight text={String(value)} needle={needle} />
      </span>
    );
  }
  const text = String(value);
  return (
    <span className="min-w-0 truncate text-[var(--series-1)]" title={text}>
      <Highlight text={text} needle={needle} />
    </span>
  );
}

function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-xs bg-accent-subtle px-px text-accent">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}
