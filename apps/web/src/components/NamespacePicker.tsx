import { useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { tintFor } from '../lib/tint.ts';

/**
 * Which namespaces you are looking at.
 *
 * One, several, or all: tick them from the cluster's list, or type one that
 * is not listed yet (RBAC often hides the list but not the namespace). The
 * choice is remembered per cluster.
 */
interface NamespacePickerProps {
  readonly all: readonly string[];
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
}

export function NamespacePicker({ all, selected, onChange }: NamespacePickerProps) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();
  const options = [...new Set([...all, ...selected])].sort();
  const shown = needle ? options.filter((ns) => ns.toLowerCase().includes(needle)) : options;
  const canAdd = needle !== '' && !options.some((ns) => ns.toLowerCase() === needle) && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(query.trim());
  const toggle = (ns: string) => onChange(selected.includes(ns) ? selected.filter((entry) => entry !== ns) : [...selected, ns]);
  const label = selected.length === 0 ? 'All namespaces' : selected.length === 1 ? selected[0] : `${selected.length} namespaces`;

  return (
    <DropdownMenu.Root onOpenChange={(open) => { if (!open) setQuery(''); else setTimeout(() => input.current?.focus(), 0); }}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="namespace-select"
          aria-label="Namespaces"
          className="group flex h-[30px] max-w-[300px] items-center gap-1.5 rounded-md border border-line bg-sunken pl-2.5 pr-2 text-[12.5px] text-primary outline-none hover:border-strong data-[state=open]:border-focus"
        >
          {selected.length === 1 ? <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: tintFor(selected[0]) }} /> : null}
          <span className="min-w-0 flex-1 truncate text-left font-mono">{label}</span>
          {selected.length > 1 ? (
            <span className="flex max-w-[150px] gap-0.5 overflow-hidden">
              {selected.slice(0, 3).map((ns) => <span key={ns} aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: tintFor(ns) }} />)}
            </span>
          ) : null}
          <ChevronDown size={13} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={5}
          collisionPadding={8}
          data-testid="namespace-select-menu"
          className="z-50 max-h-[min(460px,var(--radix-dropdown-menu-content-available-height))] w-[300px] overflow-y-auto rounded-lg border border-line bg-overlay p-1 shadow-[var(--shadow-lg)]"
          style={{ transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)' }}
        >
          <div className="sticky -top-1 z-10 -mx-1 -mt-1 mb-1 border-b border-line bg-overlay p-1.5">
            <div className="flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2">
              <Search size={12} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />
              <input
                ref={input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canAdd) {
                    event.preventDefault();
                    onChange([...selected, query.trim()]);
                    setQuery('');
                    return;
                  }
                  if (event.key !== 'Escape' && event.key !== 'Tab' && event.key !== 'ArrowDown') event.stopPropagation();
                }}
                placeholder="Search or type a namespace"
                aria-label="Search namespaces"
                data-testid="namespace-search"
                className="h-[28px] w-full bg-transparent font-mono text-[12px] text-primary outline-none placeholder:text-tertiary"
              />
              {query ? <button type="button" aria-label="Clear" onClick={() => setQuery('')} className="text-tertiary hover:text-primary"><X size={12} /></button> : null}
            </div>
          </div>
          <DropdownMenu.Item onSelect={(event) => { event.preventDefault(); onChange([]); }} data-testid="namespace-all" className={`flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-[6px] text-[12.5px] outline-none data-[highlighted]:bg-hover ${selected.length === 0 ? 'text-primary' : 'text-secondary'}`}>
            <Check size={13} strokeWidth={2.4} aria-hidden className="shrink-0 text-accent" style={{ opacity: selected.length === 0 ? 1 : 0 }} />
            All namespaces
          </DropdownMenu.Item>
          {canAdd ? (
            <DropdownMenu.Item onSelect={(event) => { event.preventDefault(); onChange([...selected, query.trim()]); setQuery(''); }} data-testid="namespace-add" className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-[6px] text-[12.5px] text-accent outline-none data-[highlighted]:bg-hover">
              <Plus size={13} strokeWidth={2.4} aria-hidden className="shrink-0" />
              Add <span className="font-mono">{query.trim()}</span>
            </DropdownMenu.Item>
          ) : null}
          {shown.map((ns) => {
            const active = selected.includes(ns);
            const known = all.includes(ns);
            return (
              <DropdownMenu.CheckboxItem
                key={ns}
                checked={active}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => toggle(ns)}
                data-testid={`namespace-option-${ns}`}
                className={`flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-[6px] text-[12.5px] outline-none data-[highlighted]:bg-hover ${active ? 'text-primary' : 'text-secondary'}`}
              >
                <span className={`flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border ${active ? 'border-accent bg-accent text-white' : 'border-[var(--border-strong)]'}`}>
                  {active ? <Check size={10} strokeWidth={3} /> : null}
                </span>
                <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: tintFor(ns) }} />
                <span className="min-w-0 flex-1 truncate font-mono">{ns}</span>
                {!known ? <span className="text-[10px] uppercase tracking-wide text-tertiary">typed</span> : null}
              </DropdownMenu.CheckboxItem>
            );
          })}
          {shown.length === 0 && !canAdd ? <div className="px-2 py-2 text-[12px] text-tertiary">Nothing matches.</div> : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
