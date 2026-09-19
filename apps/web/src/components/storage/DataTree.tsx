import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, Copy, Minimize2, Maximize2, Search } from 'lucide-react';
import { copyText } from '../ui/ContextMenu.tsx';
import { Menu, type MenuEntry } from '../ui/ContextMenu.tsx';

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
  walk(value, '$', '$', 0);
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
    const start = new Set<string>(['$']);
    const kind = kindOf(value);
    if (kind !== 'leaf') for (const [key] of entriesOf(value).slice(0, 200)) start.add(childPath('$', key, kind));
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
    estimateSize: () => 22,
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
        <button
          type="button"
          title="Expand everything"
          aria-label="Expand everything"
          data-testid="tree-expand"
          onClick={() => setExpanded(allContainers(value))}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
        >
          <Maximize2 size={12} strokeWidth={2} />
        </button>
        <button
          type="button"
          title="Collapse everything"
          aria-label="Collapse everything"
          data-testid="tree-collapse"
          onClick={() => setExpanded(new Set(['$']))}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
        >
          <Minimize2 size={12} strokeWidth={2} />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[12px]">
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

  return (
    <Menu label={node.path} entries={entries} testId="tree-menu">
      <div
        style={{ ...style, paddingLeft: 8 + node.depth * 14 }}
        data-testid="tree-row"
        className="flex items-center gap-1 pr-3 leading-[22px] hover:bg-hover"
      >
        {node.kind === 'leaf' ? (
          <span className="w-[13px] shrink-0" />
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? `Collapse ${node.label}` : `Expand ${node.label}`}
            className="flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-xs text-tertiary hover:text-primary"
          >
            <ChevronRight size={11} strokeWidth={2.4} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />
          </button>
        )}
        <span className="shrink-0 text-[var(--syntax-key,var(--text-primary))]">
          <Highlight text={node.label} needle={needle} />
        </span>
        <span className="shrink-0 text-tertiary">:</span>
        {node.kind === 'leaf' ? (
          <Leaf value={node.value} needle={needle} />
        ) : (
          <span className="min-w-0 truncate text-tertiary">
            {node.kind === 'array' ? `[ ${node.count} ]` : `{ ${node.count} }`}
            {open ? '' : <span className="ml-2 opacity-70">{preview(node.value)}</span>}
          </span>
        )}
      </div>
    </Menu>
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

function Leaf({ value, needle }: { value: unknown; needle: string }) {
  const tone =
    value === null || value === undefined
      ? 'text-tertiary'
      : typeof value === 'number'
        ? 'text-[var(--series-3)]'
        : typeof value === 'boolean'
          ? 'text-[var(--series-5)]'
          : 'text-[var(--series-1)]';
  const text = value === null ? 'null' : value === undefined ? 'undefined' : typeof value === 'string' ? `"${value}"` : String(value);
  return (
    <span className={`min-w-0 truncate ${tone}`} title={text}>
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
