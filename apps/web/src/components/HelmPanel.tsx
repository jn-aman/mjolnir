import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import * as Tabs from '@radix-ui/react-tabs';
import { Package, RefreshCw, Search, X } from 'lucide-react';
import { stringify } from 'yaml';
import { api, type HelmReleaseFull, type HelmReleaseSummary } from '../lib/api.ts';
import { ResizeHandle, useResizable } from '../lib/useResizable.tsx';
import { formatDateTime } from '../lib/time.ts';
import { ResourceList } from './ResourceList.tsx';
import type { KubeItem } from './columns.tsx';
import { StatusChip } from './StatusChip.tsx';
import { YamlEditor } from './YamlEditor.tsx';
import { Field } from './ui/Field.tsx';
import { Button } from './ui/Button.tsx';
import { askEntry, copyEntry, Menu, SEPARATOR, type MenuEntry } from './ui/ContextMenu.tsx';
import { LoadingState } from './ui/States.tsx';

/**
 * Helm, read from the cluster.
 *
 * Every release Helm 3 installed left its revisions as Secrets, and this page
 * decodes them: the list is `helm list`, the drawer is `helm get all` and
 * `helm history`. Upgrades and rollbacks need the Helm engine and arrive
 * with it; until then the exact commands are one right-click away.
 */
interface HelmPanelProps {
  readonly context: string;
  readonly namespace?: string | undefined;
  readonly onNavigate: (target: { kind: string; name?: string; namespace?: string }) => void;
}

const STATUS_TONE = (status: string) => (status === 'deployed' ? 'ok' : status === 'failed' ? 'error' : status === 'superseded' || status === 'uninstalled' ? 'neutral' : 'warn');

function toItem(r: HelmReleaseSummary): KubeItem {
  return {
    metadata: { name: r.name, namespace: r.namespace, ...(r.lastDeployed ? { creationTimestamp: r.lastDeployed } : {}) },
    spec: { chart: r.chart, revision: r.revision },
    status: { status: r.status, description: r.description },
  } as KubeItem;
}

export function HelmPanel({ context, namespace, onNavigate }: HelmPanelProps) {
  const [releases, setReleases] = useState<HelmReleaseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<HelmReleaseSummary | null>(null);

  const load = useCallback(async () => {
    try {
      setReleases((await api.helm.releases(context, namespace)).releases);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [context, namespace]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const items = useMemo(() => releases.map(toItem), [releases]);
  const byKey = useMemo(() => new Map(releases.map((r) => [`${r.namespace}/${r.name}`, r])), [releases]);
  const menuFor = (r: HelmReleaseSummary): MenuEntry[] => [
    { id: 'open', label: 'Open release', onSelect: () => setSelected(r) },
    askEntry('Ask the assistant about this release', `Helm release ${r.name} in namespace ${r.namespace} (chart ${r.chart.name}-${r.chart.version}, status ${r.status}, revision ${r.revision}): use get_helm_release and tell me what it deploys, whether it is healthy, and what its values change from the defaults.`),
    SEPARATOR,
    ...copyEntry('copy-values', 'Copy: helm get values', `helm -n ${r.namespace} get values ${r.name}`),
    ...copyEntry('copy-history', 'Copy: helm history', `helm -n ${r.namespace} history ${r.name}`),
    ...copyEntry('copy-rollback', 'Copy: helm rollback to previous', `helm -n ${r.namespace} rollback ${r.name} ${Math.max(1, r.revision - 1)}`),
    ...copyEntry('copy-uninstall', 'Copy: helm uninstall', `helm -n ${r.namespace} uninstall ${r.name}`),
    SEPARATOR,
    { id: 'secret', label: 'Open the release Secret', onSelect: () => onNavigate({ kind: 'Secret', name: r.secret, namespace: r.namespace }) },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="helm-panel">
      <div className="flex h-[50px] shrink-0 items-center gap-2 border-b border-line bg-raised px-3.5">
        <Package size={14} strokeWidth={1.9} aria-hidden style={{ color: 'var(--series-1)' }} />
        <span className="text-[13px] font-semibold text-primary">Helm releases</span>
        <span className="text-[11.5px] text-tertiary">{releases.length} in {namespace || 'all namespaces'}, read from their Secrets</span>
        <Field id="helm-filter" label="Filter releases" hideLabel mono value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter releases" className="ml-2 w-[260px] min-w-[160px] shrink" leading={<Search size={13} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />} />
        <div className="flex-1" />
        <Button iconOnly variant="ghost" aria-label="Refresh" onClick={() => void load()} icon={<RefreshCw size={13} strokeWidth={2} />} />
      </div>
      {error ? <div className="border-b border-[var(--status-error-border)] bg-error-bg px-3 py-2 text-[12.5px] text-error">{error}</div> : null}
      <div className="relative flex min-h-0 flex-1">
        <ResourceList
          kind="HelmRelease"
          label="Helm releases"
          items={items}
          state="synced"
          error={null}
          filter={filter}
          selectedName={selected?.name}
          menu={(item) => {
            const r = byKey.get(`${item.metadata?.namespace ?? ''}/${item.metadata?.name ?? ''}`);
            return r ? menuFor(r) : [];
          }}
          onSelect={(item) => setSelected(byKey.get(`${item.metadata?.namespace ?? ''}/${item.metadata?.name ?? ''}`) ?? null)}
        />
        <AnimatePresence>
          {selected ? <HelmDrawer key="helm-drawer" context={context} summary={selected} onClose={() => setSelected(null)} menu={menuFor} /> : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function HelmDrawer({ context, summary, onClose, menu }: { context: string; summary: HelmReleaseSummary; onClose: () => void; menu: (r: HelmReleaseSummary) => MenuEntry[] }) {
  const size = useResizable({ key: 'helm-drawer', initial: 720, min: 420, max: 1200, direction: 'left' });
  const [tab, setTab] = useState('overview');
  const [revision, setRevision] = useState<number | undefined>(undefined);
  const [data, setData] = useState<{ release: HelmReleaseFull; history: HelmReleaseSummary[] } | null>(null);
  useEffect(() => {
    setData(null);
    void api.helm.release(context, summary.namespace, summary.name, revision).then(setData).catch(() => setData(null));
  }, [context, summary, revision]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const release = data?.release;

  return (
    <motion.aside
      data-testid="helm-drawer"
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className="absolute inset-y-0 right-0 z-20 flex max-w-[calc(100%-120px)] flex-col border-l border-line bg-ground shadow-[var(--shadow-lg)]"
      style={{ width: size.width }}
    >
      <ResizeHandle side="left" label="Resize details panel" dragging={size.dragging} onPointerDown={size.onPointerDown} />
      <header className="shrink-0 border-b border-line bg-raised px-4 pb-3 pt-3">
        <Menu label={summary.name} entries={menu(summary)} testId="drawer-menu">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-xs bg-accent-subtle px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-accent">Helm release</span>
                <StatusChip status={summary.status} tone={STATUS_TONE(summary.status)} />
                <span className="text-[11px] text-tertiary">revision {revision ?? summary.revision}</span>
              </div>
              <h2 data-testid="drawer-name" className="break-words [overflow-wrap:anywhere] font-mono text-[14px] text-primary">{summary.name}</h2>
              <p className="break-words [overflow-wrap:anywhere] text-[11.5px] text-tertiary">{summary.namespace} · {summary.chart.name}-{summary.chart.version}{summary.chart.appVersion ? ` · app ${summary.chart.appVersion}` : ''}</p>
            </div>
            <Button iconOnly aria-label="Close" variant="ghost" onClick={onClose} icon={<X size={15} strokeWidth={2} />} />
          </div>
        </Menu>
      </header>
      <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex shrink-0 gap-1 border-b border-line bg-raised px-3">
          {(['overview', 'values', 'manifest', 'history'] as const).map((id) => (
            <Tabs.Trigger key={id} value={id} data-testid={`tab-${id}`} className="relative px-2 py-2 text-[12.5px] capitalize text-secondary outline-none data-[state=active]:text-primary">
              {id}
              {tab === id ? <motion.span layoutId="helm-drawer-tab" className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-accent" /> : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview" className="min-h-0 flex-1 overflow-y-auto p-4 outline-none">
          {release ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                <dt className="text-secondary">Chart</dt><dd className="m-0 font-mono text-primary">{release.chart.name}-{release.chart.version}</dd>
                <dt className="text-secondary">App version</dt><dd className="m-0 font-mono text-primary">{release.chart.appVersion ?? '-'}</dd>
                <dt className="text-secondary">First deployed</dt><dd className="m-0 font-mono text-primary">{release.firstDeployed ? formatDateTime(release.firstDeployed) : '-'}</dd>
                <dt className="text-secondary">Last deployed</dt><dd className="m-0 font-mono text-primary">{release.lastDeployed ? formatDateTime(release.lastDeployed) : '-'}</dd>
                <dt className="text-secondary">Description</dt><dd className="m-0 text-primary">{release.description ?? '-'}</dd>
                <dt className="text-secondary">Secret</dt><dd className="m-0 font-mono text-primary">{release.secret}</dd>
              </dl>
              {release.notes ? (
                <div>
                  <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">Notes</div>
                  <pre className="whitespace-pre-wrap rounded-lg border border-line bg-raised p-3 font-mono text-[11.5px] leading-[17px] text-secondary" data-testid="helm-notes">{release.notes}</pre>
                </div>
              ) : null}
            </div>
          ) : <LoadingState title="Reading release history" rows={4} />}
        </Tabs.Content>
        <Tabs.Content value="values" className="flex min-h-0 flex-1 flex-col outline-none">
          {release ? <YamlEditor key={`${summary.name}:${release.revision}:values`} value={Object.keys(release.values).length ? stringify(release.values, { lineWidth: 0 }) : '# no user-supplied values; the chart defaults apply\n'} /> : null}
        </Tabs.Content>
        <Tabs.Content value="manifest" className="flex min-h-0 flex-1 flex-col outline-none">
          {release ? <YamlEditor key={`${summary.name}:${release.revision}:manifest`} value={release.manifest || '# empty manifest\n'} /> : null}
        </Tabs.Content>
        <Tabs.Content value="history" className="min-h-0 flex-1 overflow-y-auto p-4 outline-none">
          <div className="space-y-1.5" data-testid="helm-history">
            {(data?.history ?? []).map((h) => (
              <button
                key={h.revision}
                type="button"
                onClick={() => setRevision(h.revision)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-100 ${(revision ?? summary.revision) === h.revision ? 'border-strong bg-pressed' : 'border-line bg-raised hover:border-strong'}`}
              >
                <span className="w-[36px] font-mono text-[12.5px] text-primary">v{h.revision}</span>
                <StatusChip status={h.status} tone={STATUS_TONE(h.status)} />
                <span className="font-mono text-[12px] text-secondary">{h.chart.name}-{h.chart.version}</span>
                <span className="text-[11.5px] text-tertiary">{h.description ?? ''}</span>
                <div className="flex-1" />
                <span className="font-mono text-[11px] text-tertiary">{h.lastDeployed ? formatDateTime(h.lastDeployed) : ''}</span>
              </button>
            ))}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </motion.aside>
  );
}
