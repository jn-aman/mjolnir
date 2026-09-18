import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatCpu, formatMemory, type MetricsResponse } from '../lib/metrics.ts';
import { TimeSeries } from './TimeSeries.tsx';
import { Card, Stat } from './ui/Card.tsx';
import { Button } from './ui/Button.tsx';
import { StatusChip, toneFor } from './StatusChip.tsx';
import { age, podStatus, type KubeItem } from './columns.tsx';

/**
 * The cluster at a glance.
 *
 * CPU and memory are **two charts, never one with two y-axes**. A dual-axis
 * chart lets any pair of series be made to look correlated by choosing the
 * scales, which is the single most common way a chart misleads — and on an
 * infrastructure dashboard people make capacity decisions from it.
 */

interface OverviewProps {
  readonly context: string;
  readonly onOpenResources: () => void;
}

export function Overview({ context, onOpenResources }: OverviewProps) {
  const [nodeMetrics, setNodeMetrics] = useState<MetricsResponse | null>(null);
  const [pods, setPods] = useState<KubeItem[]>([]);
  const [nodes, setNodes] = useState<KubeItem[]>([]);
  const [events, setEvents] = useState<KubeItem[]>([]);

  useEffect(() => {
    let cancelled = false;

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

  const totalCpu = nodeMetrics?.series.reduce((sum, s) => sum + (s.cpuCapacity ?? 0), 0) ?? 0;
  const usedCpu = nodeMetrics?.series.reduce((sum, s) => sum + (s.points.at(-1)?.cpu ?? 0), 0) ?? 0;

  return (
    <div data-testid="overview" className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mb-4 grid grid-cols-4 gap-3">
        <Stat label="Pods" value={String(pods.length)} hint={`${health.ok} running`} />
        <Stat
          label="Not running"
          value={String(health.error + health.warn)}
          tone={health.error > 0 ? 'error' : health.warn > 0 ? 'warn' : 'default'}
          hint={health.error > 0 ? `${health.error} failing` : 'nothing failing'}
        />
        <Stat label="Nodes" value={String(nodes.length)} hint={`${formatCpu(totalCpu)} cores`} />
        <Stat
          label="CPU in use"
          value={totalCpu > 0 ? `${Math.round((usedCpu / totalCpu) * 100)}%` : '—'}
          hint={`${formatCpu(usedCpu)} of ${formatCpu(totalCpu)}`}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card title="CPU by node" subtitle="last hour, cores">
          {nodeMetrics?.available ? (
            <TimeSeries
              series={cpuSeries}
              format={formatCpu}
              ariaLabel="CPU usage per node over the last hour"
            />
          ) : (
            <Unavailable reason={nodeMetrics?.reason} />
          )}
        </Card>

        {/* Deliberately a second chart rather than a second axis on the first. */}
        <Card title="Memory by node" subtitle="last hour">
          {nodeMetrics?.available ? (
            <TimeSeries
              series={memorySeries}
              format={formatMemory}
              ariaLabel="Memory usage per node over the last hour"
            />
          ) : (
            <Unavailable reason={nodeMetrics?.reason} />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card
          title="Needs attention"
          subtitle={troubled.length === 0 ? 'everything is running' : `${troubled.length} workloads`}
          actions={
            <Button variant="ghost" onClick={onOpenResources} icon={<ArrowRight size={13} />}>
              All pods
            </Button>
          }
        >
          {troubled.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-tertiary">
              Nothing is failing or pending.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {troubled.map((pod) => (
                <li
                  key={pod.metadata?.name}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
                  style={{ transitionProperty: 'background-color', transitionDuration: '90ms' }}
                >
                  <StatusChip status={podStatus(pod as never)} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-primary">
                    {pod.metadata?.name}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-tertiary">
                    {pod.metadata?.namespace}
                  </span>
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
                  <li key={event.metadata?.name} className="border-l-2 border-[var(--status-warn)] pl-3">
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
