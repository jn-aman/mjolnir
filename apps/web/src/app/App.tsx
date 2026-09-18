import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Toaster } from 'sonner';
import type { ClusterContext, ResourceDefinition, WatchState } from '@mjolnir/k8s';
import { Circle, LayoutDashboard, Moon, Search, Settings, Sun, Zap } from 'lucide-react';
import { api, type ClustersResponse } from '../lib/api.ts';
import { useTheme } from '../lib/theme.ts';
import { ResourceList } from '../components/ResourceList.tsx';
import { ResourceDrawer } from '../components/ResourceDrawer.tsx';
import { Sidebar } from '../components/Sidebar.tsx';
import { Overview } from '../components/Overview.tsx';
import { SettingsPanel } from '../components/SettingsPanel.tsx';
import { podStatus, type KubeItem } from '../components/columns.tsx';
import { toneFor } from '../components/StatusChip.tsx';
import { Field } from '../components/ui/Field.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Button } from '../components/ui/Button.tsx';
import type { MetricsResponse } from '../lib/metrics.ts';

type View = 'overview' | 'resources' | 'settings';

export function App() {
  const theme = useTheme();
  const [clusters, setClusters] = useState<ClustersResponse | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [kinds, setKinds] = useState<ResourceDefinition[]>([]);
  const [view, setView] = useState<View>('overview');
  const [kind, setKind] = useState('Pod');
  const [namespace, setNamespace] = useState('');
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<KubeItem[]>([]);
  const [state, setState] = useState<WatchState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<KubeItem | null>(null);
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

  const load = useCallback(async () => {
    if (!context || view !== 'resources') return;
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
  }, [context, kind, namespace, definition?.namespaced, view]);

  useEffect(() => {
    if (view !== 'resources') return;
    setItems([]);
    setState('connecting');
    void load();
    const timer = setInterval(() => void load(), 1_000);
    return () => clearInterval(timer);
  }, [load, view]);

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
          contexts={clusters?.contexts ?? []}
          current={current}
          onSelect={setContext}
          theme={theme.resolved}
          onToggleTheme={() => theme.set(theme.resolved === 'dark' ? 'light' : 'dark')}
          view={view}
          onView={setView}
        />

        <div className="flex min-h-0 flex-1">
          {view === 'resources' ? (
            <Sidebar
              kinds={kinds}
              selected={kind}
              counts={counts}
              onSelect={(next) => {
                setKind(next);
                setSelected(null);
              }}
            />
          ) : null}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {view === 'overview' && context ? (
              <Overview context={context} onOpenResources={() => setView('resources')} />
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
                    onSelect={setSelected}
                  />
                  {selected ? (
                    <ResourceDrawer
                      context={context ?? ''}
                      kind={kind}
                      item={selected}
                      {...(selectedMetrics ? { metrics: selectedMetrics } : {})}
                      onClose={() => setSelected(null)}
                    />
                  ) : null}
                </div>
              </>
            ) : null}
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

interface TitleBarProps {
  readonly contexts: ClusterContext[];
  readonly current: ClusterContext | undefined;
  readonly onSelect: (name: string) => void;
  readonly theme: 'dark' | 'light';
  readonly onToggleTheme: () => void;
  readonly view: View;
  readonly onView: (view: View) => void;
}

function TitleBar({ contexts, current, onSelect, theme, onToggleTheme, view, onView }: TitleBarProps) {
  const provider = current ? PROVIDER_LABEL[current.provider] : '';

  return (
    <header
      data-testid="title-bar"
      // The macOS traffic lights live in this strip; the left inset is theirs.
      className="flex h-[48px] shrink-0 items-center gap-2 border-b border-line bg-raised pl-[84px] pr-3"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <Zap size={16} strokeWidth={2.2} aria-hidden className="mr-1 shrink-0 text-accent" />

      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Select
          label="Cluster"
          value={current?.name ?? ''}
          onChange={onSelect}
          testId="cluster-select"
          mono
          options={contexts.map((entry) => ({
            value: entry.name,
            label: entry.name,
            hint: PROVIDER_LABEL[entry.provider] || undefined,
          }))}
        />
      </div>

      <span
        data-testid="connection-status"
        data-state={current ? 'connected' : 'disconnected'}
        className="flex items-center gap-1.5 pl-1 text-[11.5px] text-tertiary"
      >
        <Circle size={7} strokeWidth={0} aria-hidden className="fill-ok text-ok" />
        <span data-testid="cluster-name" className="sr-only">
          {current?.name ?? 'no cluster'}
        </span>
        {provider ? (
          <span className="rounded-xs bg-accent-subtle px-1.5 py-[1px] text-[10px] font-semibold tracking-wide text-accent">
            {provider}
          </span>
        ) : null}
      </span>

      <div className="flex-1" />

      <nav
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <NavButton
          active={view === 'overview'}
          onClick={() => onView('overview')}
          icon={<LayoutDashboard size={14} strokeWidth={1.9} />}
          label="Overview"
          testId="nav-overview"
        />
        <NavButton
          active={view === 'resources'}
          onClick={() => onView('resources')}
          icon={<Search size={14} strokeWidth={1.9} />}
          label="Resources"
          testId="nav-resources"
        />
        <NavButton
          active={view === 'settings'}
          onClick={() => onView('settings')}
          icon={<Settings size={14} strokeWidth={1.9} />}
          label="Settings"
          testId="nav-settings"
        />
        <div className="mx-1 h-5 w-px bg-[var(--border-default)]" />
        <Button
          iconOnly
          data-testid="theme-toggle"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onToggleTheme}
          icon={theme === 'dark' ? <Sun size={14} strokeWidth={1.9} /> : <Moon size={14} strokeWidth={1.9} />}
        />
      </nav>
    </header>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          data-testid={testId}
          data-active={active}
          onClick={onClick}
          aria-label={label}
          className={`flex h-[30px] items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium ${
            active ? 'bg-pressed text-primary' : 'text-secondary hover:bg-hover hover:text-primary'
          }`}
          style={{ transitionProperty: 'background-color, color', transitionDuration: '90ms' }}
        >
          {icon}
          {label}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="rounded-md border border-line bg-overlay px-2 py-1 text-[11.5px] text-primary shadow-[var(--shadow-md)]"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
