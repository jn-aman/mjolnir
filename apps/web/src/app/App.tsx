import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { toast, Toaster } from 'sonner';
import type { ClusterContext, ResourceDefinition, WatchState } from '@mjolnir/k8s';
import { AnimatePresence, motion } from 'motion/react';
import { Ban, Circle, CirclePlay, Command as CommandIcon, Copy, Moon, Plus, RotateCw, Search, Sparkles, Sun, Tag, Trash2 } from 'lucide-react';
import { api, type AppSettings, type ClustersResponse, type CustomResource } from '../lib/api.ts';
import { useTheme } from '../lib/theme.ts';
import { ResizeHandle, useResizable } from '../lib/useResizable.tsx';
import { ResourceList, type BulkAction } from '../components/ResourceList.tsx';
import { ResourceDrawer } from '../components/ResourceDrawer.tsx';
import { Sidebar, type NavSelection } from '../components/Sidebar.tsx';
import { NamespacePicker } from '../components/NamespacePicker.tsx';
import { ClusterStrip } from '../components/ClusterStrip.tsx';
import { ModuleRail } from '../components/ModuleRail.tsx';
import { EdgeToggle } from '../components/ui/EdgeToggle.tsx';
import { Welcome } from '../components/Welcome.tsx';
import { Overview, type NavigateTarget } from '../components/Overview.tsx';
import { SettingsPanel } from '../components/SettingsPanel.tsx';
import { podStatus, type KubeItem } from '../components/columns.tsx';
import { toneFor } from '../components/StatusChip.tsx';
import { Field } from '../components/ui/Field.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Button } from '../components/ui/Button.tsx';
import type { MetricsResponse } from '../lib/metrics.ts';
import { Dock, type DockTab } from '../components/Dock.tsx';
import { openPinned, openTab, togglePinned } from '../lib/dockTabs.ts';
import { CommandPalette } from '../components/CommandPalette.tsx';
import { useFlags } from '../lib/flags.tsx';
import { ToolPanel } from '../components/ToolPanel.tsx';
import { DiagnosePanel } from '../components/DiagnosePanel.tsx';
import { ScaleDialog } from '../components/ScaleDialog.tsx';
import { KUBERNETES_MODULE, toolById } from '../lib/tools.ts';
import { readRoute, writeRoute } from '../lib/route.ts';
import { useLiveCounts, useLiveList, useLiveState } from '../lib/live.ts';
import { parse as parseYamlText } from 'yaml';
import { dnsSubdomain, labelKey, labelValue, namespaceName } from '../lib/validate.ts';
import { offsetMinutes, timezoneOptions, useTimezone, utcLabel } from '../lib/time.ts';
import { Globe } from 'lucide-react';
import { drainNode, rolloutUndo, setPaused, setSchedulable, setTaints } from '../lib/edits.ts';
import { askAssistant, copyText } from '../components/ui/ContextMenu.tsx';
import { ConfirmDialog, Modal } from '../components/ui/Modal.tsx';
import { TaintDialog } from '../components/TaintDialog.tsx';
import { CreateDialog } from '../components/CreateDialog.tsx';
import { PortForwardDialog } from '../components/PortForwardDialog.tsx';
import { ForwardsPanel } from '../components/ForwardsPanel.tsx';
import { DockerModule, type DockerSection } from '../components/docker/DockerModule.tsx';
import { ScanDialog } from '../components/ScanDialog.tsx';
import { HelmPanel } from '../components/HelmPanel.tsx';
import { StorageModule, type StorageSection } from '../components/storage/StorageModule.tsx';
import { MarkTile } from '../components/ui/Mark.tsx';

export function App() {
  const theme = useTheme();
  const [clusters, setClusters] = useState<ClustersResponse | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [kinds, setKinds] = useState<ResourceDefinition[]>([]);
  /** The kinds this cluster defines itself, discovered from its CRDs. */
  const [customKinds, setCustomKinds] = useState<CustomResource[]>([]);
  // Surfaces ask for themselves. Every one of these defaults on, so a build
  // with no flag server looks exactly like this one; the flags exist so a
  // surface can be narrowed for a customer, or turned off from the server when
  // it misbehaves in the field, without cutting a release.
  const { values: flagValues } = useFlags();
  const canPalette = flagValues['ui.command-palette'] ?? true;
  const canFilters = flagValues['ui.filters'] ?? true;
  const canDock = flagValues['ui.dock'] ?? true;
  const canScan = flagValues['scan.images'] ?? true;
  // Where the URL says we were, so a reload does not start over.
  const [route] = useState(readRoute);
  const [selection, setSelection] = useState<NavSelection>(route.selection ?? { kind: 'page', value: 'overview' });
  /**
   * The object "What broke?" was opened about, if it was opened from a row.
   *
   * Cleared when the tool is left, so coming back to it from the rail asks
   * about the cluster again rather than silently answering about whatever was
   * right-clicked twenty minutes ago.
   */
  const [diagnosing, setDiagnosing] = useState<{ kind: string; name: string; namespace?: string } | undefined>(undefined);
  const [kind, setKind] = useState(route.selection?.kind === 'resource' ? route.selection.value : 'Pod');
  const [namespaces, setNamespaces] = useState<string[]>(route.namespace ? route.namespace.split(',').filter(Boolean) : []);
  /** The one namespace to scope a server request to; empty means all, or several (filtered here). */
  const namespace = namespaces.length === 1 ? (namespaces[0] ?? '') : '';
  const setNamespace = useCallback((next: string) => setNamespaces(next ? [next] : []), []);
  const [allNamespaces, setAllNamespaces] = useState<string[]>([]);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);
  /** null until the settings file has been read; the welcome cannot decide before then. */
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [statusFilter, setStatusFilter] = useState(route.status ?? '');
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<KubeItem[]>([]);
  const [state, setState] = useState<WatchState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<KubeItem | null>(null);
  /**
   * What each view looked like when you left it: the filter, the status
   * filter, the open object and its tab. Coming back restores all of it, so
   * the sidebar is a way to move between places, not a reset button.
   */
  const viewMemory = useRef<Record<string, { filter: string; status: string; selected: string | null; tab: string | undefined }>>({});
  const viewKey = (sel: NavSelection) => `${sel.kind}:${sel.value}`;
  /** Which module a view belongs to, so the rail can return you to it. */
  const moduleOf = (sel: NavSelection) => (sel.kind === 'workspace' ? (sel.value.split(':')[0] ?? '') : KUBERNETES_MODULE.id);
  // Read at click time, not from a closure that may be a render behind.
  const latestView = useRef({ selection, filter: '', status: '', selected: null as string | null, tab: undefined as string | undefined });
  const [pendingName, setPendingName] = useState<string | null>(route.selected ?? null);
  const [drawerTab, setDrawerTab] = useState<string | undefined>(route.tab);
  const [podMetrics, setPodMetrics] = useState<MetricsResponse | null>(null);
  const sidebar = useResizable({ key: 'sidebar', initial: 212, min: 160, max: 420, direction: 'right' });
  /** full: rail, strip and sidebar. compact: sidebar as icons. hidden: content only. */
  const [chrome, setChrome] = useState<'full' | 'compact' | 'hidden'>(() => {
    try {
      const stored = localStorage.getItem('mjolnir.chrome');
      return stored === 'compact' || stored === 'hidden' ? stored : 'full';
    } catch {
      return 'full';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('mjolnir.chrome', chrome);
    } catch {
      // fine
    }
  }, [chrome]);
  /** The module rail reading as words rather than shapes. Its own preference. */
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mjolnir.rail') === 'open';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('mjolnir.rail', railOpen ? 'open' : 'closed');
    } catch {
      // fine
    }
  }, [railOpen]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setRailOpen((current) => !current);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setChrome((current) => (event.shiftKey ? (current === 'hidden' ? 'full' : 'hidden') : current === 'compact' ? 'full' : 'compact'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    void api.settings
      .get()
      .then((response) => {
        setAppSettings(response.settings);
        // First run is "the file has never recorded an answer", not "no
        // settings file", so a reset that keeps preferences does not replay it.
        // The flag decides whether there is a welcome at all; the setting
        // decides whether this person has already seen it.
        if (!response.settings.onboarding.completed && (flagValues['ui.onboarding'] ?? true)) setWelcome(true);
      })
      .catch(() => undefined);
  }, []);
  const dock = useResizable({ key: 'dock', initial: 280, min: 120, max: 720, direction: 'up' });
  const [dockTabs, setDockTabs] = useState<DockTab[]>([]);
  const [dockActive, setDockActive] = useState<string | null>(null);
  // Remembered, because someone who put the dock away meant it to stay away.
  const [dockCollapsed, setDockCollapsed] = useState(() => {
    try {
      return localStorage.getItem('mjolnir.dock.collapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('mjolnir.dock.collapsed', dockCollapsed ? '1' : '0');
    } catch {
      // A preference that cannot be saved still applies for this session.
    }
  }, [dockCollapsed]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scaling, setScaling] = useState<KubeItem | null>(null);
  const [draining, setDraining] = useState<KubeItem | null>(null);
  const [drainBusy, setDrainBusy] = useState(false);
  const [tainting, setTainting] = useState<KubeItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [forwarding, setForwarding] = useState<KubeItem | null>(null);
  const [bulkDelete, setBulkDelete] = useState<KubeItem[] | null>(null);
  const [bulkLabel, setBulkLabel] = useState<KubeItem[] | null>(null);
  const [bulkLabelText, setBulkLabelText] = useState('');
  const [incomingAsk, setIncomingAsk] = useState<{ id: number; text: string } | null>(null);
  const [scanningImage, setScanningImage] = useState<string | null>(null);
  const [focusStorage, setFocusStorage] = useState<string | undefined>(undefined);
  const [decor, setDecor] = useState<Record<string, { label?: string; color?: string }>>({});
  const loadDecor = useCallback(async () => {
    try {
      setDecor((await api.settings.get()).settings.clusters.perContext);
    } catch {
      // decoration only
    }
  }, []);
  useEffect(() => {
    void loadDecor();
  }, [loadDecor]);
  // "Open bucket browser" on a storage pod: a connection through a forward, then the module.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ name: string; source: { context: string; namespace: string; pod: string; port: number }; accessKey?: string; secretKey?: string }>).detail;
      void api.storage
        .addConnection({ name: detail.name, source: detail.source, accessKey: detail.accessKey ?? '', secretKey: detail.secretKey ?? '', pathStyle: true, region: 'us-east-1' })
        .then((response) => {
          setFocusStorage(response.connection.id);
          setSelection({ kind: 'workspace', value: 'storage:buckets' });
          setSelected(null);
        })
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)));
    };
    window.addEventListener('mjolnir:open-storage', onOpen);
    return () => window.removeEventListener('mjolnir:open-storage', onOpen);
  }, []);
  useEffect(() => {
    const onScan = (event: Event) => setScanningImage((event as CustomEvent<string>).detail);
    window.addEventListener('mjolnir:scan', onScan);
    return () => window.removeEventListener('mjolnir:scan', onScan);
  }, []);
  const openDockerTab = useCallback((tab: { kind: 'logs' | 'terminal'; context: string; id: string; name: string }) => {
    const id = `docker-${tab.kind}:${tab.context}:${tab.id}`;
    setDockTabs((current) =>
      current.some((t) => t.id === id)
        ? current
        : [...current, { id, kind: tab.kind, source: 'docker', title: tab.name, subtitle: tab.context, context: tab.context, namespace: '', pod: tab.id, container: tab.name, containers: [tab.name] }],
    );
    setDockActive(id);
  }, []);
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
      // Cmd+` for the dock: the same chord every terminal-shaped panel uses,
      // and it toggles rather than opens, because putting it away is the half
      // people do more often.
      if ((event.metaKey || event.ctrlKey) && event.key === '`') {
        event.preventDefault();
        setDockCollapsed((current) => !current);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (!canPalette) return;
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
    let cancelled = false;
    // Custom kinds are per cluster: the same window talks to a bare cluster and
    // to one carrying Argo, Cert-Manager and Crossplane, and the sidebar has to
    // differ between them.
    void api
      .kindsFor(context)
      .then((response) => {
        if (cancelled) return;
        setKinds(response.resources);
        setCustomKinds(response.custom);
      })
      .catch(() => {
        if (!cancelled) setCustomKinds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [context]);

  useEffect(() => {
    if (!context) return;
    void (async () => {
      const response = await fetch(`/api/metrics/${encodeURIComponent(context)}/pods`);
      setPodMetrics((await response.json()) as MetricsResponse);
    })();
  }, [context]);

  const allKinds = useMemo(() => [...kinds, ...customKinds], [kinds, customKinds]);
  const definition = useMemo(() => allKinds.find((entry) => entry.kind === kind), [allKinds, kind]);

  const view =
    selection.kind === 'page' ? selection.value : selection.kind === 'resource' ? 'resources' : selection.kind;
  const moduleId = selection.kind === 'workspace' ? (selection.value.split(':')[0] ?? '') : KUBERNETES_MODULE.id;
  const section = selection.kind === 'workspace' ? selection.value.split(':')[1] : undefined;
  const tool = selection.kind === 'tool' || selection.kind === 'workspace' ? toolById(selection.kind === 'workspace' ? moduleId : selection.value) : undefined;
  const sectionLabel = section && tool ? tool.sections?.find((entry) => entry.toLowerCase().replace(/\s+/g, '-') === section) : undefined;
  const isAppSettings = selection.kind === 'page' && selection.value === 'app-settings';

  // The list on screen and every count in the sidebar come over the live
  // wire; the server pushes when the cache changes. `load` is kept for the
  // callers that want a nudge right after a write, and is a no-op in effect
  // because the watch already delivered the change.
  const liveList = useLiveList<KubeItem>(context, selection.kind === 'resource' ? kind : null, definition?.namespaced && namespace ? namespace : undefined);
  const liveCounts = useLiveCounts(context);
  useEffect(() => {
    setItems(liveList.items);
    setState(liveList.state);
    setError(liveList.error);
  }, [liveList]);
  useEffect(() => {
    setCounts(liveCounts);
  }, [liveCounts]);
  const load = useCallback(async () => {
    // Deliberately empty: see above. Kept so call sites read as intent.
  }, []);

  /**
   * Opens whatever was clicked on the overview.
   *
   * The named object may not be loaded yet, the list for that kind might not
   * have been fetched, so the name is held and matched once it arrives. That
   * keeps the click instant instead of blocking on a round trip.
   */
  useEffect(() => {
    latestView.current = { selection, filter, status: statusFilter, selected: selected?.metadata?.name ?? null, tab: drawerTab };
  }, [selection, filter, statusFilter, selected, drawerTab]);

  /** Leaves the current view, remembering it, and enters another, restoring it. */
  const moduleMemory = useRef<Record<string, NavSelection>>({});
  const go = useCallback(
    (next: NavSelection) => {
      const leaving = latestView.current;
      viewMemory.current[viewKey(leaving.selection)] = { filter: leaving.filter, status: leaving.status, selected: leaving.selected, tab: leaving.tab };
      if (!(next.kind === 'tool' && next.value === 'whatbroke')) setDiagnosing(undefined);
      setSelection(next);
      const remembered = viewMemory.current[viewKey(next)];
      if (next.kind === 'resource') setKind(next.value);
      if (next.kind === 'workspace') setLastSection((current) => ({ ...current, [next.value.split(':')[0] ?? '']: next.value }));
      // Leaving a module and coming back should land where you left it. The
      // rail used to send Kubernetes to the overview every time, which threw
      // away the kind, the filter and the selected object you had just been
      // reading, and made the rail feel like a reload rather than a tab.
      // Settings is not a place in a module, so returning to Kubernetes must
      // not land you back in it.
      if (!(leaving.selection.kind === 'page' && leaving.selection.value.endsWith('settings'))) {
        moduleMemory.current[moduleOf(leaving.selection)] = leaving.selection;
      }
      setFilter(remembered?.filter ?? '');
      setStatusFilter(remembered?.status ?? '');
      setSelected(null);
      setPendingName(remembered?.selected ?? null);
      setDrawerTab(remembered?.tab);
    },
    [],
  );

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
      ...(namespaces.length ? { namespace: namespaces.join(',') } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(selected?.metadata?.name ? { selected: selected.metadata.name } : {}),
      ...(drawerTab ? { tab: drawerTab } : {}),
    });
  }, [context, selection, namespaces, statusFilter, selected, drawerTab]);

  // The cluster's namespace list, for the picker; the choice is kept per cluster.
  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    void api
      .list<KubeItem>(context, 'Namespace')
      .then((response) => {
        if (!cancelled) setAllNamespaces(response.items.map((item) => item.metadata?.name ?? '').filter(Boolean).sort());
      })
      .catch(() => setAllNamespaces([]));
    void api.settings.get().then((response) => {
      const remembered = response.settings.clusters.perContext[context]?.namespaces;
      if (!cancelled && remembered && !route.namespace) setNamespaces(remembered);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // route.namespace only matters on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);
  const rememberNamespaces = useCallback(
    (next: string[]) => {
      setNamespaces(next);
      if (context) void api.settings.update({ clusters: { perContext: { [context]: { namespaces: next } } } }).catch(() => undefined);
    },
    [context],
  );

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
  const visibleItems = useMemo(() => {
    const scoped = namespaces.length > 1 ? items.filter((item) => !item.metadata?.namespace || namespaces.includes(item.metadata.namespace)) : items;
    return statusFilter ? scoped.filter(matchesStatus) : scoped;
  }, [items, namespaces, statusFilter, matchesStatus]);
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

  /**
   * Puts a tab in the dock, taking over the unpinned one of its kind.
   *
   * The slot rule lives in `openTab`: look at logs for one pod, then another,
   * and the second replaces the first, because you were looking at logs and
   * you still are. Pin one and it stays put while the next opens beside it.
   */
  const addTab = useCallback((tab: DockTab, pin = false) => {
    setDockTabs((current) => {
      const result = pin ? openPinned(current, tab) : openTab(current, tab);
      setDockActive(result.activeId);
      return result.tabs;
    });
    setDockCollapsed(false);
  }, []);

  /**
   * Logs for a pod named by something other than a row.
   *
   * A finding from "What broke?" knows the pod, often the container, and
   * whether the interesting output is from the run that already ended. It does
   * not have the object, so it cannot go through `openInDock`.
   */
  const openLogsFor = useCallback(
    (target: { name: string; namespace?: string | undefined; container?: string | undefined; previous?: boolean }) => {
      if (!context) return;
      const ns = target.namespace ?? '';
      addTab({
        id: `logs:${context}:${ns}:${target.name}${target.previous ? ':previous' : ''}`,
        kind: 'logs',
        title: target.name,
        subtitle: target.previous ? `${ns} · previous run` : ns,
        context,
        namespace: ns,
        pod: target.name,
        containers: target.container ? [target.container] : [],
        ...(target.previous ? { previous: true } : {}),
      });
    },
    [context, addTab],
  );

  const openInDock = useCallback(
    (item: KubeItem, pin = false) => {
      if (!context) return;
      const name = item.metadata?.name ?? '';
      const ns = item.metadata?.namespace ?? '';
      const spec = item.spec as { containers?: Array<{ name?: string }> } | undefined;
      const containers = (spec?.containers ?? []).map((c) => c.name ?? '').filter(Boolean);
      addTab({ id: `logs:${context}:${ns}:${name}`, kind: 'logs', title: name, subtitle: ns, context, namespace: ns, pod: name, containers }, pin);
    },
    [context, addTab],
  );

  /**
   * Pin an object into the dock.
   *
   * The drawer belongs to the list you opened it from and closes when you
   * leave. The dock is the other half of that: the deployment you are rolling
   * out stays in front of you while you read its pods, its events and the
   * config map it mounts.
   */
  const pinToDock = useCallback(
    (item: KubeItem, itemKind: string) => {
      if (!context) return;
      const name = item.metadata?.name ?? '';
      const ns = item.metadata?.namespace ?? '';
      // Pinned on purpose: "keep this open" is the whole verb.
      addTab({ id: `resource:${context}:${itemKind}:${ns}:${name}`, kind: 'resource', title: name, subtitle: itemKind, context, namespace: ns, resourceKind: itemKind, name }, true);
    },
    [context, addTab],
  );

  /**
   * What the dock's plus button offers.
   *
   * A shell into a pod rather than a shell into "the cluster", because there
   * is no such thing: kubectl has no cluster-wide exec, and pretending there
   * is one would mean silently picking a pod for someone. Opening the
   * assistant belongs here too; it is a thing you keep beside your work.
   */
  const dockNewTabs = useMemo(
    () => [
      {
        id: 'assistant',
        label: 'Assistant',
        detail: 'Ask about anything in the cluster, and keep it open while you look',
        onSelect: () => openAssistant(),
      },
      {
        id: 'shell',
        label: 'Shell',
        detail: 'Pick a pod and open a terminal in it. It keeps running while you navigate away',
        onSelect: () => {
          navigate({ kind: 'Pod' });
          toast.message('Pick a pod, then Shell', { description: 'The terminal button on any row, or right-click it.' });
        },
      },
      {
        id: 'logs',
        label: 'Logs',
        detail: 'Tail a pod here while you read the deployment that owns it',
        onSelect: () => {
          navigate({ kind: 'Pod' });
          toast.message('Pick a pod, then Logs', { description: 'The logs button on any row opens it here.' });
        },
      },
    ],
    // openAssistant and navigate are stable callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const openShell = useCallback(
    (item: KubeItem, container?: string) => {
      if (!context) return;
      const name = item.metadata?.name ?? '';
      const ns = item.metadata?.namespace ?? '';
      const spec = item.spec as { containers?: Array<{ name?: string }> } | undefined;
      const chosen = container ?? spec?.containers?.[0]?.name ?? '';
      addTab({ id: `shell:${context}:${ns}:${name}:${chosen}`, kind: 'terminal', title: name, subtitle: chosen, context, namespace: ns, pod: name, container: chosen });
    },
    [context, addTab],
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
        case 'delete':
          setBulkDelete([item]);
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
        case 'logs':
        case 'dock-logs':
          // Logs go to the dock, always. A log you are reading has to survive
          // closing the thing you opened it from, and putting it in a panel
          // that closes when you look at the next pod is why the dock was
          // going unused: the obvious button did not lead there.
          openInDock(item);
          return;
        case 'pin':
          pinToDock(item, kind);
          return;
        case 'diagnose':
          // Scoped to this object, so it reads its pods and the events around
          // them rather than the whole namespace.
          setDiagnosing({ kind, name: item.metadata?.name ?? '', ...(item.metadata?.namespace ? { namespace: item.metadata.namespace } : {}) });
          setSelection({ kind: 'tool', value: 'whatbroke' });
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
      if (action === 'logs-here') setDrawerTab('logs');
      else if (action === 'yaml') setDrawerTab('yaml');
      else setDrawerTab('overview');
    },
    [openInDock, openShell, restart, verb, context],
  );

  /**
   * The verbs the bulk bar offers for the kind on screen. Each runs over the
   * ticked rows one at a time and reports how many it managed, because a
   * partial failure in the middle of twenty deletes is the normal case.
   */
  const bulkActions = useMemo((): BulkAction[] => {
    if (!context) return [];
    const restartable = new Set(['Deployment', 'StatefulSet', 'DaemonSet']);
    return [
      {
        id: 'ask',
        label: 'Ask the assistant',
        icon: <Sparkles size={12} strokeWidth={2} />,
        run: (chosen) =>
          askAssistant(
            `About these ${chosen.length} ${kind}s in cluster ${context}: ${chosen.map((c) => `${c.metadata?.namespace ?? ''}/${c.metadata?.name ?? ''}`).join(', ')}. Are they healthy, what do they have in common, and is anything wrong?`,
          ),
      },
      { id: 'copy', label: 'Copy names', icon: <Copy size={12} strokeWidth={2} />, run: (chosen) => copyText(chosen.map((c) => c.metadata?.name ?? '').join('\n'), `${chosen.length} names copied`) },
      { id: 'label', label: 'Add label…', icon: <Tag size={12} strokeWidth={2} />, run: (chosen) => setBulkLabel(chosen) },
      ...(restartable.has(kind)
        ? [{ id: 'restart', label: 'Restart rollout', icon: <RotateCw size={12} strokeWidth={2} />, run: async (chosen: KubeItem[]) => { for (const item of chosen) await restart(item); } }]
        : []),
      ...(kind === 'Node'
        ? [
            { id: 'cordon', label: 'Cordon', icon: <Ban size={12} strokeWidth={2} />, run: async (chosen: KubeItem[]) => { for (const item of chosen) await setSchedulable(context, item, false); toast.success(`Cordoned ${chosen.length}`); } },
            { id: 'uncordon', label: 'Uncordon', icon: <CirclePlay size={12} strokeWidth={2} />, run: async (chosen: KubeItem[]) => { for (const item of chosen) await setSchedulable(context, item, true); toast.success(`Uncordoned ${chosen.length}`); } },
          ]
        : []),
      { id: 'delete', label: 'Delete…', icon: <Trash2 size={12} strokeWidth={2} />, danger: true, run: (chosen) => setBulkDelete(chosen) },
    ];
  }, [context, kind, restart]);

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

  const namespacesSeen = useMemo(
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
    <Tooltip.Provider delayDuration={0} skipDelayDuration={600}>
      <div className="flex h-full flex-col bg-ground text-primary">
        <TitleBar
          module={tool && moduleId !== KUBERNETES_MODULE.id ? { label: tool.label, tint: tool.tint, icon: tool.icon } : isAppSettings ? null : { label: KUBERNETES_MODULE.label, tint: KUBERNETES_MODULE.tint, icon: null }}
          current={moduleId === KUBERNETES_MODULE.id && !isAppSettings ? current : undefined}
          theme={theme.resolved}
          onToggleTheme={() => theme.set(theme.resolved === 'dark' ? 'light' : 'dark')}
          onPalette={() => setPaletteOpen(true)}
          onAssistant={() => openAssistant()}
        />

        <div className="relative flex min-h-0 flex-1">
          {chrome !== 'hidden' ? (
          <ModuleRail
            active={moduleId}
            expanded={railOpen}
            onToggleExpanded={() => setRailOpen((current) => !current)}
            settingsActive={isAppSettings}
            onSelect={(id) =>
              go(
                moduleMemory.current[id] ??
                  (id === KUBERNETES_MODULE.id
                    ? { kind: 'page', value: 'overview' }
                    : { kind: 'workspace', value: lastSection[id] ?? id }),
              )
            }
            onSettings={() => setSelection({ kind: 'page', value: 'app-settings' })}
          />
          ) : null}

          {isAppSettings || chrome === 'hidden' ? null : moduleId === KUBERNETES_MODULE.id ? (
            <ClusterStrip
              contexts={clusters?.contexts ?? []}
              decor={decor}
              current={context}
              onSelect={(name) => {
                setContext(name);
                setSelected(null);
              }}
              onAdd={() => {
                setSettingsSection('kubeconfig');
                setSelection({ kind: 'page', value: 'settings' });
              }}
            />
          ) : null}

          {isAppSettings || chrome === 'hidden' ? null : (
            <div className="relative flex shrink-0">
              <Sidebar
                kinds={kinds}
                custom={customKinds}
                selection={selection}
                counts={counts}
                width={chrome === 'compact' ? 56 : sidebar.width}
                compact={chrome === 'compact'}
                module={moduleId === KUBERNETES_MODULE.id ? undefined : tool}
                onSelect={go}
              />
              {chrome === 'full' ? (
                <ResizeHandle
                  side="right"
                  label="Resize navigation"
                  dragging={sidebar.dragging}
                  onPointerDown={sidebar.onPointerDown}
                />
              ) : null}
              <EdgeToggle
                open={chrome === 'full'}
                onToggle={() => setChrome(chrome === 'full' ? 'compact' : 'full')}
                label={chrome === 'full' ? 'Collapse navigation to icons' : 'Expand navigation'}
                hint="Cmd B, Cmd Shift B hides it"
                testId="sidebar-collapse"
              />
            </div>
          )}
          {chrome === 'hidden' ? (
            <div className="relative w-0 shrink-0">
              <EdgeToggle open={false} onToggle={() => setChrome('full')} label="Show navigation" hint="Cmd Shift B" testId="chrome-show" />
            </div>
          ) : null}

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
              <Overview context={context} cluster={current} onNavigate={navigate} onDecorChanged={() => void loadDecor()} />
            ) : null}

            {view === 'tool' && tool?.id === 'whatbroke' && context ? (
              <DiagnosePanel
                context={context}
                namespace={namespace || undefined}
                focus={diagnosing}
                onNavigate={navigate}
                onOpenLogs={openLogsFor}
              />
            ) : view === 'tool' && tool?.id === 'helm' && context ? (
              <HelmPanel context={context} namespace={namespace || undefined} onNavigate={navigate} />
            ) : view === 'tool' && tool?.id === 'portforward' ? (
              <ForwardsPanel onOpenPod={(record) => navigate({ kind: 'Pod', name: record.pod, namespace: record.namespace })} />
            ) : view === 'workspace' && tool?.id === 'storage' ? (
              <StorageModule tool={tool} section={(section ?? 'buckets') as StorageSection} focusConnection={focusStorage} />
            ) : view === 'workspace' && tool?.id === 'docker' ? (
              <DockerModule tool={tool} section={(section ?? 'containers') as DockerSection} onOpenDock={openDockerTab} />
            ) : (view === 'tool' || view === 'workspace') && tool ? (
              <ToolPanel tool={tool} section={sectionLabel} />
            ) : null}

            {view === 'settings' || view === 'app-settings' ? (
              <SettingsPanel
                scope={view === 'settings' ? 'kubernetes' : 'app'}
                initialSection={settingsSection}
                onSectionShown={() => setSettingsSection(undefined)}
                onReplayWelcome={() => setWelcome(true)}
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
                <div className="flex h-[50px] shrink-0 items-center gap-2 border-b border-line bg-raised px-3.5">
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

                  {canFilters && definition?.namespaced ? (
                    <NamespacePicker all={allNamespaces.length ? allNamespaces : namespacesSeen} selected={namespaces} onChange={rememberNamespaces} />
                  ) : null}

                  {canFilters && statusOptions.length ? (
                    <Select
                      label="Status"
                      width={150}
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
                    namespace={definition?.namespaced ? (namespaces.length > 1 ? namespaces.join(', ') : namespace) : undefined}
                    items={visibleItems}
                    bulk={bulkActions}
                    state={state}
                    error={error}
                    filter={filter}
                    printerColumns={customKinds.find((entry) => entry.kind === kind)?.columns ?? []}
                    onClearFilter={() => setFilter('')}
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
                      onLogsInDock={(item) => openInDock(item)}
                      onPin={(item) => pinToDock(item, kind)}
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

            {/*
              Always mounted, never conditional on having tabs. A dock that
              appears only once something has filled it is a dock nobody finds,
              and it leaves no way to simply open a terminal.
            */}
            {canDock ? (
              <Dock
                key="dock"
                assistant={{ incoming: incomingAsk, onOpenSettings: () => setSelection({ kind: 'page', value: 'app-settings' }) }}
                tabs={dockTabs}
                activeId={dockActive}
                height={dock.width}
                dragging={dock.dragging}
                collapsed={dockCollapsed}
                onToggleCollapsed={() => setDockCollapsed((current) => !current)}
                onResizeStart={dock.onPointerDown}
                onActivate={setDockActive}
                newTabs={dockNewTabs}
                onTogglePin={(id) => setDockTabs((current) => togglePinned(current, id))}
                onReorder={(from, to) =>
                  setDockTabs((current) => {
                    const next = [...current];
                    const at = next.findIndex((tab) => tab.id === from);
                    const onto = next.findIndex((tab) => tab.id === to);
                    if (at < 0 || onto < 0) return current;
                    next.splice(onto, 0, ...next.splice(at, 1));
                    return next;
                  })
                }
                onClose={(id) => {
                  setDockTabs((current) => current.filter((tab) => tab.id !== id));
                  setDockActive((active) => (active === id ? null : active));
                }}
                onCloseAll={() => setDockTabs([])}
                onNavigate={navigate}
                onExpand={(tab) => {
                  if (tab.kind === 'resource' && tab.resourceKind && tab.name) {
                    navigate({ kind: tab.resourceKind, name: tab.name, namespace: tab.namespace ?? '' });
                    return;
                  }
                  if (tab.kind !== 'logs') return;
                  navigate({ kind: 'Pod', name: tab.pod ?? '', namespace: tab.namespace ?? '' });
                  setDrawerTab('logs');
                }}
              />
            ) : null}
          </main>
        </div>

        <CommandPalette
          open={canPalette && paletteOpen}
          onOpenChange={setPaletteOpen}
          kinds={kinds}
          clusters={clusters?.contexts ?? []}
          namespaces={allNamespaces.length ? allNamespaces : namespacesSeen}
          kind={kind}
          items={items}
          theme={theme.resolved}
          onNavigate={go}
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
            let doc: { apiVersion?: unknown; kind?: unknown; metadata?: { name?: unknown; namespace?: unknown } };
            try {
              doc = parseYamlText(text) as typeof doc;
            } catch (cause) {
              throw new Error(`YAML did not parse: ${cause instanceof Error ? cause.message : String(cause)}`);
            }
            if (!doc || typeof doc !== 'object') throw new Error('The document must be a YAML object.');
            if (typeof doc.apiVersion !== 'string' || !doc.apiVersion) throw new Error('apiVersion is required, e.g. v1 or apps/v1.');
            if (doc.kind !== kind) throw new Error(`kind must be ${kind}.`);
            if (typeof doc.metadata?.name !== 'string' || !doc.metadata.name) throw new Error('metadata.name is required.');
            const nameProblem = dnsSubdomain(doc.metadata.name);
            if (nameProblem) throw new Error(`metadata.name: ${nameProblem}`);
            if (definition?.namespaced) {
              const ns = typeof doc.metadata.namespace === 'string' ? doc.metadata.namespace : namespace;
              if (!ns) throw new Error('metadata.namespace is required for this kind.');
              const nsProblem = namespaceName(ns);
              if (nsProblem) throw new Error(`metadata.namespace: ${nsProblem}`);
            }
            await api.create(context, kind, text, definition?.namespaced ? namespace || undefined : undefined);
            toast.success(`Created ${kind.toLowerCase()}`);
            setCreating(false);
            void load();
          }}
        />

        <PortForwardDialog context={context ?? ''} pod={forwarding} onClose={() => setForwarding(null)} />
        <ScanDialog image={canScan ? scanningImage : null} onClose={() => setScanningImage(null)} />

        <ConfirmDialog
          open={bulkDelete !== null}
          testId="bulk-delete-dialog"
          title={`Delete ${bulkDelete?.length ?? 0} ${kind.toLowerCase()}${(bulkDelete?.length ?? 0) === 1 ? '' : 's'}?`}
          body={<span className="font-mono text-[11.5px] break-words [overflow-wrap:anywhere]">{(bulkDelete ?? []).map((item) => item.metadata?.name).join(', ')}</span>}
          confirmLabel={`Delete ${bulkDelete?.length ?? 0}`}
          danger
          onClose={() => setBulkDelete(null)}
          onConfirm={() => {
            const chosen = bulkDelete ?? [];
            setBulkDelete(null);
            if (!context) return;
            void (async () => {
              let done = 0;
              for (const item of chosen) {
                try {
                  await api.remove(context, kind, item.metadata?.name ?? '', item.metadata?.namespace);
                  done += 1;
                } catch (cause) {
                  toast.error(`${item.metadata?.name ?? ''}: ${cause instanceof Error ? cause.message : String(cause)}`);
                }
              }
              toast.success(`Deleted ${done} of ${chosen.length}`);
            })();
          }}
        />

        <Modal
          open={bulkLabel !== null}
          onClose={() => setBulkLabel(null)}
          title={`Label ${bulkLabel?.length ?? 0} ${kind.toLowerCase()}${(bulkLabel?.length ?? 0) === 1 ? '' : 's'}`}
          description="key=value, merge-patched onto every selected object."
          guard={{ dirty: bulkLabelText !== '' }}
          testId="bulk-label-dialog"
          footer={
            <>
              <Button variant="ghost" onClick={() => setBulkLabel(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                data-testid="bulk-label-apply"
                disabled={!bulkLabelPair(bulkLabelText)}
                onClick={() => {
                  const pair = bulkLabelPair(bulkLabelText);
                  const chosen = bulkLabel ?? [];
                  setBulkLabel(null);
                  setBulkLabelText('');
                  if (!context || !pair) return;
                  void (async () => {
                    let done = 0;
                    for (const item of chosen) {
                      try {
                        await api.patch(context, kind, item.metadata?.name ?? '', { metadata: { labels: { [pair[0]]: pair[1] } } }, item.metadata?.namespace);
                        done += 1;
                      } catch (cause) {
                        toast.error(`${item.metadata?.name ?? ''}: ${cause instanceof Error ? cause.message : String(cause)}`);
                      }
                    }
                    toast.success(`Labelled ${done} of ${chosen.length}`);
                  })();
                }}
              >
                Apply
              </Button>
            </>
          }
        >
          <Field
            id="bulk-label"
            label="Label"
            mono
            value={bulkLabelText}
            onChange={(event) => setBulkLabelText(event.target.value)}
            placeholder="team=payments"
            data-testid="bulk-label-input"
            validate={(value) => {
              if (!value) return null;
              const index = value.indexOf('=');
              if (index === -1) return 'A label is key=value.';
              return labelKey(value.slice(0, index)) ?? labelValue(value.slice(index + 1));
            }}
          />
          <div className="pb-2" />
        </Modal>

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

        <AnimatePresence>
          {welcome ? (
            <Welcome
              settings={appSettings}
              clusters={clusters}
              onFinish={() => {
                setWelcome(false);
                void api.settings.get().then((response) => setAppSettings(response.settings)).catch(() => undefined);
              }}
              onOpenSettings={(section) => {
                setWelcome(false);
                setSettingsSection(section);
                setSelection({ kind: 'page', value: section === 'kubeconfig' ? 'settings' : 'app-settings' });
              }}
            />
          ) : null}
        </AnimatePresence>

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
  const liveOpen = useLiveState();
  const tint = module?.tint ?? 'var(--accent-base)';

  return (
    <header
      data-testid="title-bar"
      // The macOS traffic lights live in this strip; the left inset is theirs.
      className={`hero-band relative flex h-[46px] shrink-0 items-center gap-2 border-b border-line pr-3 ${IS_DESKTOP ? 'pl-[84px]' : 'pl-3'}`}
      style={{ WebkitAppRegion: 'drag', ['--hero-tint' as string]: tint, boxShadow: '0 1px 0 var(--highlight) inset, 0 1px 0 rgb(0 0 0 / 0.2)' } as React.CSSProperties}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px" style={{ background: `linear-gradient(90deg, transparent, color-mix(in oklab, ${tint} 55%, transparent) 30%, transparent 80%)` }} />

      <span className="flex items-center gap-2" data-testid="brand">
        <MarkTile size={26} />
        <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-primary">Mjolnir</span>
      </span>

      <span className="mx-1 text-[12px] text-tertiary">/</span>

      {module ? (
        <span className="flex h-[28px] items-center gap-1.5 rounded-full border border-line px-2.5 text-[12.5px] text-primary" data-testid="module-crumb" style={{ background: `color-mix(in oklab, ${tint} 10%, var(--surface-raised))`, borderColor: `color-mix(in oklab, ${tint} 30%, var(--border-default))`, boxShadow: '0 1px 0 var(--highlight) inset' }}>
          {module.icon ? <module.icon size={13} strokeWidth={2} style={{ color: tint }} /> : <span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: tint }} />}
          {module.label}
        </span>
      ) : (
        <span className="flex h-[28px] items-center rounded-full border border-line bg-raised px-2.5 text-[12.5px] text-primary" data-testid="module-crumb">Settings</span>
      )}

      {current !== undefined ? (
        <>
          <span className="text-[12px] text-tertiary">/</span>
          <span
            data-testid="connection-status"
            data-state={current ? 'connected' : 'disconnected'}
            className="flex h-[28px] items-center gap-2 rounded-full border border-line bg-raised pl-2 pr-2.5"
            style={{ boxShadow: '0 1px 0 var(--highlight) inset' }}
          >
            <span aria-hidden className={`glow-dot ${liveOpen ? 'breathe' : ''}`} style={{ ['--dot' as string]: liveOpen ? 'var(--status-ok)' : 'var(--status-warn)' }} />
            <span data-testid="cluster-name" className="font-mono text-[12.5px] text-primary">{current?.name ?? 'no cluster'}</span>
            {provider ? <span className="rounded-full bg-accent-subtle px-1.5 py-[1px] text-[10px] font-semibold tracking-wide text-accent">{provider}</span> : null}
            {current?.server ? <span className="hidden font-mono text-[11px] text-tertiary xl:inline">{current.server.replace(/^https?:\/\//, '')}</span> : null}
            <span className="text-[10px] font-semibold uppercase tracking-wide text-tertiary" data-testid="live-state">{liveOpen ? 'live' : 'reconnecting'}</span>
          </span>
        </>
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
        <button
          type="button"
          data-testid="assistant-open"
          onClick={onAssistant}
          className="lift flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] text-primary"
          style={{ background: 'linear-gradient(135deg, color-mix(in oklab, var(--accent-solid) 26%, var(--surface-raised)), color-mix(in oklab, var(--log-pod-b) 22%, var(--surface-raised)))', borderColor: 'color-mix(in oklab, var(--accent-base) 40%, var(--border-default))', boxShadow: '0 1px 0 rgb(255 255 255 / 0.12) inset, 0 4px 14px color-mix(in oklab, var(--accent-solid) 30%, transparent)' }}
        >
          <Sparkles size={13} strokeWidth={2} className="text-accent" aria-hidden />
          Assistant
        </button>
        <button
          type="button"
          data-testid="palette-open"
          onClick={onPalette}
          className="btn-secondary flex h-[30px] w-[220px] items-center gap-2 rounded-full border border-line px-3 text-[12.5px] text-tertiary transition-colors duration-100 hover:border-strong hover:text-secondary"
        >
          <Search size={13} strokeWidth={2} aria-hidden />
          <span className="flex-1 text-left">Search anything…</span>
          <kbd className="inline-flex items-center gap-[2px] rounded-md border border-line bg-sunken px-1.5 py-[1px] font-sans text-[10px] text-tertiary">
            <CommandIcon size={9} strokeWidth={2.2} aria-hidden />K
          </kbd>
        </button>
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

/** `key=value` split, validated. Null when it is not a label yet. */
function bulkLabelPair(text: string): [string, string] | null {
  const index = text.indexOf('=');
  if (index === -1) return null;
  const key = text.slice(0, index).trim();
  const value = text.slice(index + 1).trim();
  if (!key || labelKey(key) || labelValue(value)) return null;
  return [key, value];
}
