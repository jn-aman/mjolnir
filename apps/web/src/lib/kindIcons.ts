import {
  Archive,
  Boxes,
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
  Package,
  Repeat,
  Server,
  Ship,
  Shield,
  ShieldCheck,
  Shuffle,
  Timer,
  UserCircle,
  Waypoints,
  Folder,
  type LucideIcon,
} from 'lucide-react';
import { CATEGORY_TINT } from './tint.ts';

/**
 * One icon and one tint per kind, used by the sidebar, every row, the drawer
 * header and the palette, so a Deployment looks the same wherever it appears.
 */
export const KIND_ICON: Record<string, LucideIcon> = {
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
  HelmRelease: Package,
  DockerContainer: Ship,
  DockerImage: Layers,
  DockerVolume: HardDrive,
  DockerNetwork: Network,
  StorageObject: Archive,
  StoragePrefix: Folder,
};

const KIND_CATEGORY: Record<string, string> = {
  Node: 'cluster', Namespace: 'cluster', Event: 'cluster',
  Pod: 'workloads', Deployment: 'workloads', StatefulSet: 'workloads', DaemonSet: 'workloads', ReplicaSet: 'workloads', Job: 'workloads', CronJob: 'workloads',
  ConfigMap: 'config', Secret: 'config', ResourceQuota: 'config', LimitRange: 'config', HorizontalPodAutoscaler: 'config', PodDisruptionBudget: 'config',
  Service: 'network', Ingress: 'network', NetworkPolicy: 'network', Endpoints: 'network',
  PersistentVolumeClaim: 'storage', PersistentVolume: 'storage', StorageClass: 'storage',
  ServiceAccount: 'access', Role: 'access', RoleBinding: 'access', ClusterRole: 'access', ClusterRoleBinding: 'access',
};

const EXTRA_TINT: Record<string, string> = {
  HelmRelease: 'var(--series-1)',
  DockerContainer: 'var(--series-3)',
  DockerImage: 'var(--series-1)',
  DockerVolume: 'var(--log-pod-b)',
  DockerNetwork: 'var(--series-2)',
  StorageObject: 'var(--log-pod-b)',
  StoragePrefix: 'var(--series-4)',
};

export function kindIcon(kind: string): LucideIcon {
  return KIND_ICON[kind] ?? Boxes;
}

export function kindTint(kind: string): string {
  return EXTRA_TINT[kind] ?? CATEGORY_TINT[KIND_CATEGORY[kind] ?? ''] ?? 'var(--accent-base)';
}
