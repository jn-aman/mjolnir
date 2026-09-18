import { useState } from 'react';
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
  Network,
  Repeat,
  Server,
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
 * Every kind gets its own icon. That sounds decorative and is not: this is a
 * list of thirty near-identical words, and shape is what the eye finds before
 * it reads. A flat list of text is why navigating Lens takes a beat longer than
 * it should.
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

const CATEGORY_ORDER = ['workloads', 'config', 'network', 'storage', 'access', 'cluster'] as const;

const CATEGORY_LABEL: Record<string, string> = {
  workloads: 'Workloads',
  config: 'Configuration',
  network: 'Network',
  storage: 'Storage',
  access: 'Access control',
  cluster: 'Cluster',
};

interface SidebarProps {
  readonly kinds: ResourceDefinition[];
  readonly selected: string;
  readonly counts: Record<string, number>;
  readonly onSelect: (kind: string) => void;
}

export function Sidebar({ kinds, selected, counts, onSelect }: SidebarProps) {
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

  return (
    <nav
      data-testid="sidebar"
      className="flex w-[216px] shrink-0 flex-col overflow-y-auto border-r border-line bg-raised py-2"
    >
      {CATEGORY_ORDER.map((category) => {
        const entries = grouped.get(category);
        if (!entries?.length) return null;
        const isCollapsed = collapsed.has(category);

        return (
          <section key={category} className="mb-1">
            <button
              type="button"
              onClick={() => toggle(category)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary hover:text-secondary"
              style={{ transitionProperty: 'color', transitionDuration: '90ms' }}
            >
              <ChevronDown
                size={11}
                strokeWidth={2.4}
                className="shrink-0"
                style={{
                  transform: isCollapsed ? 'rotate(-90deg)' : 'none',
                  transition: 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
              {CATEGORY_LABEL[category]}
            </button>

            {isCollapsed ? null : (
              <ul className="pb-1">
                {entries.map((entry) => {
                  const Icon = KIND_ICON[entry.kind] ?? Boxes;
                  const active = entry.kind === selected;
                  const count = counts[entry.kind];

                  return (
                    <li key={entry.kind}>
                      <button
                        type="button"
                        data-testid={`nav-${entry.plural}`}
                        data-active={active}
                        onClick={() => onSelect(entry.kind)}
                        className={`group relative flex w-full items-center gap-2.5 py-[5px] pl-3 pr-2.5 text-left text-[13px] ${
                          active
                            ? 'bg-pressed font-medium text-primary'
                            : 'text-secondary hover:bg-hover hover:text-primary'
                        }`}
                        style={{
                          transitionProperty: 'background-color, color',
                          transitionDuration: '90ms',
                        }}
                      >
                        {/* The active marker is a bar, not a background alone —
                            it survives being scanned peripherally. */}
                        <span
                          aria-hidden
                          className="absolute inset-y-0 left-0 w-[2px] bg-accent"
                          style={{ opacity: active ? 1 : 0, transition: 'opacity 90ms linear' }}
                        />
                        <Icon
                          size={14}
                          strokeWidth={1.8}
                          className={`shrink-0 ${active ? 'text-accent' : 'text-tertiary group-hover:text-secondary'}`}
                        />
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        {count !== undefined && count > 0 ? (
                          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-tertiary">
                            {count}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}
