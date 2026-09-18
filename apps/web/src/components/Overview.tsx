import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatCpu, formatMemory, type MetricsResponse } from '../lib/metrics.ts';
import { parseCpu, parseMemory } from '@mjolnir/schemas';
import { TimeSeries } from './TimeSeries.tsx';
import { Card, Stat } from './ui/Card.tsx';
import { ResizeHandle, useResizable } from '../lib/useResizable.tsx';
import { Button } from './ui/Button.tsx';
import { askEntry, copyEntry, Menu, type MenuEntry } from './ui/ContextMenu.tsx';
import { StatusChip, toneFor } from './StatusChip.tsx';
import { age, podStatus, type KubeItem } from './columns.tsx';

/**
 * The cluster at a glance.
 *
 * CPU and memory are **two charts, never one with two y-axes**. A dual-axis
 * chart lets any pair of series be made to look correlated by choosing the
 * scales, which is the single most common way a chart misleads, and on an
 * infrastructure dashboard people make capacity decisions from it.
 */

export interface NavigateTarget {
  readonly kind: string;
  readonly name?: string;
  readonly namespace?: string;
  readonly filter?: string;
  /** Set when the target is a workspace rather than a kind. */
  readonly workspace?: string;
}

interface OverviewProps {
  readonly context: string;
  /**
   * Opens the thing that was clicked.
   *
   * Every number, line and row on this screen is about a specific object, so
   * every one of them is a link to it. A dashboard that shows you a problem and
   * then makes you go find it by hand is doing half its job.
   */
  readonly onNavigate: (target: NavigateTarget) => void;
}

export function Overview({ context, onNavigate }: OverviewProps) {
  const [nodeMetrics, setNodeMetrics] = useState<MetricsResponse | null>(null);
  const [pods, setPods] = useState<KubeItem[]>([]);
  const [nodes, setNodes] = useState<KubeItem[]>([]);
  const [events, setEvents] = useState<KubeItem[]>([]);
  const [ready, setReady] = useState(false);
  // The charts/lists split is the user's. Stored like every other edge.
  const split = useResizable({ key: 'overview-split', initial: 640, min: 360, max: 1100, direction: 'right' });

  useEffect(() => {
    let cancelled = false;
    setReady(false);

    const load = async () => {
      const [metricsResponse, podList, nodeList, eventList] = await Promise.all([
        fetch(`/api/metrics/${encodeURIComponent(context)}/nodes`).then(
          (response) => response.json() as Promise<MetricsResponse>,
        ),
        api.list<KubeItem>(context, 'Pod'),
        api.list<KubeItem>(context, 'Node'),
        api.list<KubeItem>(context, 'Event'),
      ]);
      if (cancelled) return;
      setNodeMetrics(metricsResponse);
      setPods(podList.items);
      setNodes(nodeList.items);
      setEvents(eventList.items);
      // A watch reports "connecting" before its first sync. Rendering that as
      // zero tells someone their cluster is empty when it is not, the same
      // lie the resource list was careful to avoid, missed here.
      if (podList.state === 'synced') setReady(true);
    };

    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [context]);

  const health = useMemo(() => {
    const tally = { ok: 0, warn: 0, error: 0 };
    for (const pod of pods) {
      const tone = toneFor(podStatus(pod as never));
      if (tone === 'ok') tally.ok += 1;
      else if (tone === 'error') tally.error += 1;
      else if (tone === 'warn') tally.warn += 1;
    }
    return tally;
  }, [pods]);

  const cpuSeries = useMemo(
    () =>
      (nodeMetrics?.series ?? []).map((entry) => ({
        name: entry.name,
        points: entry.points.map((point) => ({ t: point.t, v: point.cpu })),
      })),
    [nodeMetrics],
  );

  const memorySeries = useMemo(
    () =>
      (nodeMetrics?.series ?? []).map((entry) => ({
        name: entry.name,
        points: entry.points.map((point) => ({ t: point.t, v: point.memory })),
      })),
    [nodeMetrics],
  );

  const troubled = useMemo(
    () => pods.filter((pod) => toneFor(podStatus(pod as never)) !== 'ok').slice(0, 6),
    [pods],
  );

  const warnings = useMemo(
    () =>
      events
        .filter((event) => (event as { type?: string }).type === 'Warning')
        .slice(0, 6),
    [events],
  );

  /**
   * Shaded periods on the charts, taken from warning events.
   *
   * Derived from what the cluster actually reported, never from a threshold we
   * picked, a band that says "incident" has to correspond to something a human
   * can go and read.
   */
  const bands = useMemo(() => {
    const first = nodeMetrics?.series[0]?.points[0]?.t ?? 0;
    return warnings
      .map((event) => {
        const at = (event as { lastTimestamp?: string }).lastTimestamp;
        const reason = (event as { reason?: string }).reason ?? 'Warning';
        if (!at) return null;
        const t = new Date(at).getTime();
        if (!Number.isFinite(t) || t < first) return null;
        return { from: t - 60_000, to: t + 60_000, label: reason };
      })
      .filter((band): band is { from: number; to: number; label: string } => band !== null)
      .slice(0, 2);
  }, [warnings, nodeMetrics]);

  const capacity = useMemo(() => {
    let cpuAlloc = 0;
    let memAlloc = 0;
    for (const node of nodes) {
      const alloc = (node as { status?: { allocatable?: Record<string, string> } }).status?.allocatable;
      cpuAlloc += parseCpu(alloc?.['cpu']) ?? 0;
      memAlloc += parseMemory(alloc?.['memory']) ?? 0;
    }
    let cpuReq = 0;
    let memReq = 0;
    let cpuLim = 0;
    let memLim = 0;
    for (const pod of pods) {
      const containers =
        (pod as { spec?: { containers?: Array<{ resources?: { requests?: Record<string, string>; limits?: Record<string, string> } }> } })
          .spec?.containers ?? [];
      for (const container of containers) {
        cpuReq += parseCpu(container.resources?.requests?.['cpu']) ?? 0;
        memReq += parseMemory(container.resources?.requests?.['memory']) ?? 0;
        cpuLim += parseCpu(container.resources?.limits?.['cpu']) ?? 0;
        memLim += parseMemory(container.resources?.limits?.['memory']) ?? 0;
      }
    }
    return { cpuAlloc, memAlloc, cpuReq, memReq, cpuLim, memLim };
  }, [nodes, pods]);

  const byStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pod of pods) {
      const status = podStatus(pod as never);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [pods]);

  const totalCpu = nodeMetrics?.series.reduce((sum, s) => sum + (s.cpuCapacity ?? 0), 0) ?? 0;
  const usedCpu = nodeMetrics?.series.reduce((sum, s) => sum + (s.points.at(-1)?.cpu ?? 0), 0) ?? 0;

  return (
    <div data-testid="overview" className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mb-4 grid grid-cols-4 gap-3">
        <Menu label="Pods" entries={[{ id: 'open', label: 'Open pods', onSelect: () => onNavigate({ kind: 'Pod' }) }, ...copyEntry('copy', 'Copy value', String(pods.length))]} testId="stat-menu">
        <div className="min-w-0">
        <Stat
          label="Pods"
          loading={!ready}
          value={String(pods.length)}
          hint={`${health.ok} running`}
          onClick={() => onNavigate({ kind: 'Pod' })}
        />
        </div>
        </Menu>
        <Menu label="Not running" entries={[{ id: 'open', label: 'Open pods', onSelect: () => onNavigate({ kind: 'Pod' }) }, askEntry('Ask why these are not running', 'Which pods are not running in this cluster, why, and what should I do about each? Use whats_wrong first.'), ...copyEntry('copy', 'Copy value', String(health.error + health.warn))]} testId="stat-menu">
        <div className="min-w-0">
        <Stat
          label="Not running"
          loading={!ready}
          value={String(health.error + health.warn)}
          tone={health.error > 0 ? 'error' : health.warn > 0 ? 'warn' : 'default'}
          hint={health.error > 0 ? `${health.error} failing` : 'nothing failing'}
          // Opens the pod list already filtered to the thing the number counts.
          onClick={() =>
            onNavigate({
              kind: 'Pod',
              ...(troubled[0]?.metadata?.name ? { name: troubled[0].metadata.name } : {}),
            })
          }
        />
        </div>
        </Menu>
        <Menu label="Nodes" entries={[{ id: 'open', label: 'Open nodes', onSelect: () => onNavigate({ kind: 'Node' }) }, ...copyEntry('copy', 'Copy value', String(nodes.length))]} testId="stat-menu">
        <div className="min-w-0">
        <Stat
          label="Nodes"
          loading={!ready}
          value={String(nodes.length)}
          hint={`${formatCpu(totalCpu)} cores`}
          onClick={() => onNavigate({ kind: 'Node' })}
        />
        </div>
        </Menu>
        <Menu label="CPU in use" entries={[{ id: 'open', label: 'Open nodes', onSelect: () => onNavigate({ kind: 'Node' }) }, ...copyEntry('copy', 'Copy value', totalCpu > 0 ? `${Math.round((usedCpu / totalCpu) * 100)}%` : '-')]} testId="stat-menu">
        <div className="min-w-0">
        <Stat
          label="CPU in use"
          loading={!ready}
          value={totalCpu > 0 ? `${Math.round((usedCpu / totalCpu) * 100)}%` : '-'}
          hint={`${formatCpu(usedCpu)} of ${formatCpu(totalCpu)}`}
          onClick={() => onNavigate({ kind: 'Node' })}
        />
        </div>
        </Menu>
      </div>

      <div className="mb-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <Card title="Capacity" subtitle="requests and limits against what nodes can schedule">
          <div className="space-y-3">
            <CapacityBar
              onOpen={() => onNavigate({ kind: 'Node' })}
              label="CPU"
              request={capacity.cpuReq}
              limit={capacity.cpuLim}
              total={capacity.cpuAlloc}
              format={formatCores}
            />
            <CapacityBar
              onOpen={() => onNavigate({ kind: 'Node' })}
              label="Memory"
              request={capacity.memReq}
              limit={capacity.memLim}
              total={capacity.memAlloc}
              format={formatMemory}
            />
          </div>
        </Card>

        <Card title="Pods by status" subtitle={`${pods.length} total`}>
          {pods.length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-tertiary">{ready ? 'No pods.' : 'Connecting…'}</p>
          ) : (
            <StatusBreakdown entries={byStatus} total={pods.length} onPick={(status) => onNavigate({ kind: 'Pod', filter: status })} />
          )}
        </Card>
      </div>

      <div className="relative mb-4 flex gap-3">
        <div className="relative shrink-0" style={{ width: split.width }}>
        <Card title="CPU by node" subtitle="last hour, cores" className="h-full">
          {nodeMetrics?.available ? (
            <TimeSeries
              series={cpuSeries}
              format={formatCpu}
              bands={bands}
              ariaLabel="CPU usage per node over the last hour"
              onSelect={(name) => onNavigate({ kind: 'Node', name })}
            />
          ) : (
            <Unavailable reason={nodeMetrics?.reason} />
          )}
        </Card>
        <ResizeHandle side="right" label="Resize charts" dragging={split.dragging} onPointerDown={split.onPointerDown} />
        </div>

        {/* Deliberately a second chart rather than a second axis on the first. */}
        <Card title="Memory by node" subtitle="last hour" className="min-w-0 flex-1">
          {nodeMetrics?.available ? (
            <TimeSeries
              series={memorySeries}
              format={formatMemory}
              bands={bands}
              ariaLabel="Memory usage per node over the last hour"
              onSelect={(name) => onNavigate({ kind: 'Node', name })}
            />
          ) : (
            <Unavailable reason={nodeMetrics?.reason} />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card
          title="Needs attention"
          subtitle={
            !ready ? 'checking…' : troubled.length === 0 ? 'everything is running' : `${troubled.length} workloads`
          }
          actions={
            <Button variant="ghost" onClick={() => onNavigate({ kind: 'Pod' })} icon={<ArrowRight size={13} />}>
              All pods
            </Button>
          }
        >
          {!ready ? (
            <p className="py-6 text-center text-[12.5px] text-tertiary">Connecting to the cluster…</p>
          ) : troubled.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-tertiary">
              Nothing is failing or pending.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {troubled.map((pod) => (
                <li key={pod.metadata?.name}>
                  <button
                    type="button"
                    data-testid="attention-item"
                    onClick={() =>
                      onNavigate({
                        kind: 'Pod',
                        ...(pod.metadata?.name ? { name: pod.metadata.name } : {}),
                        ...(pod.metadata?.namespace ? { namespace: pod.metadata.namespace } : {}),
                      })
                    }
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
                    style={{ transitionProperty: 'background-color', transitionDuration: '90ms' }}
                  >
                    <StatusChip status={podStatus(pod as never)} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-primary">
                      {pod.metadata?.name}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-tertiary">
                      {pod.metadata?.namespace}
                    </span>
                    <ArrowRight size={13} aria-hidden className="shrink-0 text-tertiary" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent warnings" subtitle={`${warnings.length} events`}>
          {warnings.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-tertiary">No warning events.</p>
          ) : (
            <ul className="space-y-2">
              {warnings.map((event) => {
                const wire = event as {
                  reason?: string;
                  message?: string;
                  count?: number;
                  lastTimestamp?: string;
                  involvedObject?: { name?: string };
                };
                return (
                  <li key={event.metadata?.name}>
                    <button
                      type="button"
                      data-testid="warning-item"
                      onClick={() =>
                        onNavigate({
                          kind: 'Pod',
                          ...(wire.involvedObject?.name ? { name: wire.involvedObject.name } : {}),
                          ...(event.metadata?.namespace ? { namespace: event.metadata.namespace } : {}),
                        })
                      }
                      className="w-full border-l-2 border-[var(--status-warn)] pl-3 text-left hover:bg-hover"
                      style={{ transitionProperty: 'background-color', transitionDuration: '90ms' }}
                    >
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12px] font-medium text-warn">{wire.reason}</span>
                      <span className="font-mono text-[11px] text-tertiary">
                        {wire.involvedObject?.name}
                      </span>
                      <div className="flex-1" />
                      <span className="shrink-0 font-mono text-[10.5px] text-tertiary">
                        {wire.count && wire.count > 1 ? `×${wire.count} · ` : ''}
                        {age(wire.lastTimestamp)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-[17px] text-secondary">
                      {wire.message}
                    </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Unavailable({ reason }: { reason?: string | undefined }) {
  return (
    <div className="flex h-[168px] flex-col items-center justify-center gap-1 text-center">
      <p className="text-[12.5px] text-secondary">Metrics are not available.</p>
      <p className="max-w-[280px] text-[11.5px] text-tertiary">
        {reason ?? 'Install metrics-server in this cluster to see CPU and memory.'}
      </p>
    </div>
  );
}

/**
 * Requests and limits drawn against allocatable.
 *
 * Two marks on one bar: a solid fill for what is requested, the number the
 * scheduler refuses on, and a hairline for the sum of limits, which can
 * legitimately exceed 100% and usually does. Reading them together is how you
 * tell "nothing more will schedule" from "everything is over-committed".
 */
/** "0.9 cores", "10 cores": the unit in words, because "900m of 10" is not a sentence. */
function formatCores(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 100) / 100;
  return `${rounded} ${rounded === 1 ? 'core' : 'cores'}`;
}

function CapacityBar({
  label,
  request,
  limit,
  total,
  format,
  onOpen,
}: {
  label: string;
  request: number;
  limit: number;
  total: number;
  format: (value: number) => string;
  onOpen: () => void;
}) {
  const pct = total > 0 ? (request / total) * 100 : 0;
  const limitPct = total > 0 ? (limit / total) * 100 : 0;
  const tone = pct > 90 ? 'var(--status-error)' : pct > 75 ? 'var(--status-warn)' : 'var(--series-1)';
  const summary = `${format(request)} of ${format(total)} requested (${Math.round(pct)}%)`;
  const limits =
    limit > 0
      ? `Limits add up to ${format(limit)}, ${Math.round(limitPct)}% of capacity${limit > total ? ': over-committed, pods can be throttled or evicted under load' : ''}`
      : 'No limits set';
  const barMenu: MenuEntry[] = [
    { id: 'open', label: 'Open nodes', onSelect: onOpen },
    ...copyEntry('copy', 'Copy summary', `${label}: ${summary}. ${limits}.`),
  ];
  return (
    <Menu label={label} entries={barMenu} testId="capacity-menu">
    <div data-testid={`capacity-${label.toLowerCase()}`}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="font-medium text-primary">{label}</span>
        <span className="font-mono tabular-nums text-secondary">{summary}</span>
      </div>
      <div
        className="relative h-[10px] overflow-hidden rounded-full border border-[var(--border-default)] bg-sunken"
        role="img"
        aria-label={`${label}: ${summary}. ${limits}.`}
        title={`${summary}. ${limits}.`}
      >
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.min(100, pct)}%`, background: tone }} />
        {limit > 0 ? (
          <div
            aria-hidden
            className="absolute top-0 h-full w-[2px] bg-[var(--text-primary)]"
            style={{ left: `calc(${Math.min(100, limitPct)}% - 1px)` }}
          />
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-tertiary">
        {limit > 0 ? <span aria-hidden className="inline-block h-[8px] w-[2px] bg-[var(--text-primary)]" /> : null}
        <span className={limit > total ? 'text-warn' : ''}>{limits}</span>
      </div>
    </div>
    </Menu>
  );
}

/** One stacked bar plus a row per status, each a link into the filtered list. */
function StatusBreakdown({
  entries,
  total,
  onPick,
}: {
  entries: Array<[string, number]>;
  total: number;
  onPick: (status: string) => void;
}) {
  const toneOf = (status: string) => {
    const tone = toneFor(status);
    return tone === 'ok'
      ? 'var(--status-ok)'
      : tone === 'error'
        ? 'var(--status-error)'
        : tone === 'warn'
          ? 'var(--status-warn)'
          : 'var(--text-tertiary)';
  };
  return (
    <div>
      <div className="mb-3 flex h-[10px] gap-[2px] overflow-hidden rounded-full">
        {entries.map(([status, count]) => (
          <div
            key={status}
            title={`${status}: ${count}`}
            style={{ width: `${(count / total) * 100}%`, background: toneOf(status) }}
          />
        ))}
      </div>
      <ul className="space-y-1">
        {entries.map(([status, count]) => (
          <li key={status}>
            <button
              type="button"
              onClick={() => onPick(status)}
              className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors duration-100 hover:bg-hover"
            >
              <span aria-hidden className="h-[8px] w-[8px] rounded-full" style={{ background: toneOf(status) }} />
              <span className="flex-1 text-[12.5px] text-primary">{status}</span>
              <span className="font-mono text-[12px] tabular-nums text-secondary">{count}</span>
              <span className="w-[38px] text-right font-mono text-[10.5px] tabular-nums text-tertiary">
                {Math.round((count / total) * 100)}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
