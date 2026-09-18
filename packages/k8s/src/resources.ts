/**
 * The resource registry.
 *
 * One table describing every built-in kind Mjolnir knows about, so screens, the
 * command palette, routing and the generic list all read from the same source
 * rather than each hard-coding API groups. Adding a kind is a row here, not a
 * component.
 */

export type ResourceCategory =
  | 'workloads'
  | 'config'
  | 'network'
  | 'storage'
  | 'access'
  | 'cluster'
  | 'custom';

export interface ResourceDefinition {
  /** Kubernetes kind, as it appears in a manifest. */
  readonly kind: string;
  /** API group; empty string for the core group. */
  readonly group: string;
  readonly version: string;
  /** Lowercase plural used in API paths. */
  readonly plural: string;
  readonly namespaced: boolean;
  readonly category: ResourceCategory;
  /** Plural shown in the UI. */
  readonly label: string;
  /** Accepted in the command palette and quick search. */
  readonly aliases: readonly string[];
}

const define = (
  kind: string,
  plural: string,
  category: ResourceCategory,
  options: Partial<Omit<ResourceDefinition, 'kind' | 'plural' | 'category'>> = {},
): ResourceDefinition => ({
  kind,
  group: options.group ?? '',
  version: options.version ?? 'v1',
  plural,
  namespaced: options.namespaced ?? true,
  category,
  label: options.label ?? kind.replace(/([a-z])([A-Z])/g, '$1 $2'),
  aliases: options.aliases ?? [],
});

export const RESOURCES: readonly ResourceDefinition[] = [
  // Workloads
  define('Pod', 'pods', 'workloads', { aliases: ['po'] }),
  define('Deployment', 'deployments', 'workloads', { group: 'apps', version: 'v1', aliases: ['deploy'] }),
  define('StatefulSet', 'statefulsets', 'workloads', { group: 'apps', version: 'v1', aliases: ['sts'] }),
  define('DaemonSet', 'daemonsets', 'workloads', { group: 'apps', version: 'v1', aliases: ['ds'] }),
  define('ReplicaSet', 'replicasets', 'workloads', { group: 'apps', version: 'v1', aliases: ['rs'] }),
  define('Job', 'jobs', 'workloads', { group: 'batch', version: 'v1' }),
  define('CronJob', 'cronjobs', 'workloads', { group: 'batch', version: 'v1', aliases: ['cj'] }),

  // Config
  define('ConfigMap', 'configmaps', 'config', { aliases: ['cm'] }),
  define('Secret', 'secrets', 'config'),
  define('ResourceQuota', 'resourcequotas', 'config', { aliases: ['quota'] }),
  define('LimitRange', 'limitranges', 'config'),
  define('HorizontalPodAutoscaler', 'horizontalpodautoscalers', 'config', {
    group: 'autoscaling',
    version: 'v2',
    aliases: ['hpa'],
  }),
  define('PodDisruptionBudget', 'poddisruptionbudgets', 'config', {
    group: 'policy',
    version: 'v1',
    aliases: ['pdb'],
  }),

  // Network
  define('Service', 'services', 'network', { aliases: ['svc'] }),
  define('Ingress', 'ingresses', 'network', { group: 'networking.k8s.io', version: 'v1', aliases: ['ing'] }),
  define('NetworkPolicy', 'networkpolicies', 'network', { group: 'networking.k8s.io', version: 'v1', aliases: ['netpol'] }),
  define('Endpoints', 'endpoints', 'network', { aliases: ['ep'] }),

  // Storage
  define('PersistentVolumeClaim', 'persistentvolumeclaims', 'storage', { aliases: ['pvc'] }),
  define('PersistentVolume', 'persistentvolumes', 'storage', { namespaced: false, aliases: ['pv'] }),
  define('StorageClass', 'storageclasses', 'storage', {
    group: 'storage.k8s.io',
    version: 'v1',
    namespaced: false,
    aliases: ['sc'],
  }),

  // Access control
  define('ServiceAccount', 'serviceaccounts', 'access', { aliases: ['sa'] }),
  define('Role', 'roles', 'access', { group: 'rbac.authorization.k8s.io', version: 'v1' }),
  define('RoleBinding', 'rolebindings', 'access', { group: 'rbac.authorization.k8s.io', version: 'v1' }),
  define('ClusterRole', 'clusterroles', 'access', {
    group: 'rbac.authorization.k8s.io',
    version: 'v1',
    namespaced: false,
  }),
  define('ClusterRoleBinding', 'clusterrolebindings', 'access', {
    group: 'rbac.authorization.k8s.io',
    version: 'v1',
    namespaced: false,
  }),

  // Cluster
  define('Node', 'nodes', 'cluster', { namespaced: false, aliases: ['no'] }),
  define('Namespace', 'namespaces', 'cluster', { namespaced: false, aliases: ['ns'] }),
  define('Event', 'events', 'cluster', { aliases: ['ev'] }),
];

const BY_KIND = new Map(RESOURCES.map((resource) => [resource.kind.toLowerCase(), resource]));

const BY_ALIAS = new Map<string, ResourceDefinition>();
for (const resource of RESOURCES) {
  BY_ALIAS.set(resource.plural.toLowerCase(), resource);
  BY_ALIAS.set(resource.kind.toLowerCase(), resource);
  for (const alias of resource.aliases) BY_ALIAS.set(alias.toLowerCase(), resource);
}

export function resourceByKind(kind: string): ResourceDefinition | undefined {
  return BY_KIND.get(kind.toLowerCase());
}

/** Resolve anything a user might type: kind, plural, or kubectl short name. */
export function resolveResource(input: string): ResourceDefinition | undefined {
  return BY_ALIAS.get(input.trim().toLowerCase());
}

export function resourcesByCategory(category: ResourceCategory): ResourceDefinition[] {
  return RESOURCES.filter((resource) => resource.category === category);
}

/** The `apiVersion` string for a manifest — "v1" for core, "group/version" otherwise. */
export function apiVersionOf(resource: ResourceDefinition): string {
  return resource.group ? `${resource.group}/${resource.version}` : resource.version;
}

/** REST path for a collection, namespaced when the kind and argument allow. */
export function collectionPath(resource: ResourceDefinition, namespace?: string): string {
  const base = resource.group
    ? `/apis/${resource.group}/${resource.version}`
    : `/api/${resource.version}`;
  if (resource.namespaced && namespace) {
    return `${base}/namespaces/${namespace}/${resource.plural}`;
  }
  return `${base}/${resource.plural}`;
}
