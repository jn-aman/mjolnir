import { Command } from 'cmdk';
import { Boxes, LayoutDashboard, Moon, Search, Server, Settings, Sun } from 'lucide-react';
import type { ClusterContext, ResourceDefinition } from '@mjolnir/k8s';
import type { NavSelection } from './Sidebar.tsx';
import type { KubeItem } from './columns.tsx';
import { TOOLS } from '../lib/tools.ts';

/**
 * ⌘K.
 *
 * One box that reaches everything: a page, a kind, a tool, a cluster, a
 * namespace, or a specific object in the list you are looking at. It is the
 * fastest route to anything for people who know what they want, and the map
 * for people who do not. Every entry it offers exists elsewhere as a click.
 */

interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly kinds: readonly ResourceDefinition[];
  readonly clusters: readonly ClusterContext[];
  readonly namespaces: readonly string[];
  readonly kind: string;
  readonly items: readonly KubeItem[];
  readonly theme: 'dark' | 'light';
  readonly onNavigate: (selection: NavSelection) => void;
  readonly onCluster: (name: string) => void;
  readonly onNamespace: (namespace: string) => void;
  readonly onOpenItem: (item: KubeItem) => void;
  readonly onToggleTheme: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  kinds,
  clusters,
  namespaces,
  kind,
  items,
  theme,
  onNavigate,
  onCluster,
  onNamespace,
  onOpenItem,
  onToggleTheme,
}: CommandPaletteProps) {
  const run = (action: () => void) => {
    action();
    onOpenChange(false);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="fixed inset-0 z-40 bg-[rgba(4,6,12,0.5)]"
      contentClassName="fixed left-1/2 top-[16%] z-50 w-[640px] max-w-[calc(100%-32px)] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-overlay shadow-[var(--shadow-lg)]"
      loop
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search size={14} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />
        <Command.Input data-testid="palette-input" placeholder="Go to a kind, a tool, a cluster, a namespace, or an object…" autoFocus />
        <kbd className="shrink-0 rounded-xs border border-line px-1.5 py-[1px] font-sans text-[10.5px] text-tertiary">esc</kbd>
      </div>
      <Command.List data-testid="palette-list">
        <Command.Empty>Nothing matches.</Command.Empty>

        <Command.Group heading="Go to">
          <Command.Item value="overview" onSelect={() => run(() => onNavigate({ kind: 'page', value: 'overview' }))}>
            <LayoutDashboard size={13} strokeWidth={1.9} aria-hidden className="text-tertiary" />
            Overview
          </Command.Item>
          {kinds.map((entry) => (
            <Command.Item
              key={entry.kind}
              value={`${entry.label} ${entry.kind} ${entry.plural}`}
              onSelect={() => run(() => onNavigate({ kind: 'resource', value: entry.kind }))}
            >
              <Boxes size={13} strokeWidth={1.9} aria-hidden className="text-tertiary" />
              {entry.label}
              <span className="ml-auto text-[10.5px] uppercase tracking-wide text-tertiary">{entry.category}</span>
            </Command.Item>
          ))}
          <Command.Item value="kubernetes settings" onSelect={() => run(() => onNavigate({ kind: 'page', value: 'settings' }))}>
            <Settings size={13} strokeWidth={1.9} aria-hidden className="text-tertiary" />
            Kubernetes settings
          </Command.Item>
          <Command.Item value="mjolnir settings app assistant mcp licence" onSelect={() => run(() => onNavigate({ kind: 'page', value: 'app-settings' }))}>
            <Settings size={13} strokeWidth={1.9} aria-hidden className="text-tertiary" />
            Mjolnir settings
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Modules and tools">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <Command.Item
                key={tool.id}
                value={`${tool.label} ${tool.id}`}
                onSelect={() => run(() => onNavigate({ kind: tool.area === 'tools' ? 'tool' : 'workspace', value: tool.id }))}
              >
                <Icon size={13} strokeWidth={1.9} aria-hidden style={{ color: tool.tint }} />
                {tool.label}
                <span className="ml-auto text-[10.5px] uppercase tracking-wide text-tertiary">planned</span>
              </Command.Item>
            );
          })}
        </Command.Group>

        {clusters.length ? (
          <Command.Group heading="Clusters">
            {clusters.map((cluster) => (
              <Command.Item key={cluster.name} value={`cluster ${cluster.name}`} onSelect={() => run(() => onCluster(cluster.name))}>
                <Server size={13} strokeWidth={1.9} aria-hidden className="text-tertiary" />
                <span className="font-mono">{cluster.name}</span>
                {cluster.server ? <span className="ml-auto truncate font-mono text-[10.5px] text-tertiary">{cluster.server}</span> : null}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        {namespaces.length ? (
          <Command.Group heading="Namespaces">
            {namespaces.map((namespace) => (
              <Command.Item key={namespace} value={`namespace ${namespace}`} onSelect={() => run(() => onNamespace(namespace))}>
                <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-[var(--series-1)]" />
                <span className="font-mono">{namespace}</span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        {items.length ? (
          <Command.Group heading={kind}>
            {items.slice(0, 400).map((item) => {
              const name = item.metadata?.name ?? '';
              const namespace = item.metadata?.namespace ?? '';
              return (
                <Command.Item key={`${namespace}/${name}`} value={`${kind} ${namespace} ${name}`} onSelect={() => run(() => onOpenItem(item))}>
                  <Boxes size={13} strokeWidth={1.9} aria-hidden className="text-tertiary" />
                  <span className="font-mono">{name}</span>
                  {namespace ? <span className="ml-auto font-mono text-[10.5px] text-tertiary">{namespace}</span> : null}
                </Command.Item>
              );
            })}
          </Command.Group>
        ) : null}

        <Command.Group heading="Actions">
          <Command.Item value="toggle theme dark light" onSelect={() => run(onToggleTheme)}>
            {theme === 'dark' ? <Sun size={13} strokeWidth={1.9} aria-hidden className="text-tertiary" /> : <Moon size={13} strokeWidth={1.9} aria-hidden className="text-tertiary" />}
            Switch to {theme === 'dark' ? 'light' : 'dark'} theme
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
