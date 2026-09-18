import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { toast, Toaster } from 'sonner';
import type { ClusterContext, ResourceDefinition, WatchState } from '@mjolnir/k8s';
import { AnimatePresence, motion } from 'motion/react';
import { Circle, Command as CommandIcon, Moon, Plus, Search, Sparkles, Sun, Zap } from 'lucide-react';
import { api, type ClustersResponse } from '../lib/api.ts';
import { useTheme } from '../lib/theme.ts';
import { ResizeHandle, useResizable } from '../lib/useResizable.tsx';
import { ResourceList } from '../components/ResourceList.tsx';
import { ResourceDrawer } from '../components/ResourceDrawer.tsx';
import { Sidebar, type NavSelection } from '../components/Sidebar.tsx';
import { ClusterStrip } from '../components/ClusterStrip.tsx';
import { ModuleRail } from '../components/ModuleRail.tsx';
import { Overview, type NavigateTarget } from '../components/Overview.tsx';
import { SettingsPanel } from '../components/SettingsPanel.tsx';
import { podStatus, type KubeItem } from '../components/columns.tsx';
import { toneFor } from '../components/StatusChip.tsx';
import { Field } from '../components/ui/Field.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Button } from '../components/ui/Button.tsx';
import type { MetricsResponse } from '../lib/metrics.ts';
import { Dock, type DockTab } from '../components/Dock.tsx';
import { CommandPalette } from '../components/CommandPalette.tsx';
import { ToolPanel } from '../components/ToolPanel.tsx';
import { ScaleDialog } from '../components/ScaleDialog.tsx';
import { KUBERNETES_MODULE, toolById } from '../lib/tools.ts';
import { readRoute, writeRoute } from '../lib/route.ts';
import { offsetMinutes, timezoneOptions, useTimezone, utcLabel } from '../lib/time.ts';
import { Globe } from 'lucide-react';
import { drainNode, rolloutUndo, setPaused, setSchedulable, setTaints } from '../lib/edits.ts';
import { ConfirmDialog } from '../components/ui/Modal.tsx';
import { TaintDialog } from '../components/TaintDialog.tsx';
import { CreateDialog } from '../components/CreateDialog.tsx';
import { PortForwardDialog } from '../components/PortForwardDialog.tsx';
import { ForwardsPanel } from '../components/ForwardsPanel.tsx';

export function App() {
  const theme = useTheme();
  const [clusters, setClusters] = useState<ClustersResponse | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [kinds, setKinds] = useState<ResourceDefinition[]>([]);
  // Where the URL says we were, so a reload does not start over.
  const [route] = useState(readRoute);
  const [selection, setSelection] = useState<NavSelection>(route.selection ?? { kind: 'page', value: 'overview' });
  const [kind, setKind] = useState(route.selection?.kind === 'resource' ? route.selection.value : 'Pod');
  const [namespace, setNamespace] = useState(route.namespace ?? '');
  const [statusFilter, setStatusFilter] = useState(route.status ?? '');
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<KubeItem[]>([]);
  const [state, setState] = useState<WatchState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<KubeItem | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(route.selected ?? null);
  const [drawerTab, setDrawerTab] = useState<string | undefined>(route.tab);
  const [podMetrics, setPodMetrics] = useState<MetricsResponse | null>(null);
  const sidebar = useResizable({ key: 'sidebar', initial: 212, min: 160, max: 420, direction: 'right' });
  const dock = useResizable({ key: 'dock', initial: 280, min: 120, max: 720, direction: 'up' });
  const [dockTabs, setDockTabs] = useState<DockTab[]>([]);
  const [dockActive, setDockActive] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scaling, setScaling] = useState<KubeItem | null>(null);
  const [draining, setDraining] = useState<KubeItem | null>(null);
  const [drainBusy, setDrainBusy] = useState(false);
  const [tainting, setTainting] = useState<KubeItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [forwarding, setForwarding] = useState<KubeItem | null>(null);
  const [incomingAsk, setIncomingAsk] = useState<{ id: number; text: string } | null>(null);
  const [lastSection, setLastSection] = useState<Record<string, string>>({});

  // "Ask the assistant" from any menu: open the assistant tab and hand it the prompt.
  const openAssistant = useCallback(
    (prompt?: string) => {
      const id = `assistant:${context ?? 'none'}`;
      setDockTabs((current) => (current.some((tab) => tab.id === id) ? current : [...current, { id, kind: 'assistant', title: 'Assistant', context: context ?? '' }]));
      setDockActive(id);
      if (prompt) setIncomingAsk({ id: Date.now(), text: prompt });
    },
    [context],
  );
  useEffect(() => {
    const onAsk = (event: Event) => openAssistant((event as CustomEvent<string>).detail);
    window.addEventListener('mjolnir:ask', onAsk);
    return () => window.removeEventListener('mjolnir:ask', onAsk);
  }, [openAssistant]);

  // ⌘K anywhere. The palette is the map of the whole app, so it is never more
  // than one chord away, whatever has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    void (async () => {
      const [clusterData, kindData] = await Promise.all([api.clusters(), api.kinds()]);
      setClusters(clusterData);
      setKinds(kindData.resources);
      const remembered = route.context && clusterData.contexts.some((entry) => entry.name === route.context) ? route.context : null;
      setContext(remembered ?? clusterData.currentContext ?? clusterData.contexts[0]?.name ?? null);
    })();
  }, [route.context]);

  useEffect(() => {
    if (!context) return;
    void (async () => {
      const response = await fetch(`/api/metrics/${encodeURIComponent(context)}/pods`);
      setPodMetrics((await response.json()) as MetricsResponse);
    })();
  }, [context]);

  const definition = useMemo(() => kinds.find((entry) => entry.kind === kind), [kinds, kind]);

  const view =
    selection.kind === 'page' ? selection.value : selection.kind === 'resource' ? 'resources' : selection.kind;
  const moduleId = selection.kind === 'workspace' ? (selection.value.split(':')[0] ?? '') : KUBERNETES_MODULE.id;
  const section = selection.kind === 'workspace' ? selection.value.split(':')[1] : undefined;
  const tool = selection.kind === 'tool' || selection.kind === 'workspace' ? toolById(selection.kind === 'workspace' ? moduleId : selection.value) : undefined;
  const sectionLabel = section && tool ? tool.sections?.find((entry) => entry.toLowerCase().replace(/\s+/g, '-') === section) : undefined;
  const isAppSettings = selection.kind === 'page' && selection.value === 'app-settings';

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
   * The named object may not be loaded yet, the list for that kind might not
   * have been fetched, so the name is held and matched once it arrives. That
   * keeps the click instant instead of blocking on a round trip.
   */
  const navigate = useCallback((target: NavigateTarget) => {
    if (target.workspace) {
      setSelection({ kind: 'workspace', value: target.workspace });
      setSelected(null);
      return;
    }
    setSelection({ kind: 'resource', value: target.kind });
    setKind(target.kind);
    setNamespace(target.namespace ?? '');
    setStatusFilter(target.filter ?? '');
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

  /**
   * The row the panel shows is the live one. `selected` is what was clicked;
   * the list refreshes every second and after every patch, and the panel must
   * follow it, otherwise a label you just added is not there until you close
   * and reopen.
   */
  useEffect(() => {
    writeRoute({
      ...(context ? { context } : {}),
      selection,
      ...(namespace ? { namespace } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(selected?.metadata?.name ? { selected: selected.metadata.name } : {}),
      ...(drawerTab ? { tab: drawerTab } : {}),
    });
  }, [context, selection, namespace, statusFilter, selected, drawerTab]);

  /**
   * The status filter. A value is either a status ("CrashLoopBackOff") or a
   * tone ("tone:error"), so the health strip's "3 failing" is the same filter
   * as picking every failing status by hand.
   */
  const statusOf = useCallback(
    (item: KubeItem): string | undefined => {
      if (kind === 'Pod') return podStatus(item as never);
      if (kind === 'Node') {
        const ready = (item.status as { conditions?: Array<{ type?: string; status?: string }> } | undefined)?.conditions?.find((c) => c.type === 'Ready');
        return ready?.status === 'True' ? 'Ready' : 'NotReady';
      }
      const phase = (item.status as { phase?: string } | undefined)?.phase;
      return phase;
    },
    [kind],
  );
  const matchesStatus = useCallback(
    (item: KubeItem) => {
      if (!statusFilter) return true;
      const status = statusOf(item);
      if (!status) return false;
      return statusFilter.startsWith('tone:') ? toneFor(status) === statusFilter.slice(5) : status === statusFilter;
    },
    [statusFilter, statusOf],
  );
  const visibleItems = useMemo(() => (statusFilter ? items.filter(matchesStatus) : items), [items, statusFilter, matchesStatus]);
  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const status = statusOf(item);
      if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ value: status, label: status, hint: String(count) }));
  }, [items, statusOf]);

  const drawerItem = useMemo(() => {
    if (!selected) return null;
    return (
      items.find(
        (item) =>
          item.metadata?.name === selected.metadata?.name &&
          item.metadata?.namespace === selected.metadata?.namespace,
      ) ?? selected
    );
  }, [items, selected]);

  const openInDock = useCallback(
    (item: KubeItem) => {
      if (!context) return;
      const name = item.metadata?.name ?? '';
      const ns = item.metadata?.namespace ?? '';
      const id = `logs:${context}:${ns}:${name}`;
      const spec = item.spec as { containers?: Array<{ name?: string }> } | undefined;
      const containers = (spec?.containers ?? []).map((c) => c.name ?? '').filter(Boolean);
      setDockTabs((current) =>
        current.some((tab) => tab.id === id)
          ? current
          : [...current, { id, kind: 'logs', title: name, subtitle: ns, context, namespace: ns, pod: name, containers }],
      );
      setDockActive(id);
    },
    [context],
  );

  const openShell = useCallback(
    (item: KubeItem, container?: string) => {
      if (!context) return;
      const name = item.metadata?.name ?? '';
      const ns = item.metadata?.namespace ?? '';
      const spec = item.spec as { containers?: Array<{ name?: string }> } | undefined;
      const chosen = container ?? spec?.containers?.[0]?.name ?? '';
      const id = `shell:${context}:${ns}:${name}:${chosen}`;
      setDockTabs((current) =>
        current.some((tab) => tab.id === id)
          ? current
          : [...current, { id, kind: 'terminal', title: name, subtitle: chosen, context, namespace: ns, pod: name, container: chosen }],
      );
      setDockActive(id);
    },
    [context],
  );

  const restart = useCallback(
    async (item: KubeItem) => {
      if (!context) return;
      const name = item.metadata?.name ?? '';
      try {
        // The same annotation `kubectl rollout restart` writes, so the rollout
        // is indistinguishable from one started at a terminal.
        await api.patch(
          context,
          kind,
          name,
          { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } } },
          item.metadata?.namespace,
        );
        toast.success(`Rollout restarted: ${name}`);
        void load();
      } catch (cause) {
        toast.error(`Could not restart ${name}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },
    [context, kind, load],
  );

  /** A verb that is one patch: run it, say what happened, refresh. */
  const verb = useCallback(
    async (label: string, run: () => Promise<string | void>) => {
      try {
        const said = await run();
        toast.success(said ?? label);
        void load();
      } catch (cause) {
        toast.error(`${label} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },
    [load],
  );

  const onRowAction = useCallback(
    (action: string, item: KubeItem) => {
      const name = item.metadata?.name ?? '';
      if (!context) return;
      switch (action) {
        case 'cordon':
          void verb(`Cordoned ${name}`, () => setSchedulable(context, item, false));
          return;
        case 'uncordon':
          void verb(`Uncordoned ${name}`, () => setSchedulable(context, item, true));
          return;
        case 'drain':
          setDraining(item);
          return;
        case 'forward':
          setForwarding(item);
          return;
        case 'taint':
          setTainting(item);
          return;
        case 'pause':
          void verb(`Paused rollout of ${name}`, () => setPaused(context, item, true));
          return;
        case 'resume':
          void verb(`Resumed rollout of ${name}`, () => setPaused(context, item, false));
          return;
        case 'undo':
          void verb(`Rolled back ${name}`, () => rolloutUndo(context, item));
          return;
        default:
          break;
      }
      switch (action) {
        case 'filter-namespace':
          setNamespace(item.metadata?.namespace ?? '');
          return;
        case 'filter-node':
          setFilter(typeof item.spec?.['nodeName'] === 'string' ? (item.spec['nodeName'] as string) : '');
          return;
        case 'dock-logs':
          openInDock(item);
          return;
        case 'shell':
          openShell(item);
          return;
        case 'restart':
          void restart(item);
          return;
        case 'scale':
          setScaling(item);
          return;
        default:
          break;
      }
      setSelected(item);
      // Every remaining action lands in the panel on the tab that performs it.
      if (action === 'logs') setDrawerTab('logs');
      else if (action === 'yaml') setDrawerTab('yaml');
      else setDrawerTab('overview');
    },
    [openInDock, openShell, restart, verb, context],
  );

  const apiVersionFor = (entry: ResourceDefinition | undefined): string => {
    const loose = entry as unknown as { apiVersion?: string; group?: string; version?: string } | undefined;
    if (loose?.apiVersion) return loose.apiVersion;
    const version = loose?.version ?? 'v1';
    return loose?.group ? `${loose.group}/${version}` : version;
  };

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
    const name = drawerItem?.metadata?.name;
    const series = podMetrics?.series.find((entry) => entry.name === name);
    if (!series) return undefined;
    return {
      cpu: series.points.map((point) => ({ t: point.t, v: point.cpu })),
      memory: series.points.map((point) => ({ t: point.t, v: point.memory })),
    };
  }, [drawerItem, podMetrics]);

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="flex h-full flex-col bg-ground text-primary">
        <TitleBar
          module={tool && moduleId !== KUBERNETES_MODULE.id ? { label: tool.label, tint: tool.tint, icon: tool.icon } : isAppSettings ? null : { label: KUBERNETES_MODULE.label, tint: KUBERNETES_MODULE.tint, icon: null }}
          current={moduleId === KUBERNETES_MODULE.id && !isAppSettings ? current : undefined}
          theme={theme.resolved}
          onToggleTheme={() => theme.set(theme.resolved === 'dark' ? 'light' : 'dark')}
          onPalette={() => setPaletteOpen(true)}
          onAssistant={() => openAssistant()}
        />

        <div className="flex min-h-0 flex-1">
          <ModuleRail
            active={moduleId}
            settingsActive={isAppSettings}
            onSelect={(id) => {
              setSelected(null);
              if (id === KUBERNETES_MODULE.id) setSelection({ kind: 'page', value: 'overview' });
              else setSelection({ kind: 'workspace', value: lastSection[id] ?? id });
            }}
            onSettings={() => setSelection({ kind: 'page', value: 'app-settings' })}
          />

          {isAppSettings ? null : moduleId === KUBERNETES_MODULE.id ? (
            <ClusterStrip
              contexts={clusters?.contexts ?? []}
              current={context}
              onSelect={(name) => {
                setContext(name);
                setSelected(null);
              }}
              onAdd={() => setSelection({ kind: 'page', value: 'settings' })}
            />
          ) : null}

          {isAppSettings ? null : (
            <div className="relative flex shrink-0">
              <Sidebar
                kinds={kinds}
                selection={selection}
                counts={counts}
                width={sidebar.width}
                module={moduleId === KUBERNETES_MODULE.id ? undefined : tool}
                onSelect={(next) => {
                  setSelection(next);
                  if (next.kind === 'resource') setKind(next.value);
                  if (next.kind === 'workspace') setLastSection((current) => ({ ...current, [next.value.split(':')[0] ?? '']: next.value }));
                  setSelected(null);
                }}
              />
              <ResizeHandle
                side="right"
                label="Resize navigation"
                dragging={sidebar.dragging}
                onPointerDown={sidebar.onPointerDown}
              />
            </div>
          )}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view === 'resources' ? `resources:${kind}` : view}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14, ease: 'linear' }}
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              >
            {view === 'overview' && context ? (
              <Overview context={context} onNavigate={navigate} />
            ) : null}

            {view === 'tool' && tool?.id === 'portforward' ? (
              <ForwardsPanel onOpenPod={(record) => navigate({ kind: 'Pod', name: record.pod, namespace: record.namespace })} />
            ) : (view === 'tool' || view === 'workspace') && tool ? (
              <ToolPanel tool={tool} section={sectionLabel} />
            ) : null}

            {view === 'settings' || view === 'app-settings' ? (
              <SettingsPanel
                scope={view === 'settings' ? 'kubernetes' : 'app'}
                clusters={clusters}
                theme={theme.choice}
                onTheme={theme.set}
                onReload={async () => setClusters(await api.reloadClusters())}
                onClustersChanged={async () => {
                  const next = await api.clusters();
                  setClusters(next);
                  if (context && !next.contexts.some((entry) => entry.name === context)) setContext(next.contexts[0]?.name ?? null);
                }}
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
                    className="w-[300px] min-w-[160px] shrink"
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

                  {statusOptions.length ? (
                    <Select
                      label="Status"
                      value={statusFilter}
                      onChange={setStatusFilter}
                      testId="status-select"
                      options={[
                        { value: '', label: 'All statuses' },
                        ...(kind === 'Pod'
                          ? [
                              { value: 'tone:error', label: 'Failing', hint: String(health?.error ?? 0) },
                              { value: 'tone:warn', label: 'Pending', hint: String(health?.warn ?? 0) },
                            ]
                          : []),
                        ...statusOptions,
                      ]}
                    />
                  ) : null}

                  <Button data-testid="create-open" onClick={() => setCreating(true)} icon={<Plus size={13} strokeWidth={2.2} />}>
                    Create
                  </Button>

                  <div className="flex-1" />

                  {health ? (
                    <div className="flex shrink-0 items-center gap-3 whitespace-nowrap font-mono text-[11.5px]" data-testid="health-strip">
                      {health.error > 0 ? <Dot tone="error" active={statusFilter === 'tone:error'} onClick={() => setStatusFilter(statusFilter === 'tone:error' ? '' : 'tone:error')}>{health.error} failing</Dot> : null}
                      {health.warn > 0 ? <Dot tone="warn" active={statusFilter === 'tone:warn'} onClick={() => setStatusFilter(statusFilter === 'tone:warn' ? '' : 'tone:warn')}>{health.warn} pending</Dot> : null}
                      <Dot tone="ok" active={statusFilter === 'tone:ok'} onClick={() => setStatusFilter(statusFilter === 'tone:ok' ? '' : 'tone:ok')}>{health.ok} running</Dot>
                    </div>
                  ) : null}
                </div>

                <div className="relative flex min-h-0 flex-1">
                  <ResourceList
                    kind={kind}
                    label={definition?.label}
                    namespace={definition?.namespaced ? namespace : undefined}
                    items={visibleItems}
                    state={state}
                    error={error}
                    filter={filter}
                    selectedName={drawerItem?.metadata?.name}
                    onSelect={(item) => {
                      setSelected(item);
                      setDrawerTab(undefined);
                    }}
                    onAction={onRowAction}
                  />
                  <AnimatePresence>
                  {drawerItem ? (
                    <ResourceDrawer
                      key="drawer"
                      context={context ?? ''}
                      kind={kind}
                      item={drawerItem}
                      {...(selectedMetrics ? { metrics: selectedMetrics } : {})}
                      {...(drawerTab ? { initialTab: drawerTab } : {})}
                      onNavigate={navigate}
                      onForward={(item) => setForwarding(item)}
                      onShell={(item, container) => openShell(item, container)}
                      onDeleted={() => void load()}
                      onClose={() => setSelected(null)}
                    />
                  ) : null}
                  </AnimatePresence>
                </div>
              </>
            ) : null}
              </motion.div>
            </AnimatePresence>
            </div>

            <AnimatePresence>
            {dockTabs.length ? (
              <Dock
                key="dock"
                assistant={{ incoming: incomingAsk, onOpenSettings: () => setSelection({ kind: 'page', value: 'app-settings' }) }}
                tabs={dockTabs}
                activeId={dockActive}
                height={dock.width}
                dragging={dock.dragging}
                onResizeStart={dock.onPointerDown}
                onActivate={setDockActive}
                onClose={(id) => {
                  setDockTabs((current) => current.filter((tab) => tab.id !== id));
                  setDockActive((active) => (active === id ? null : active));
                }}
                onCloseAll={() => setDockTabs([])}
                onExpand={(tab) => {
                  if (tab.kind !== 'logs') return;
                  navigate({ kind: 'Pod', name: tab.pod ?? '', namespace: tab.namespace ?? '' });
                  setDrawerTab('logs');
                }}
              />
            ) : null}
            </AnimatePresence>
          </main>
        </div>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          kinds={kinds}
          clusters={clusters?.contexts ?? []}
          namespaces={namespaces}
          kind={kind}
          items={items}
          theme={theme.resolved}
          onNavigate={(next) => {
            setSelection(next);
            if (next.kind === 'resource') setKind(next.value);
            setSelected(null);
          }}
          onCluster={(name) => {
            setContext(name);
            setSelected(null);
          }}
          onNamespace={(ns) => {
            if (selection.kind !== 'resource') setSelection({ kind: 'resource', value: 'Pod' });
            setNamespace(ns);
          }}
          onOpenItem={(item) => {
            setSelected(item);
            setDrawerTab(undefined);
          }}
          onToggleTheme={() => theme.set(theme.resolved === 'dark' ? 'light' : 'dark')}
        />

        <ConfirmDialog
          open={draining !== null}
          testId="drain-dialog"
          title={`Drain ${draining?.metadata?.name ?? ''}?`}
          body="The node is cordoned first, then every pod on it that is not a DaemonSet's is evicted through the Eviction API, so disruption budgets are honoured. Pods return when their controllers reschedule them."
          confirmLabel="Drain node"
          danger
          busy={drainBusy}
          onClose={() => setDraining(null)}
          onConfirm={() => {
            if (!context || !draining) return;
            setDrainBusy(true);
            void verb(`Drained ${draining.metadata?.name ?? ''}`, async () => {
              const count = await drainNode(context, draining);
              return `Drained ${draining.metadata?.name ?? ''}: ${count} pod${count === 1 ? '' : 's'} evicted`;
            }).finally(() => {
              setDrainBusy(false);
              setDraining(null);
            });
          }}
        />

        <TaintDialog
          node={tainting}
          onClose={() => setTainting(null)}
          onApply={async (taints) => {
            if (!context || !tainting) return;
            await verb(`Updated taints on ${tainting.metadata?.name ?? ''}`, () => setTaints(context, tainting, taints));
          }}
        />

        <CreateDialog
          open={creating}
          kind={kind}
          apiVersion={apiVersionFor(definition)}
          namespace={definition?.namespaced ? namespace : undefined}
          onClose={() => setCreating(false)}
          onCreate={async (text) => {
            if (!context) return;
            await api.create(context, kind, text, definition?.namespaced ? namespace || undefined : undefined);
            toast.success(`Created ${kind.toLowerCase()}`);
            setCreating(false);
            void load();
          }}
        />

        <PortForwardDialog context={context ?? ''} pod={forwarding} onClose={() => setForwarding(null)} />

        <ScaleDialog
          item={scaling}
          kind={kind}
          onClose={() => setScaling(null)}
          onScale={async (replicas) => {
            if (!context || !scaling) return;
            const name = scaling.metadata?.name ?? '';
            try {
              await api.patch(context, kind, name, { spec: { replicas } }, scaling.metadata?.namespace);
              toast.success(`${name} scaled to ${replicas}`);
              void load();
            } catch (cause) {
              toast.error(`Could not scale ${name}: ${cause instanceof Error ? cause.message : String(cause)}`);
              throw cause;
            }
          }}
        />

        <Toaster theme={theme.resolved} position="bottom-right" />
      </div>
    </Tooltip.Provider>
  );
}

function Dot({
  tone,
  active,
  onClick,
  children,
}: {
  tone: 'ok' | 'warn' | 'error';
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-error';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={`health-${tone}`}
      className={`flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 transition-colors duration-100 hover:bg-hover ${color} ${
        active ? 'bg-pressed ring-1 ring-[var(--border-strong)]' : ''
      }`}
    >
      <Circle size={6} strokeWidth={0} aria-hidden className="fill-current" />
      {children}
    </button>
  );
}

interface TitleBarProps {
  readonly module: { label: string; tint: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }> | null } | null;
  readonly current: ClusterContext | undefined;
  readonly theme: 'dark' | 'light';
  readonly onToggleTheme: () => void;
  readonly onPalette: () => void;
  readonly onAssistant: () => void;
}

/** True inside the Electron shell, where macOS draws traffic lights over us. */
const IS_DESKTOP =
  typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

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
 * rail. What is left is who you are connected to and whether it is answering -
 * the two things worth having on screen permanently.
 */
function TitleBar({ module, current, theme, onToggleTheme, onPalette, onAssistant }: TitleBarProps) {
  const provider = current ? PROVIDER_LABEL[current.provider] : '';
  const timezone = useTimezone();
  const zoneOptions = useMemo(() => timezoneOptions(), []);

  return (
    <header
      data-testid="title-bar"
      // The macOS traffic lights live in this strip; the left inset is theirs.
      className={`flex h-[44px] shrink-0 items-center gap-2.5 border-b border-line bg-raised pr-3 ${
        IS_DESKTOP ? 'pl-[84px]' : 'pl-4'
      }`}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <Zap size={15} strokeWidth={2.2} aria-hidden className="shrink-0 text-accent" />
      <span className="text-[13px] font-semibold tracking-[-0.01em] text-primary">Mjolnir</span>

      <div className="mx-1 h-4 w-px bg-[var(--border-default)]" />

      {module ? (
        <span className="flex items-center gap-1.5 text-[12.5px] text-primary" data-testid="module-crumb">
          {module.icon ? <module.icon size={13} strokeWidth={1.9} style={{ color: module.tint }} /> : <span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: module.tint }} />}
          {module.label}
        </span>
      ) : (
        <span className="text-[12.5px] text-primary" data-testid="module-crumb">Settings</span>
      )}

      {current !== undefined ? <span className="text-tertiary">›</span> : null}

      {current !== undefined ? (
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
      ) : null}

      <div className="flex-1" />

      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Select
          label="Timezone"
          value={timezone.choice}
          onChange={timezone.set}
          testId="timezone-badge"
          align="end"
          mono
          options={zoneOptions}
          trigger={
            <button
              type="button"
              data-testid="timezone-badge"
              aria-label={`Timezone ${timezone.zone}. Click to change`}
              className="group flex h-[28px] items-center gap-1.5 rounded-md border border-transparent px-2 text-[11.5px] transition-colors duration-100 hover:border-line hover:bg-hover data-[state=open]:border-line data-[state=open]:bg-hover"
            >
              <Globe size={12} strokeWidth={1.9} aria-hidden className="text-tertiary" />
              <span className="font-mono text-secondary">{timezone.zone.split('/').pop()?.replace(/_/g, ' ')}</span>
              <span className="rounded-xs bg-sunken px-1 font-mono text-[10.5px] text-tertiary">{utcLabel(offsetMinutes(timezone.zone))}</span>
            </button>
          }
        />
        <Button
          variant="ghost"
          data-testid="assistant-open"
          onClick={onAssistant}
          icon={<Sparkles size={13} strokeWidth={1.9} className="text-accent" />}
        >
          <span className="text-secondary">Assistant</span>
        </Button>
        <Button
          variant="ghost"
          data-testid="palette-open"
          onClick={onPalette}
          icon={<Search size={13} strokeWidth={2} />}
        >
          <span className="text-secondary">Search</span>
          <kbd className="ml-1.5 inline-flex items-center gap-[2px] rounded-xs border border-line px-1 font-sans text-[10px] text-tertiary">
            <CommandIcon size={9} strokeWidth={2.2} aria-hidden />K
          </kbd>
        </Button>
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
