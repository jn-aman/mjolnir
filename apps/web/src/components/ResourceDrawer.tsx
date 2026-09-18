import { useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { LogViewer } from './LogViewer.tsx';
import { Sparkline } from './TimeSeries.tsx';
import { StatusChip } from './StatusChip.tsx';
import { Button } from './ui/Button.tsx';
import { age, podStatus, type KubeItem } from './columns.tsx';

/**
 * The detail panel.
 *
 * Slides in from the edge it belongs to — the container animates, its contents
 * do not. Everything about one object lives here rather than on a separate
 * route, because the list is the context: losing it to look at a pod and then
 * navigating back is the interaction this replaces.
 */

interface DrawerProps {
  readonly context: string;
  readonly kind: string;
  readonly item: KubeItem | null;
  readonly metrics?: { cpu: Array<{ t: number; v: number }>; memory: Array<{ t: number; v: number }> };
  readonly onClose: () => void;
}

interface PodShape extends KubeItem {
  spec?: { nodeName?: string; containers?: Array<{ name?: string; image?: string }>; serviceAccountName?: string };
  status?: {
    phase?: string;
    podIP?: string;
    qosClass?: string;
    containerStatuses?: Array<{
      name?: string;
      ready?: boolean;
      restartCount?: number;
      image?: string;
      state?: { waiting?: { reason?: string; message?: string }; running?: { startedAt?: string } };
      lastState?: { terminated?: { reason?: string; exitCode?: number; finishedAt?: string } };
    }>;
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
}

export function ResourceDrawer({ context, kind, item, metrics, onClose }: DrawerProps) {
  const [yaml, setYaml] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');

  const pod = item as PodShape | null;
  const isPod = kind === 'Pod';
  const name = item?.metadata?.name ?? '';
  const namespace = item?.metadata?.namespace ?? '';

  const containers =
    pod?.status?.containerStatuses?.map((status) => status.name ?? '').filter(Boolean) ??
    pod?.spec?.containers?.map((container) => container.name ?? '').filter(Boolean) ??
    [];

  useEffect(() => {
    setTab('overview');
    setYaml(null);
  }, [name, namespace]);

  useEffect(() => {
    if (tab !== 'yaml' || yaml !== null || !item) return;
    void (async () => {
      const object = await api.get(context, kind, name, namespace || undefined);
      setYaml(JSON.stringify(object, null, 2));
    })();
  }, [tab, yaml, item, context, kind, name, namespace]);

  // Escape closes, from anywhere inside. A panel you can only dismiss by
  // finding a small × is a panel people leave open.
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  const terminated = pod?.status?.containerStatuses?.find((s) => s.lastState?.terminated)?.lastState
    ?.terminated;

  return (
    <aside
      data-testid="resource-drawer"
      className="flex w-[min(640px,48vw)] min-w-[420px] shrink-0 flex-col border-l border-line bg-ground"
      style={{ animation: 'mjolnir-drawer-in 260ms cubic-bezier(0.16, 1, 0.3, 1)' }}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-line bg-raised px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-xs bg-accent-subtle px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-accent">
              {kind}
            </span>
            {isPod && pod ? <StatusChip status={podStatus(pod as never)} /> : null}
          </div>
          <h2 data-testid="drawer-name" className="truncate font-mono text-[14px] text-primary">
            {name}
          </h2>
          {namespace ? (
            <p className="truncate text-[11.5px] text-tertiary">{namespace}</p>
          ) : null}
        </div>
        <Button iconOnly aria-label="Close" variant="ghost" onClick={onClose} icon={<X size={15} strokeWidth={2} />} />
      </header>

      <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex shrink-0 gap-0 border-b border-line bg-raised px-2">
          {[
            { id: 'overview', label: 'Overview' },
            ...(isPod ? [{ id: 'logs', label: 'Logs' }] : []),
            { id: 'yaml', label: 'YAML' },
          ].map((entry) => (
            <Tabs.Trigger
              key={entry.id}
              value={entry.id}
              data-testid={`tab-${entry.id}`}
              className="relative px-3 py-2 text-[12.5px] font-medium text-secondary outline-none data-[state=active]:text-primary"
              style={{ transitionProperty: 'color', transitionDuration: '90ms' }}
            >
              {entry.label}
              {tab === entry.id ? (
                <span
                  aria-hidden
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent"
                  style={{ animation: 'mjolnir-tab-in 180ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                />
              ) : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="overview" className="min-h-0 flex-1 overflow-auto p-4 outline-none">
          {terminated ? (
            <div className="mb-4 rounded-lg border border-[var(--status-error-border)] bg-error-bg p-3">
              <div className="mb-1 text-[12.5px] font-semibold text-error">
                Last exit: {terminated.reason} (code {terminated.exitCode})
              </div>
              <div className="text-[12px] text-[var(--text-secondary)]">
                {terminated.reason === 'OOMKilled'
                  ? 'The container exceeded its memory limit and was killed. Raise the limit or reduce what it holds.'
                  : 'The container exited. Its previous logs are under the Logs tab.'}
              </div>
            </div>
          ) : null}

          {metrics && (metrics.cpu.length > 0 || metrics.memory.length > 0) ? (
            <div className="mb-4 grid grid-cols-2 gap-3">
              <MetricTile
                label="CPU"
                value={`${((metrics.cpu.at(-1)?.v ?? 0) * 1000).toFixed(0)}m`}
                points={metrics.cpu}
                tone="var(--series-1)"
              />
              <MetricTile
                label="Memory"
                value={`${((metrics.memory.at(-1)?.v ?? 0) / (1024 * 1024)).toFixed(0)} MiB`}
                points={metrics.memory}
                tone="var(--series-3)"
              />
            </div>
          ) : null}

          <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2 text-[12.5px]">
            <Row label="Age" value={age(item.metadata?.creationTimestamp)} />
            {isPod ? (
              <>
                <Row label="Node" value={pod?.spec?.nodeName ?? '—'} mono />
                <Row label="Pod IP" value={pod?.status?.podIP ?? '—'} mono />
                <Row label="QoS" value={pod?.status?.qosClass ?? '—'} />
                <Row label="Service account" value={pod?.spec?.serviceAccountName ?? '—'} mono />
              </>
            ) : null}
          </dl>

          {isPod && pod?.status?.containerStatuses?.length ? (
            <div className="mt-5">
              <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-tertiary">
                Containers
              </h3>
              <div className="space-y-2">
                {pod.status.containerStatuses.map((status) => (
                  <div key={status.name} className="rounded-md border border-line bg-raised p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-[12.5px] text-primary">{status.name}</span>
                      <StatusChip
                        status={status.state?.waiting?.reason ?? (status.ready ? 'Running' : 'NotReady')}
                      />
                      {(status.restartCount ?? 0) > 0 ? (
                        <span className="font-mono text-[11px] text-warn">
                          {status.restartCount} restarts
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate font-mono text-[11px] text-tertiary">{status.image}</div>
                    {status.state?.waiting?.message ? (
                      <div className="mt-1.5 text-[11.5px] text-secondary">
                        {status.state.waiting.message}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Tabs.Content>

        {isPod ? (
          <Tabs.Content value="logs" className="flex min-h-0 flex-1 flex-col outline-none">
            {tab === 'logs' ? (
              <LogViewer
                context={context}
                namespace={namespace}
                pod={name}
                containers={containers}
              />
            ) : null}
          </Tabs.Content>
        ) : null}

        <Tabs.Content value="yaml" className="min-h-0 flex-1 overflow-auto outline-none">
          <pre
            data-testid="yaml-editor"
            className="m-0 whitespace-pre-wrap break-words bg-sunken p-4 font-mono text-[12px] leading-[19px] text-[var(--log-body)]"
          >
            {yaml ?? 'Loading…'}
          </pre>
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-tertiary">{label}</dt>
      <dd className={`m-0 truncate text-primary ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</dd>
    </>
  );
}

function MetricTile({
  label,
  value,
  points,
  tone,
}: {
  label: string;
  value: string;
  points: Array<{ t: number; v: number }>;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-raised p-3">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-tertiary">
        {label}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="font-mono text-[19px] leading-none tabular-nums text-primary">{value}</span>
        <Sparkline points={points} tone={tone} width={92} height={24} />
      </div>
    </div>
  );
}
