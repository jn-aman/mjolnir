import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClusterContext, ResourceDefinition, WatchState } from '@mjolnir/k8s';
import { Boxes, Circle, Lock, Monitor, Moon, Network, Search, Settings2, Sun, Zap } from 'lucide-react';
import { api, type ClustersResponse } from '../lib/api.ts';
import { useTheme } from '../lib/theme.ts';
import { ResourceList } from '../components/ResourceList.tsx';
import type { KubeItem } from '../components/columns.tsx';

const CATEGORY_ICON = {
  workloads: Boxes,
  config: Settings2,
  network: Network,
  storage: Boxes,
  access: Lock,
  cluster: Monitor,
  custom: Boxes,
} as const;

const CATEGORY_ORDER = ['workloads', 'config', 'network', 'storage', 'access', 'cluster'] as const;

const CATEGORY_LABEL: Record<string, string> = {
  workloads: 'Workloads',
  config: 'Configuration',
  network: 'Network',
  storage: 'Storage',
  access: 'Access control',
  cluster: 'Cluster',
};

export function App() {
  const theme = useTheme();
  const [clusters, setClusters] = useState<ClustersResponse | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [kinds, setKinds] = useState<ResourceDefinition[]>([]);
  const [kind, setKind] = useState('Pod');
  const [namespace, setNamespace] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<KubeItem[]>([]);
  const [state, setState] = useState<WatchState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [clusterData, kindData] = await Promise.all([api.clusters(), api.kinds()]);
      setClusters(clusterData);
      setKinds(kindData.resources);
      setContext(clusterData.currentContext ?? clusterData.contexts[0]?.name ?? null);
    })();
  }, []);

  const definition = useMemo(
    () => kinds.find((entry) => entry.kind === kind),
    [kinds, kind],
  );

  const load = useCallback(async () => {
    if (!context) return;
    try {
      const scope = definition?.namespaced ? namespace : undefined;
      const response = await api.list<KubeItem>(context, kind, scope);
      setItems(response.items);
      setState(response.state);
      setError(response.error);
    } catch (cause) {
      setState('error');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [context, kind, namespace, definition?.namespaced]);

  /**
   * The server already holds a watch-backed cache, so this reads a local
   * snapshot rather than hitting the API server. Streaming the diff to the
   * renderer is a later refinement; polling a cache is cheap and never stale by
   * more than a second.
   */
  useEffect(() => {
    setItems([]);
    setState('connecting');
    void load();
    const timer = setInterval(() => void load(), 1_000);
    return () => clearInterval(timer);
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, ResourceDefinition[]>();
    for (const entry of kinds) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return map;
  }, [kinds]);

  const current = clusters?.contexts.find((entry) => entry.name === context);

  return (
    <div className="flex h-full flex-col bg-ground text-primary">
      <TitleBar
        contexts={clusters?.contexts ?? []}
        current={current}
        onSelect={setContext}
        theme={theme.resolved}
        onToggleTheme={() => theme.set(theme.resolved === 'dark' ? 'light' : 'dark')}
      />

      <div className="flex min-h-0 flex-1">
        <nav
          data-testid="sidebar"
          className="w-[208px] shrink-0 overflow-auto border-r border-line bg-raised py-2"
        >
          {CATEGORY_ORDER.map((category) => {
            const entries = grouped.get(category);
            if (!entries?.length) return null;
            const Icon = CATEGORY_ICON[category];
            return (
              <div key={category} className="mb-3">
                <div className="flex items-center gap-2 px-4 pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-tertiary">
                  <Icon size={12} strokeWidth={2} />
                  {CATEGORY_LABEL[category]}
                </div>
                {entries.map((entry) => (
                  <button
                    key={entry.kind}
                    type="button"
                    data-testid={`nav-${entry.plural}`}
                    onClick={() => setKind(entry.kind)}
                    className={`flex w-full items-center px-4 py-[5px] text-left text-[13px] ${
                      entry.kind === kind
                        ? 'bg-pressed font-medium text-primary'
                        : 'text-secondary hover:bg-hover'
                    }`}
                    style={{ transitionProperty: 'background-color', transitionDuration: '90ms' }}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-line bg-raised px-3">
            <div className="flex h-7 w-[300px] items-center gap-2 rounded-md border border-line bg-sunken px-2">
              <Search size={13} strokeWidth={2} className="shrink-0 text-tertiary" />
              <label htmlFor="quick-filter" className="sr-only">
                Filter {kind}
              </label>
              <input
                id="quick-filter"
                data-testid="quick-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={`Filter ${kind.toLowerCase()}s`}
                className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-primary outline-none placeholder:text-tertiary"
              />
            </div>

            {definition?.namespaced ? (
              <>
                <label htmlFor="namespace" className="sr-only">
                  Namespace
                </label>
                <select
                  id="namespace"
                  data-testid="namespace-select"
                  value={namespace ?? ''}
                  onChange={(event) => setNamespace(event.target.value || undefined)}
                  className="h-7 rounded-md border border-line bg-sunken px-2 text-[12.5px] text-primary"
                >
                  <option value="">All namespaces</option>
                  {[...new Set(items.map((item) => item.metadata?.namespace).filter(Boolean))].map(
                    (entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ),
                  )}
                </select>
              </>
            ) : null}

            <div className="flex-1" />
            <span className="font-mono text-[11.5px] text-tertiary">{kind}</span>
          </div>

          <ResourceList
            kind={kind}
            items={items}
            state={state}
            error={error}
            filter={filter}
          />
        </main>
      </div>
    </div>
  );
}

interface TitleBarProps {
  readonly contexts: ClusterContext[];
  readonly current: ClusterContext | undefined;
  readonly onSelect: (name: string) => void;
  readonly theme: 'dark' | 'light';
  readonly onToggleTheme: () => void;
}

function TitleBar({ contexts, current, onSelect, theme, onToggleTheme }: TitleBarProps) {
  return (
    <header
      data-testid="title-bar"
      // The macOS traffic lights sit in this strip, so the left inset is theirs.
      className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line bg-raised pl-[84px] pr-3"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <Zap size={16} strokeWidth={2} className="shrink-0 text-accent" />

      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <label htmlFor="cluster" className="sr-only">
          Cluster
        </label>
        <select
          id="cluster"
          data-testid="cluster-select"
          value={current?.name ?? ''}
          onChange={(event) => onSelect(event.target.value)}
          className="h-7 rounded-md border border-line bg-sunken px-2 font-mono text-[12.5px] text-primary"
        >
          {contexts.map((entry) => (
            <option key={entry.name} value={entry.name}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>

      <span
        data-testid="connection-status"
        data-state={current ? 'connected' : 'disconnected'}
        className="flex items-center gap-1.5 text-[11.5px] text-tertiary"
      >
        <Circle size={7} strokeWidth={0} className="fill-ok text-ok" />
        <span data-testid="cluster-name">{current?.name ?? 'no cluster'}</span>
      </span>

      <div className="flex-1" />

      <button
        type="button"
        data-testid="theme-toggle"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-sunken text-secondary hover:bg-hover"
      >
        {theme === 'dark' ? <Sun size={14} strokeWidth={1.9} /> : <Moon size={14} strokeWidth={1.9} />}
      </button>
    </header>
  );
}
