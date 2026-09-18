import { useState } from 'react';
import { motion } from 'motion/react';
import type { ResourceDefinition } from '@mjolnir/k8s';
import {
  Boxes,
  ChevronDown,
  Clock,
  Cog,
  Container,
  Database,
  FileKey,
  FileText,
  Gauge,
  Globe,
  HardDrive,
  Key,
  Layers,
  LayoutDashboard,
  Network,
  Repeat,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Shuffle,
  Timer,
  UserCircle,
  Waypoints,
} from 'lucide-react';

/**
 * Resource navigation.
 *
 * Overview is an entry in this list, not a separate mode. It is the cluster's
 * own page; putting it in a top-level tab implies it is a different kind of
 * thing, and it is not — it is simply the first thing you look at.
 *
 * Every kind carries its own icon. That is not decoration: this is a list of
 * thirty near-identical words, and shape is what the eye finds before it reads.
 */

const KIND_ICON: Record<string, typeof Boxes> = {
  Pod: Container,
  Deployment: Layers,
  StatefulSet: Database,
  DaemonSet: Repeat,
  ReplicaSet: Boxes,
  Job: Timer,
  CronJob: Clock,
  ConfigMap: FileText,
  Secret: FileKey,
  ResourceQuota: Gauge,
  LimitRange: Gauge,
  HorizontalPodAutoscaler: Shuffle,
  PodDisruptionBudget: Shield,
  Service: Waypoints,
  Ingress: Globe,
  NetworkPolicy: Network,
  Endpoints: Waypoints,
  PersistentVolumeClaim: HardDrive,
  PersistentVolume: HardDrive,
  StorageClass: HardDrive,
  ServiceAccount: UserCircle,
  Role: Key,
  RoleBinding: Key,
  ClusterRole: ShieldCheck,
  ClusterRoleBinding: ShieldCheck,
  Node: Server,
  Namespace: Boxes,
  Event: Cog,
};

const CATEGORY_ORDER = ['cluster', 'workloads', 'config', 'network', 'storage', 'access'] as const;

const CATEGORY_LABEL: Record<string, string> = {
  cluster: 'Cluster',
  workloads: 'Workloads',
  config: 'Configuration',
  network: 'Network',
  storage: 'Storage',
  access: 'Access control',
};

/** What the sidebar can select: a resource kind, or one of the app's own pages. */
export type NavSelection =
  | { kind: 'resource'; value: string }
  | { kind: 'page'; value: 'overview' | 'settings' };

interface SidebarProps {
  readonly kinds: ResourceDefinition[];
  readonly selection: NavSelection;
  readonly counts: Record<string, number>;
  readonly onSelect: (selection: NavSelection) => void;
}

export function Sidebar({ kinds, selection, counts, onSelect }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const grouped = new Map<string, ResourceDefinition[]>();
  for (const entry of kinds) {
    const list = grouped.get(entry.category) ?? [];
    list.push(entry);
    grouped.set(entry.category, list);
  }

  const toggle = (category: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const isActive = (candidate: NavSelection) =>
    candidate.kind === selection.kind && candidate.value === selection.value;

  return (
    <nav
      data-testid="sidebar"
      className="flex w-[212px] shrink-0 flex-col overflow-y-auto border-r border-line bg-raised py-2"
    >
      <Entry
        icon={LayoutDashboard}
        label="Overview"
        testId="nav-overview"
        active={isActive({ kind: 'page', value: 'overview' })}
        onSelect={() => onSelect({ kind: 'page', value: 'overview' })}
      />

      <div className="mx-3 my-1.5 h-px bg-[var(--border-subtle)]" />

      {CATEGORY_ORDER.map((category) => {
        const entries = grouped.get(category);
        if (!entries?.length) return null;
        const isCollapsed = collapsed.has(category);

        return (
          <section key={category} className="mb-0.5">
            <button
              type="button"
              onClick={() => toggle(category)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary transition-colors duration-100 hover:text-secondary"
            >
              <motion.span
                animate={{ rotate: isCollapsed ? -90 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                className="flex shrink-0"
              >
                <ChevronDown size={11} strokeWidth={2.4} />
              </motion.span>
              {CATEGORY_LABEL[category]}
            </button>

            {isCollapsed ? null : (
              <ul>
                {entries.map((entry) => (
                  <li key={entry.kind}>
                    <Entry
                      icon={KIND_ICON[entry.kind] ?? Boxes}
                      label={entry.label}
                      testId={`nav-${entry.plural}`}
                      active={isActive({ kind: 'resource', value: entry.kind })}
                      count={counts[entry.kind]}
                      onSelect={() => onSelect({ kind: 'resource', value: entry.kind })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <div className="flex-1" />
      <div className="mx-3 my-1.5 h-px bg-[var(--border-subtle)]" />
      <Entry
        icon={Settings}
        label="Settings"
        testId="nav-settings"
        active={isActive({ kind: 'page', value: 'settings' })}
        onSelect={() => onSelect({ kind: 'page', value: 'settings' })}
      />
    </nav>
  );
}

function Entry({
  icon: Icon,
  label,
  testId,
  active,
  count,
  onSelect,
}: {
  icon: typeof Boxes;
  label: string;
  testId: string;
  active: boolean;
  count?: number | undefined;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active}
      onClick={onSelect}
      className={`group relative flex w-full items-center gap-2.5 py-[5px] pl-3 pr-2.5 text-left text-[13px] transition-colors duration-100 ${
        active ? 'font-medium text-primary' : 'text-secondary hover:text-primary'
      }`}
    >
      {active ? (
        <motion.span
          // One element for the whole nav, so the selection slides between
          // entries rather than blinking out in one place and in again in
          // another. This is the difference between a menu that moves and one
          // that repaints.
          layoutId="sidebar-active"
          aria-hidden
          className="absolute inset-0 border-l-2 border-accent bg-pressed"
          transition={{ type: 'spring', stiffness: 480, damping: 38 }}
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 bg-transparent transition-colors duration-100 group-hover:bg-hover"
        />
      )}
      <Icon
        size={14}
        strokeWidth={1.8}
        className={`relative shrink-0 ${active ? 'text-accent' : 'text-tertiary group-hover:text-secondary'}`}
      />
      <span className="relative min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 ? (
        <span className="relative shrink-0 font-mono text-[10.5px] tabular-nums text-tertiary">
          {count}
        </span>
      ) : null}
    </button>
  );
}
