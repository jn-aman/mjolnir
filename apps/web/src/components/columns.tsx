import type { ReactNode } from 'react';
import { StatusChip, toneFor } from './StatusChip.tsx';
import { tintFor } from '../lib/tint.ts';
import { formatDateTime } from '../lib/time.ts';

/**
 * The column registry.
 *
 * One declaration per column, ordered by priority, looked up by kind. This is
 * what lets 28 resource kinds share one list component, and it is the specific
 * thing whose absence produced a 704-line `ResourceViewer` in the app this
 * replaces. Adding a kind is a row in a table, not a screen.
 *
 * Adapted from Freelens's column contract (MIT), minus the dependency-injection
 * machinery it is wrapped in there.
 */

export interface Column<T = KubeItem> {
  readonly id: string;
  /** Lower sorts earlier. Gaps are intentional so columns can be slotted in. */
  readonly priority: number;
  readonly header: string;
  /** CSS width. Fixed widths keep columns aligned down a long list. */
  readonly width: string;
  readonly align?: 'left' | 'right';
  readonly content: (item: T) => ReactNode;
  /** Sort key. Omit to make the column unsortable. */
  readonly sortBy?: (item: T) => string | number;
  /** Extra text the quick filter should match, beyond the name. */
  readonly searchText?: (item: T) => string | undefined;
}

export interface KubeItem {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
  };
  status?: Record<string, unknown>;
  spec?: Record<string, unknown>;
}

const name = <T extends KubeItem>(): Column<T> => ({
  id: 'name',
  priority: 10,
  header: 'Name',
  width: 'minmax(260px, 2fr)',
  content: (item) => (
    <span className="truncate font-mono text-[12.5px] text-primary">
      {item.metadata?.name ?? '-'}
    </span>
  ),
  sortBy: (item) => item.metadata?.name ?? '',
  searchText: (item) => item.metadata?.name,
});

const namespace = <T extends KubeItem>(): Column<T> => ({
  id: 'namespace',
  priority: 20,
  header: 'Namespace',
  width: 'minmax(120px, 1fr)',
  content: (item) => (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ background: tintFor(item.metadata?.namespace) }}
      />
      <span className="truncate text-[12.5px] text-secondary">{item.metadata?.namespace ?? '-'}</span>
    </span>
  ),
  sortBy: (item) => item.metadata?.namespace ?? '',
  searchText: (item) => item.metadata?.namespace,
});

/**
 * Relative age, rendered the way kubectl does.
 *
 * Coarse on purpose: nobody needs "2 hours, 14 minutes" in a list, and the
 * precision invites reading meaning into noise.
 */
export function age(timestamp: string | undefined): string {
  if (!timestamp) return '-';
  const created = new Date(timestamp).getTime();
  if (Number.isNaN(created)) return '-';

  const seconds = Math.max(0, Math.floor((Date.now() - created) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const ageColumn = <T extends KubeItem>(): Column<T> => ({
  id: 'age',
  priority: 90,
  header: 'Age',
  width: '72px',
  align: 'right',
  content: (item) => (
    <span
      className="tabular-nums text-[12.5px] text-tertiary"
      title={item.metadata?.creationTimestamp ? `created ${formatDateTime(item.metadata.creationTimestamp)}` : undefined}
    >
      {age(item.metadata?.creationTimestamp)}
    </span>
  ),
  sortBy: (item) => item.metadata?.creationTimestamp ?? '',
});

interface ContainerStatus {
  name?: string;
  ready?: boolean;
  restartCount?: number;
  state?: {
    waiting?: { reason?: string; message?: string };
    terminated?: { reason?: string; exitCode?: number; message?: string };
  };
  lastState?: { terminated?: { reason?: string; exitCode?: number; finishedAt?: string } };
}

interface PodItem extends KubeItem {
  status?: {
    phase?: string;
    message?: string;
    containerStatuses?: ContainerStatus[];
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
  spec?: { nodeName?: string; containers?: Array<{ name?: string }> };
}

/**
 * A pod's real status.
 *
 * `phase` alone is misleading: a CrashLoopBackOff pod reports `Running`. The
 * waiting reason on a container is the truth, and showing anything else is how
 * a dashboard tells you a broken pod is fine.
 */
export function podStatus(pod: PodItem): string {
  const waiting = pod.status?.containerStatuses?.find((status) => status.state?.waiting?.reason);
  if (waiting?.state?.waiting?.reason) return waiting.state.waiting.reason;

  const unschedulable = pod.status?.conditions?.find((c) => c.reason === 'Unschedulable');
  if (unschedulable) return 'Unschedulable';

  return pod.status?.phase ?? 'Unknown';
}

/**
 * What is wrong, in one line.
 *
 * A status of CrashLoopBackOff says *that* something is wrong; this says
 * *what*: the last exit reason and code, the scheduler's own sentence, the
 * kubelet's waiting message. It is the sentence you would otherwise open the
 * pod, scroll to the bottom of describe, and copy out by hand.
 */
export function podProblem(pod: PodItem): string | undefined {
  const statuses = pod.status?.containerStatuses ?? [];
  for (const status of statuses) {
    const waiting = status.state?.waiting;
    const last = status.lastState?.terminated;
    if (waiting?.reason && waiting.reason !== 'ContainerCreating') {
      const exit = last?.reason ? `${last.reason}${last.exitCode !== undefined ? ` (exit ${last.exitCode})` : ''}` : undefined;
      const parts = [exit, waiting.message].filter(Boolean);
      return `${statuses.length > 1 ? `${status.name}: ` : ''}${parts.length ? parts.join(', ') : waiting.reason}`;
    }
    const terminated = status.state?.terminated;
    if (terminated?.reason && terminated.reason !== 'Completed') {
      return `${statuses.length > 1 ? `${status.name}: ` : ''}${terminated.reason}${terminated.exitCode !== undefined ? ` (exit ${terminated.exitCode})` : ''}`;
    }
  }
  const unschedulable = pod.status?.conditions?.find((c) => c.reason === 'Unschedulable');
  if (unschedulable?.message) return unschedulable.message;
  const notReady = pod.status?.conditions?.find((c) => c.type === 'Ready' && c.status === 'False' && c.message);
  if (notReady?.message && pod.status?.phase !== 'Succeeded') return notReady.message;
  if (pod.status?.phase === 'Failed' && pod.status.message) return pod.status.message;
  return undefined;
}

const POD_COLUMNS: Array<Column<PodItem>> = [
  name<PodItem>(),
  namespace<PodItem>(),
  {
    id: 'ready',
    priority: 30,
    header: 'Ready',
    width: '72px',
    content: (pod) => {
      const statuses = pod.status?.containerStatuses;
      // No container statuses at all means the pod was never scheduled. A dash
      // is the honest answer; "0/0" implies we looked and found nothing.
      if (!statuses) return <span className="text-[12.5px] text-tertiary">-</span>;
      const ready = statuses.filter((status) => status.ready).length;
      return (
        <span className="tabular-nums font-mono text-[12.5px] text-secondary">
          {ready}/{statuses.length}
        </span>
      );
    },
    sortBy: (pod) => pod.status?.containerStatuses?.filter((s) => s.ready).length ?? -1,
  },
  {
    id: 'status',
    priority: 40,
    header: 'Status',
    width: 'minmax(150px, 1fr)',
    content: (pod) => <StatusChip status={podStatus(pod)} />,
    sortBy: (pod) => podStatus(pod),
    searchText: (pod) => podStatus(pod),
  },
  {
    id: 'problem',
    priority: 45,
    header: 'What’s wrong',
    width: 'minmax(220px, 2fr)',
    content: (pod) => {
      const problem = podProblem(pod);
      if (!problem) return <span className="text-[12.5px] text-tertiary">-</span>;
      const tone = toneFor(podStatus(pod)) === 'error' ? 'text-error' : 'text-warn';
      return (
        <span title={problem} className={`truncate text-[12px] ${tone}`}>
          {problem}
        </span>
      );
    },
    sortBy: (pod) => (podProblem(pod) ? 0 : 1),
    searchText: (pod) => podProblem(pod),
  },
  {
    id: 'restarts',
    priority: 50,
    header: 'Restarts',
    width: '84px',
    align: 'right',
    content: (pod) => {
      const statuses = pod.status?.containerStatuses;
      if (!statuses) return <span className="text-[12.5px] text-tertiary">-</span>;
      const restarts = statuses.reduce((total, status) => total + (status.restartCount ?? 0), 0);
      // Anything above a handful is worth the eye catching without being an alarm.
      const tone = restarts > 3 ? 'text-warn' : restarts > 0 ? 'text-secondary' : 'text-tertiary';
      return <span className={`tabular-nums font-mono text-[12.5px] ${tone}`}>{restarts}</span>;
    },
    sortBy: (pod) =>
      pod.status?.containerStatuses?.reduce((t, s) => t + (s.restartCount ?? 0), 0) ?? -1,
  },
  {
    id: 'node',
    priority: 60,
    header: 'Node',
    width: 'minmax(140px, 1fr)',
    content: (pod) => (
      <span className="truncate font-mono text-[12px] text-tertiary">
        {pod.spec?.nodeName ?? '-'}
      </span>
    ),
    sortBy: (pod) => pod.spec?.nodeName ?? '',
    searchText: (pod) => pod.spec?.nodeName,
  },
  ageColumn<PodItem>(),
];

interface DeploymentItem extends KubeItem {
  spec?: { replicas?: number };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    updatedReplicas?: number;
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
}

export function workloadProblem(item: DeploymentItem): string | undefined {
  const desired = item.spec?.replicas ?? 0;
  const ready = item.status?.readyReplicas ?? 0;
  if (ready >= desired) return undefined;
  const failing = item.status?.conditions?.find(
    (c) => (c.type === 'Available' && c.status === 'False') || (c.type === 'Progressing' && c.status === 'False'),
  );
  return failing?.message ?? `${desired - ready} of ${desired} replicas not ready`;
}

const DEPLOYMENT_COLUMNS: Array<Column<DeploymentItem>> = [
  name<DeploymentItem>(),
  namespace<DeploymentItem>(),
  {
    id: 'ready',
    priority: 30,
    header: 'Ready',
    width: '84px',
    content: (item) => {
      const desired = item.spec?.replicas ?? 0;
      const ready = item.status?.readyReplicas ?? 0;
      const tone = ready < desired ? 'text-warn' : 'text-secondary';
      return (
        <span className={`tabular-nums font-mono text-[12.5px] ${tone}`}>
          {ready}/{desired}
        </span>
      );
    },
    sortBy: (item) => item.status?.readyReplicas ?? -1,
  },
  {
    id: 'problem',
    priority: 35,
    header: 'What’s wrong',
    width: 'minmax(200px, 2fr)',
    content: (item) => {
      const problem = workloadProblem(item);
      return problem ? (
        <span title={problem} className="truncate text-[12px] text-warn">{problem}</span>
      ) : (
        <span className="text-[12.5px] text-tertiary">-</span>
      );
    },
    sortBy: (item) => (workloadProblem(item) ? 0 : 1),
    searchText: (item) => workloadProblem(item),
  },
  {
    id: 'updated',
    priority: 40,
    header: 'Up-to-date',
    width: '98px',
    align: 'right',
    content: (item) => (
      <span className="tabular-nums font-mono text-[12.5px] text-tertiary">
        {item.status?.updatedReplicas ?? 0}
      </span>
    ),
  },
  ageColumn<DeploymentItem>(),
];

interface NodeItem extends KubeItem {
  spec?: { unschedulable?: boolean; taints?: Array<{ key?: string; effect?: string }> };
  status?: {
    conditions?: Array<{ type?: string; status?: string; message?: string }>;
    nodeInfo?: { kubeletVersion?: string; osImage?: string };
    capacity?: Record<string, string>;
  };
}

const NODE_COLUMNS: Array<Column<NodeItem>> = [
  { ...name<NodeItem>(), width: 'minmax(220px, 2fr)' },
  {
    id: 'status',
    priority: 30,
    header: 'Status',
    width: 'minmax(120px, 1fr)',
    content: (node) => {
      const ready = node.status?.conditions?.find((c) => c.type === 'Ready');
      return (
        <span className="flex items-center gap-1.5">
          <StatusChip status={ready?.status === 'True' ? 'Ready' : 'NotReady'} />
          {node.spec?.unschedulable ? (
            <span className="rounded-xs bg-warn-bg px-1.5 py-[1px] text-[10.5px] font-medium text-warn">cordoned</span>
          ) : null}
        </span>
      );
    },
    sortBy: (node) =>
      node.status?.conditions?.find((c) => c.type === 'Ready')?.status === 'True' ? 1 : 0,
  },
  {
    id: 'problem',
    priority: 45,
    header: 'What’s wrong',
    width: 'minmax(200px, 2fr)',
    content: (node) => {
      const pressure = node.status?.conditions?.find((c) => c.type !== 'Ready' && c.status === 'True');
      const notReady = node.status?.conditions?.find((c) => c.type === 'Ready' && c.status !== 'True');
      const taints = node.spec?.taints?.length ? `${node.spec.taints.length} taint${node.spec.taints.length > 1 ? 's' : ''}` : undefined;
      const problem = notReady?.message ?? (pressure ? `${pressure.type}: ${pressure.message ?? ''}` : undefined) ?? (node.spec?.unschedulable ? 'Cordoned, no new pods will schedule' : undefined);
      if (!problem) return <span className="text-[12.5px] text-tertiary">{taints ?? '-'}</span>;
      return (
        <span title={problem} className={`truncate text-[12px] ${notReady ? 'text-error' : 'text-warn'}`}>
          {problem}
          {taints ? <span className="text-tertiary"> · {taints}</span> : null}
        </span>
      );
    },
  },
  {
    id: 'version',
    priority: 50,
    header: 'Version',
    width: 'minmax(150px, 1fr)',
    content: (node) => (
      <span className="truncate font-mono text-[12px] text-tertiary">
        {node.status?.nodeInfo?.kubeletVersion ?? '-'}
      </span>
    ),
    searchText: (node) => node.status?.nodeInfo?.kubeletVersion,
  },
  {
    id: 'cpu',
    priority: 60,
    header: 'CPU',
    width: '72px',
    align: 'right',
    content: (node) => (
      <span className="tabular-nums font-mono text-[12.5px] text-tertiary">
        {node.status?.capacity?.['cpu'] ?? '-'}
      </span>
    ),
  },
  ageColumn<NodeItem>(),
];

const GENERIC_COLUMNS: Array<Column<KubeItem>> = [name(), namespace(), ageColumn()];

const BY_KIND: Record<string, Array<Column<never>>> = {
  Pod: POD_COLUMNS as Array<Column<never>>,
  Deployment: DEPLOYMENT_COLUMNS as Array<Column<never>>,
  StatefulSet: DEPLOYMENT_COLUMNS as Array<Column<never>>,
  DaemonSet: DEPLOYMENT_COLUMNS as Array<Column<never>>,
  Node: NODE_COLUMNS as Array<Column<never>>,
};

/** Columns for a kind, priority-ordered, falling back to name/namespace/age. */
export function columnsFor(kind: string): Array<Column<KubeItem>> {
  const columns = (BY_KIND[kind] ?? GENERIC_COLUMNS) as Array<Column<KubeItem>>;
  return [...columns].sort((a, b) => a.priority - b.priority);
}
