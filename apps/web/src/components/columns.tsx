import type { ReactNode } from 'react';
import { StatusChip } from './StatusChip.tsx';

/**
 * The column registry.
 *
 * One declaration per column, ordered by priority, looked up by kind. This is
 * what lets 28 resource kinds share one list component — and it is the specific
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
      {item.metadata?.name ?? '—'}
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
    <span className="truncate text-[12.5px] text-secondary">{item.metadata?.namespace ?? '—'}</span>
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
  if (!timestamp) return '—';
  const created = new Date(timestamp).getTime();
  if (Number.isNaN(created)) return '—';

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
    <span className="tabular-nums text-[12.5px] text-tertiary">
      {age(item.metadata?.creationTimestamp)}
    </span>
  ),
  sortBy: (item) => item.metadata?.creationTimestamp ?? '',
});

interface ContainerStatus {
  ready?: boolean;
  restartCount?: number;
  state?: { waiting?: { reason?: string }; terminated?: { reason?: string } };
}

interface PodItem extends KubeItem {
  status?: {
    phase?: string;
    containerStatuses?: ContainerStatus[];
    conditions?: Array<{ type?: string; reason?: string }>;
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
      if (!statuses) return <span className="text-[12.5px] text-tertiary">—</span>;
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
    id: 'restarts',
    priority: 50,
    header: 'Restarts',
    width: '84px',
    align: 'right',
    content: (pod) => {
      const statuses = pod.status?.containerStatuses;
      if (!statuses) return <span className="text-[12.5px] text-tertiary">—</span>;
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
        {pod.spec?.nodeName ?? '—'}
      </span>
    ),
    sortBy: (pod) => pod.spec?.nodeName ?? '',
    searchText: (pod) => pod.spec?.nodeName,
  },
  ageColumn<PodItem>(),
];

interface DeploymentItem extends KubeItem {
  spec?: { replicas?: number };
  status?: { replicas?: number; readyReplicas?: number; updatedReplicas?: number };
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
  status?: {
    conditions?: Array<{ type?: string; status?: string }>;
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
      return <StatusChip status={ready?.status === 'True' ? 'Ready' : 'NotReady'} />;
    },
    sortBy: (node) =>
      node.status?.conditions?.find((c) => c.type === 'Ready')?.status === 'True' ? 1 : 0,
  },
  {
    id: 'version',
    priority: 50,
    header: 'Version',
    width: 'minmax(150px, 1fr)',
    content: (node) => (
      <span className="truncate font-mono text-[12px] text-tertiary">
        {node.status?.nodeInfo?.kubeletVersion ?? '—'}
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
        {node.status?.capacity?.['cpu'] ?? '—'}
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
