import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Toaster } from 'sonner';
import type { ClusterContext, ResourceDefinition, WatchState } from '@mjolnir/k8s';
import { AnimatePresence, motion } from 'motion/react';
import { Circle, Moon, Search, Sun, Zap } from 'lucide-react';
import { api, type ClustersResponse } from '../lib/api.ts';
import { useTheme } from '../lib/theme.ts';
import { ResourceList } from '../components/ResourceList.tsx';
import { ResourceDrawer } from '../components/ResourceDrawer.tsx';
import { Sidebar, type NavSelection } from '../components/Sidebar.tsx';
import { ClusterRail } from '../components/ClusterRail.tsx';
import { Overview, type NavigateTarget } from '../components/Overview.tsx';
import { SettingsPanel } from '../components/SettingsPanel.tsx';
import { podStatus, type KubeItem } from '../components/columns.tsx';
import { toneFor } from '../components/StatusChip.tsx';
import { Field } from '../components/ui/Field.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Button } from '../components/ui/Button.tsx';
import type { MetricsResponse } from '../lib/metrics.ts';

export function App() {
  const theme = useTheme();
  const [clusters, setClusters] = useState<ClustersResponse | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [kinds, setKinds] = useState<ResourceDefinition[]>([]);
  const [selection, setSelection] = useState<NavSelection>({ kind: 'page', value: 'overview' });
  const [kind, setKind] = useState('Pod');
  const [namespace, setNamespace] = useState('');
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<KubeItem[]>([]);
  const [state, setState] = useState<WatchState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<KubeItem | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<string | undefined>(undefined);
  const [podMetrics, setPodMetrics] = useState<MetricsResponse | null>(null);

  useEffect(() => {
    void (async () => {
      const [clusterData, kindData] = await Promise.all([api.clusters(), api.kinds()]);
      setClusters(clusterData);
      setKinds(kindData.resources);
      setContext(clusterData.currentContext ?? clusterData.contexts[0]?.name ?? null);
    })();
  }, []);

  useEffect(() => {
    if (!context) return;
    void (async () => {
      const response = await fetch(`/api/metrics/${encodeURIComponent(context)}/pods`);
      setPodMetrics((await response.json()) as MetricsResponse);
    })();
  }, [context]);

  const definition = useMemo(() => kinds.find((entry) => entry.kind === kind), [kinds, kind]);

  const view = selection.kind === 'page' ? selection.value : 'resources';

  const load = useCallback(async () => {
    if (!context || selection.kind !== 'resource') return;
    try {
      const scope = definition?.namespaced && namespace ? namespace : undefined;
      const response = await api.list<KubeItem>(context, kind, scope);
      setItems(response.items);
      setState(response.state);
      setError(response.error);
      setCounts((current) => ({ ...current, [kind]: response.items.length }));
    } catch (cause) {
      setState('error');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [context, kind, namespace, definition?.namespaced, selection.kind]);

  useEffect(() => {
    if (selection.kind !== 'resource') return;
    setItems([]);
    setState('connecting');
    void load();
    const timer = setInterval(() => void load(), 1_000);
    return () => clearInterval(timer);
  }, [load, selection.kind]);

  /**
   * Opens whatever was clicked on the overview.
   *
   * The named object may not be loaded yet — the list for that kind might not
   * have been fetched — so the name is held and matched once it arrives. That
   * keeps the click instant instead of blocking on a round trip.
   */
  const navigate = useCallback((target: NavigateTarget) => {
    setSelection({ kind: 'resource', value: target.kind });
    setKind(target.kind);
    setNamespace(target.namespace ?? '');
    setSelected(null);
    setPendingName(target.name ?? null);
    setDrawerTab(undefined);
  }, []);

  useEffect(() => {
    if (!pendingName) return;
    const match = items.find((item) => item.metadata?.name === pendingName);
    if (match) {
      setSelected(match);
      setPendingName(null);
    }
  }, [items, pendingName]);

  const onRowAction = useCallback((action: string, item: KubeItem) => {
    setSelected(item);
    // Every context-menu action lands in the panel on the tab that performs it.
    if (action === 'logs' || action === 'shell') setDrawerTab('logs');
    else if (action === 'yaml') setDrawerTab('yaml');
    else setDrawerTab('overview');
  }, []);

  const current = clusters?.contexts.find((entry) => entry.name === context);

  const health = useMemo(() => {
    if (kind !== 'Pod') return null;
    const tally = { ok: 0, warn: 0, error: 0 };
    for (const item of items) {
      const tone = toneFor(podStatus(item as never));
      if (tone === 'ok') tally.ok += 1;
      else if (tone === 'error') tally.error += 1;
      else if (tone === 'warn') tally.warn += 1;
    }
    return tally;
  }, [items, kind]);

  const namespaces = useMemo(
    () => [...new Set(items.map((item) => item.metadata?.namespace).filter(Boolean))].sort() as string[],
    [items],
  );

  const selectedMetrics = useMemo(() => {
    const name = selected?.metadata?.name;
    const series = podMetrics?.series.find((entry) => entry.name === name);
    if (!series) return undefined;
    return {
      cpu: series.points.map((point) => ({ t: point.t, v: point.cpu })),
      memory: series.points.map((point) => ({ t: point.t, v: point.memory })),
    };
  }, [selected, podMetrics]);

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="flex h-full flex-col bg-ground text-primary">
        <TitleBar
          current={current}
          theme={theme.resolved}
          onToggleTheme={() => theme.set(theme.resolved === 'dark' ? 'light' : 'dark')}
        />

        <div className="flex min-h-0 flex-1">
          <ClusterRail
            contexts={clusters?.contexts ?? []}
            current={context}
            onSelect={(name) => {
              setContext(name);
              setSelected(null);
            }}
            onAdd={() => setSelection({ kind: 'page', value: 'settings' })}
          />

          <Sidebar
            kinds={kinds}
            selection={selection}
            counts={counts}
            onSelect={(next) => {
              setSelection(next);
              if (next.kind === 'resource') setKind(next.value);
              setSelected(null);
            }}
          />

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view === 'resources' ? `resources:${kind}` : view}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
            {view === 'overview' && context ? (
              <Overview context={context} onNavigate={navigate} />
            ) : null}

            {view === 'settings' ? (
              <SettingsPanel
                clusters={clusters}
                theme={theme.choice}
                onTheme={theme.set}
                onReload={async () => setClusters(await api.reloadClusters())}
              />
            ) : null}

            {view === 'resources' ? (
              <>
                <div className="flex h-[48px] shrink-0 items-center gap-2 border-b border-line bg-raised px-3">
                  <Field
                    id="quick-filter"
                    label={`Filter ${kind}`}
                    hideLabel
                    data-testid="quick-filter"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder={`Filter ${definition?.label.toLowerCase() ?? ''}`}
                    mono
                    className="w-[300px]"
                    leading={<Search size={13} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />}
                  />

                  {definition?.namespaced ? (
                    <Select
                      label="Namespace"
                      value={namespace}
                      onChange={setNamespace}
                      testId="namespace-select"
                      options={[
                        { value: '', label: 'All namespaces' },
                        ...namespaces.map((entry) => ({ value: entry, label: entry })),
                      ]}
                    />
                  ) : null}

                  <div className="flex-1" />

                  {health ? (
                    <div className="flex items-center gap-3 font-mono text-[11.5px]" data-testid="health-strip">
                      {health.error > 0 ? <Dot tone="error">{health.error} failing</Dot> : null}
                      {health.warn > 0 ? <Dot tone="warn">{health.warn} pending</Dot> : null}
                      <Dot tone="ok">{health.ok} running</Dot>
                    </div>
                  ) : null}
                </div>

                <div className="flex min-h-0 flex-1">
                  <ResourceList
                    kind={kind}
                    items={items}
                    state={state}
                    error={error}
                    filter={filter}
                    selectedName={selected?.metadata?.name}
                    onSelect={(item) => {
                      setSelected(item);
                      setDrawerTab(undefined);
                    }}
                    onAction={onRowAction}
                  />
                  {selected ? (
                    <ResourceDrawer
                      context={context ?? ''}
                      kind={kind}
                      item={selected}
                      {...(selectedMetrics ? { metrics: selectedMetrics } : {})}
                      {...(drawerTab ? { initialTab: drawerTab } : {})}
                      onClose={() => setSelected(null)}
                    />
                  ) : null}
                </div>
              </>
            ) : null}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <Toaster theme={theme.resolved} position="bottom-right" />
      </div>
    </Tooltip.Provider>
  );
}

function Dot({ tone, children }: { tone: 'ok' | 'warn' | 'error'; children: React.ReactNode }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-error';
  return (
    <span className={`flex items-center gap-1.5 ${color}`}>
      <Circle size={6} strokeWidth={0} aria-hidden className="fill-current" />
      {children}
    </span>
  );
}

interface TitleBarProps {
  readonly current: ClusterContext | undefined;
  readonly theme: 'dark' | 'light';
  readonly onToggleTheme: () => void;
}

const PROVIDER_LABEL: Record<string, string> = {
  eks: 'EKS',
  aks: 'AKS',
  gke: 'GKE',
  kind: 'kind',
  minikube: 'minikube',
  k3s: 'k3s',
  openshift: 'OpenShift',
  other: '',
};

/**
 * The window strip.
 *
 * Deliberately thin: navigation lives in the sidebar, cluster switching in the
 * rail. What is left is who you are connected to and whether it is answering —
 * the two things worth having on screen permanently.
 */
function TitleBar({ current, theme, onToggleTheme }: TitleBarProps) {
  const provider = current ? PROVIDER_LABEL[current.provider] : '';

  return (
    <header
      data-testid="title-bar"
      // The macOS traffic lights live in this strip; the left inset is theirs.
      className="flex h-[44px] shrink-0 items-center gap-2.5 border-b border-line bg-raised pl-[84px] pr-3"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <Zap size={15} strokeWidth={2.2} aria-hidden className="shrink-0 text-accent" />
      <span className="text-[13px] font-semibold tracking-[-0.01em] text-primary">Mjolnir</span>

      <div className="mx-1 h-4 w-px bg-[var(--border-default)]" />

      <span
        data-testid="connection-status"
        data-state={current ? 'connected' : 'disconnected'}
        className="flex items-center gap-2"
      >
        <motion.span
          aria-hidden
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
          className="flex"
        >
          <Circle size={7} strokeWidth={0} className="fill-ok text-ok" />
        </motion.span>
        <span data-testid="cluster-name" className="font-mono text-[12.5px] text-primary">
          {current?.name ?? 'no cluster'}
        </span>
        {provider ? (
          <span className="rounded-xs bg-accent-subtle px-1.5 py-[1px] text-[10px] font-semibold tracking-wide text-accent">
            {provider}
          </span>
        ) : null}
        {current?.server ? (
          <span className="font-mono text-[11px] text-tertiary">{current.server}</span>
        ) : null}
      </span>

      <div className="flex-1" />

      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Button
          iconOnly
          data-testid="theme-toggle"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onToggleTheme}
          icon={theme === 'dark' ? <Sun size={14} strokeWidth={1.9} /> : <Moon size={14} strokeWidth={1.9} />}
        />
      </div>
    </header>
  );
}
