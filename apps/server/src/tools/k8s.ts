import { z } from 'zod';
import { load as parseYaml } from 'js-yaml';
import { RESOURCES, collectionPath, resolveResource, decodeHelmReleases, latestHelmReleases, type HelmSecretShape } from '@mjolnir/k8s';
import { demoNodeMetrics, demoPodMetrics, latest } from '@mjolnir/demo';
import type { ToolContext, ToolDefinition } from './index.ts';

/**
 * Cluster tools, named the way kubectl names the operation, so an agent that
 * knows kubectl knows these. Read tools answer from the watch cache where one
 * exists, so calling them in a loop costs nothing on the API server.
 */

const ctx = z.string().describe('Kubeconfig context name. Use list_contexts to see them; "demo" is the built-in demo cluster.');
const ns = z.string().optional().describe('Namespace. Omit for all namespaces (cluster-scoped kinds ignore it).');
const kind = z.string().describe('Kubernetes kind, e.g. Pod, Deployment, Service, Node, ConfigMap.');

function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  kindOf: 'read' | 'write',
  shape: S,
  run: (input: z.infer<z.ZodObject<S>>, context: ToolContext) => Promise<unknown>,
): ToolDefinition<z.infer<z.ZodObject<S>>> {
  return { name, description, kind: kindOf, input: z.object(shape), run };
}

interface Listed {
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string>; creationTimestamp?: string; ownerReferences?: Array<{ kind?: string; name?: string }> };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

async function list(context: ToolContext, contextName: string, kindName: string, namespace?: string): Promise<Listed[]> {
  const resource = resolveResource(kindName);
  if (!resource) throw new Error(`unknown kind ${kindName}; call list_kinds`);
  const connection = context.registry.connect(contextName);
  const watch = connection.watch(resource, resource.namespaced ? namespace : undefined);
  let snapshot = watch.snapshot();
  // First call for a kind: give the watch a moment to sync rather than answering "nothing".
  for (let tries = 0; snapshot.state === 'connecting' && tries < 20; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    snapshot = watch.snapshot();
  }
  if (snapshot.error) throw new Error(snapshot.error);
  return [...snapshot.items] as Listed[];
}

function strip(item: Listed): Listed {
  const meta = item.metadata ? { ...item.metadata } : undefined;
  if (meta) delete (meta as Record<string, unknown>)['managedFields'];
  return { ...item, ...(meta ? { metadata: meta } : {}) };
}

function podState(pod: Listed): { status: string; problem?: string; restarts: number; ready: string } {
  const statuses = (pod.status?.['containerStatuses'] as Array<{ ready?: boolean; restartCount?: number; state?: { waiting?: { reason?: string; message?: string }; terminated?: { reason?: string; exitCode?: number } }; lastState?: { terminated?: { reason?: string; exitCode?: number } } }> | undefined) ?? [];
  const waiting = statuses.find((s) => s.state?.waiting?.reason);
  const conditions = (pod.status?.['conditions'] as Array<{ reason?: string; message?: string }> | undefined) ?? [];
  const unschedulable = conditions.find((c) => c.reason === 'Unschedulable');
  const status = waiting?.state?.waiting?.reason ?? (unschedulable ? 'Unschedulable' : String(pod.status?.['phase'] ?? 'Unknown'));
  const last = statuses.find((s) => s.lastState?.terminated)?.lastState?.terminated;
  const problem = waiting
    ? [last?.reason ? `${last.reason} (exit ${last.exitCode})` : undefined, waiting.state?.waiting?.message].filter(Boolean).join(': ')
    : unschedulable?.message;
  return {
    status,
    ...(problem ? { problem } : {}),
    restarts: statuses.reduce((n, s) => n + (s.restartCount ?? 0), 0),
    ready: statuses.length ? `${statuses.filter((s) => s.ready).length}/${statuses.length}` : '-',
  };
}

export const K8S_TOOLS = [
  tool('list_contexts', 'Clusters available in the kubeconfig, with the current one.', 'read', {}, async (_input, context) => ({
    current: context.registry.currentContext,
    contexts: context.registry.contexts.map((c) => ({ name: c.name, server: c.server, provider: c.provider, namespace: c.namespace })),
  })),

  tool('list_kinds', 'Resource kinds this server can list, with their category and whether they are namespaced.', 'read', {}, async () =>
    RESOURCES.map((r) => ({ kind: r.kind, plural: r.plural, category: r.category, namespaced: r.namespaced })),
  ),

  tool('get_cluster_summary', 'Counts of nodes, namespaces, pods by status, and every pod with a problem. The first call to make when asked "what is going on".', 'read', { context: ctx }, async (input, context) => {
    const [pods, nodes, namespaces] = await Promise.all([
      list(context, input.context, 'Pod'),
      list(context, input.context, 'Node'),
      list(context, input.context, 'Namespace').catch((): Listed[] => []),
    ]);
    const byStatus: Record<string, number> = {};
    const problems: unknown[] = [];
    for (const pod of pods) {
      const state = podState(pod);
      byStatus[state.status] = (byStatus[state.status] ?? 0) + 1;
      if (state.problem || !['Running', 'Succeeded', 'Completed'].includes(state.status)) {
        problems.push({ name: pod.metadata?.name, namespace: pod.metadata?.namespace, ...state, node: pod.spec?.['nodeName'] });
      }
    }
    const notReady = nodes.filter((n) => !((n.status?.['conditions'] as Array<{ type?: string; status?: string }> | undefined) ?? []).some((c) => c.type === 'Ready' && c.status === 'True'));
    return {
      nodes: { total: nodes.length, notReady: notReady.map((n) => n.metadata?.name) },
      namespaces: namespaces.length,
      pods: { total: pods.length, byStatus },
      problems,
    };
  }),

  tool('whats_wrong', 'Every pod, workload and node that is failing, pending, crash-looping, unschedulable or not ready, each with the reason in one line.', 'read', { context: ctx, namespace: ns }, async (input, context) => {
    const [pods, deployments, nodes] = await Promise.all([
      list(context, input.context, 'Pod', input.namespace),
      list(context, input.context, 'Deployment', input.namespace).catch((): Listed[] => []),
      list(context, input.context, 'Node').catch((): Listed[] => []),
    ]);
    return {
      pods: pods
        .map((pod) => ({ name: pod.metadata?.name, namespace: pod.metadata?.namespace, ...podState(pod) }))
        .filter((p) => p.problem || !['Running', 'Succeeded', 'Completed'].includes(p.status)),
      deployments: deployments
        .map((d) => {
          const desired = Number(d.spec?.['replicas'] ?? 0);
          const ready = Number(d.status?.['readyReplicas'] ?? 0);
          const cond = ((d.status?.['conditions'] as Array<{ type?: string; status?: string; message?: string }> | undefined) ?? []).find((c) => c.status === 'False');
          return { name: d.metadata?.name, namespace: d.metadata?.namespace, ready: `${ready}/${desired}`, problem: cond?.message };
        })
        .filter((d) => d.ready.split('/')[0] !== d.ready.split('/')[1]),
      nodes: nodes
        .map((n) => {
          const conditions = (n.status?.['conditions'] as Array<{ type?: string; status?: string; message?: string }> | undefined) ?? [];
          const ready = conditions.find((c) => c.type === 'Ready');
          const pressure = conditions.filter((c) => c.type !== 'Ready' && c.status === 'True').map((c) => c.type);
          return { name: n.metadata?.name, ready: ready?.status === 'True', pressure, cordoned: n.spec?.['unschedulable'] === true };
        })
        .filter((n) => !n.ready || n.pressure.length || n.cordoned),
    };
  }),

  tool('list_namespaces', 'Namespaces in the cluster.', 'read', { context: ctx }, async (input, context) =>
    (await list(context, input.context, 'Namespace')).map((n) => ({ name: n.metadata?.name, phase: n.status?.['phase'] })),
  ),

  tool('list_nodes', 'Nodes with readiness, capacity, version, taints and cordon state.', 'read', { context: ctx }, async (input, context) =>
    (await list(context, input.context, 'Node')).map((n) => ({
      name: n.metadata?.name,
      ready: ((n.status?.['conditions'] as Array<{ type?: string; status?: string }> | undefined) ?? []).find((c) => c.type === 'Ready')?.status === 'True',
      cordoned: n.spec?.['unschedulable'] === true,
      taints: n.spec?.['taints'],
      capacity: n.status?.['capacity'],
      allocatable: n.status?.['allocatable'],
      version: (n.status?.['nodeInfo'] as { kubeletVersion?: string } | undefined)?.kubeletVersion,
      labels: n.metadata?.labels,
    })),
  ),

  tool('list_resources', 'Objects of one kind: name, namespace, age, and for pods their status, readiness, restarts and node. Use get_resource for the full object.', 'read', { context: ctx, kind, namespace: ns, labelSelector: z.string().optional().describe('key=value pairs, comma separated') }, async (input, context) => {
    const wanted = (input.labelSelector ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((pair) => pair.split('='));
    return (await list(context, input.context, input.kind, input.namespace))
      .filter((item) => wanted.every(([k, v]) => item.metadata?.labels?.[k ?? ''] === v))
      .map((item) => ({
        name: item.metadata?.name,
        namespace: item.metadata?.namespace,
        created: item.metadata?.creationTimestamp,
        ...(input.kind === 'Pod' ? { ...podState(item), node: item.spec?.['nodeName'] } : {}),
        ...(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(input.kind)
          ? { replicas: `${item.status?.['readyReplicas'] ?? 0}/${item.spec?.['replicas'] ?? 0}` }
          : {}),
      }));
  }),

  tool('get_resource', 'One object in full (managedFields removed). This is what kubectl get -o yaml shows.', 'read', { context: ctx, kind, name: z.string(), namespace: ns }, async (input, context) => {
    const resource = resolveResource(input.kind);
    if (!resource) throw new Error(`unknown kind ${input.kind}`);
    const connection = context.registry.connect(input.context);
    const path = `${collectionPath(resource, resource.namespaced ? input.namespace : undefined)}/${encodeURIComponent(input.name)}`;
    return strip(await connection.json<Listed>(path));
  }),

  tool('describe_resource', 'An object plus the events about it, the way kubectl describe reads: summary, conditions, containers, events.', 'read', { context: ctx, kind, name: z.string(), namespace: ns }, async (input, context) => {
    const resource = resolveResource(input.kind);
    if (!resource) throw new Error(`unknown kind ${input.kind}`);
    const connection = context.registry.connect(input.context);
    const object = strip(await connection.json<Listed>(`${collectionPath(resource, resource.namespaced ? input.namespace : undefined)}/${encodeURIComponent(input.name)}`));
    const events = (await list(context, input.context, 'Event', input.namespace).catch((): Listed[] => [])) as Array<Listed & { involvedObject?: { name?: string; kind?: string }; reason?: string; message?: string; type?: string; lastTimestamp?: string; count?: number }>;
    return {
      object,
      ...(input.kind === 'Pod' ? { state: podState(object) } : {}),
      events: events
        .filter((e) => e.involvedObject?.name === input.name && e.involvedObject?.kind === input.kind)
        .sort((a, b) => (b.lastTimestamp ?? '').localeCompare(a.lastTimestamp ?? ''))
        .slice(0, 30)
        .map((e) => ({ type: e.type, reason: e.reason, message: e.message, count: e.count, last: e.lastTimestamp })),
    };
  }),

  tool('get_events', 'Recent events, newest first. Warnings only by default.', 'read', { context: ctx, namespace: ns, includeNormal: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() }, async (input, context) => {
    const events = (await list(context, input.context, 'Event', input.namespace)) as Array<Listed & { involvedObject?: { name?: string; kind?: string; namespace?: string }; reason?: string; message?: string; type?: string; lastTimestamp?: string; count?: number }>;
    return events
      .filter((e) => input.includeNormal || e.type !== 'Normal')
      .sort((a, b) => (b.lastTimestamp ?? '').localeCompare(a.lastTimestamp ?? ''))
      .slice(0, input.limit ?? 100)
      .map((e) => ({ type: e.type, reason: e.reason, object: `${e.involvedObject?.kind ?? ''}/${e.involvedObject?.name ?? ''}`, namespace: e.involvedObject?.namespace ?? e.metadata?.namespace, message: e.message, count: e.count, last: e.lastTimestamp }));
  }),

  tool('get_pod_logs', 'Log lines from a pod container. Use previous=true after a crash to read the exited container.', 'read', { context: ctx, namespace: z.string(), pod: z.string(), container: z.string().optional(), previous: z.boolean().optional(), tailLines: z.number().int().min(1).max(5000).optional(), grep: z.string().optional().describe('Only lines containing this text (case-insensitive)') }, async (input, context) => {
    const connection = context.registry.connect(input.context);
    const lines = await connection.readLogs({
      namespace: input.namespace,
      pod: input.pod,
      ...(input.container ? { container: input.container } : {}),
      ...(input.previous !== undefined ? { previous: input.previous } : {}),
      tailLines: input.tailLines ?? 300,
    });
    const needle = input.grep?.toLowerCase();
    return lines
      .filter((line) => !needle || line.message.toLowerCase().includes(needle))
      .map((line) => `${line.timestamp?.toISOString() ?? ''} ${line.message}`)
      .join('\n');
  }),

  tool('get_pod_metrics', 'Current and recent CPU (cores) and memory (bytes) for pods, from metrics.k8s.io or the demo generator.', 'read', { context: ctx, namespace: ns, pod: z.string().optional() }, async (input, context) => {
    if (input.context === 'demo') {
      const all = demoPodMetrics().filter((s) => !input.pod || s.name === input.pod);
      const now = latest(all);
      return all.map((s) => ({ pod: s.name, cpu: now[s.name]?.cpu, memory: now[s.name]?.memory }));
    }
    const connection = context.registry.connect(input.context);
    const path = input.namespace ? `/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(input.namespace)}/pods` : '/apis/metrics.k8s.io/v1beta1/pods';
    const result = await connection.json<{ items?: Array<{ metadata?: { name?: string; namespace?: string }; containers?: Array<{ name?: string; usage?: { cpu?: string; memory?: string } }> }> }>(path);
    return (result.items ?? []).filter((i) => !input.pod || i.metadata?.name === input.pod).map((i) => ({ pod: i.metadata?.name, namespace: i.metadata?.namespace, containers: i.containers?.map((c) => ({ name: c.name, ...c.usage })) }));
  }),

  tool('get_node_metrics', 'Current CPU and memory usage per node.', 'read', { context: ctx }, async (input, context) => {
    if (input.context === 'demo') {
      const all = demoNodeMetrics();
      const now = latest(all);
      return all.map((s) => ({ node: s.name, cpu: now[s.name]?.cpu, memory: now[s.name]?.memory }));
    }
    const connection = context.registry.connect(input.context);
    const result = await connection.json<{ items?: Array<{ metadata?: { name?: string }; usage?: { cpu?: string; memory?: string } }> }>('/apis/metrics.k8s.io/v1beta1/nodes');
    return (result.items ?? []).map((i) => ({ node: i.metadata?.name, ...i.usage }));
  }),

  tool('get_node_pods', 'Pods scheduled on one node.', 'read', { context: ctx, node: z.string() }, async (input, context) =>
    (await list(context, input.context, 'Pod')).filter((p) => p.spec?.['nodeName'] === input.node).map((p) => ({ name: p.metadata?.name, namespace: p.metadata?.namespace, ...podState(p) })),
  ),

  tool('get_topology', 'Services and the pods each one selects, plus which workload owns each pod. The shape of an application.', 'read', { context: ctx, namespace: ns }, async (input, context) => {
    const [services, pods] = await Promise.all([list(context, input.context, 'Service', input.namespace), list(context, input.context, 'Pod', input.namespace)]);
    return services.map((svc) => {
      const selector = (svc.spec?.['selector'] as Record<string, string> | undefined) ?? {};
      const matched = Object.keys(selector).length ? pods.filter((p) => p.metadata?.namespace === svc.metadata?.namespace && Object.entries(selector).every(([k, v]) => p.metadata?.labels?.[k] === v)) : [];
      return {
        service: svc.metadata?.name,
        namespace: svc.metadata?.namespace,
        type: svc.spec?.['type'],
        ports: svc.spec?.['ports'],
        pods: matched.map((p) => ({ name: p.metadata?.name, owner: p.metadata?.ownerReferences?.[0] ? `${p.metadata.ownerReferences[0].kind}/${p.metadata.ownerReferences[0].name}` : undefined, status: podState(p).status })),
      };
    });
  }),

  tool('get_rbac', 'Roles and bindings that mention a subject (user, group or service account), or all bindings when no subject is given.', 'read', { context: ctx, subject: z.string().optional(), namespace: ns }, async (input, context) => {
    type Binding = Listed & { subjects?: Array<{ kind?: string; name?: string; namespace?: string }>; roleRef?: { kind?: string; name?: string } };
    const [rb, crb] = await Promise.all([list(context, input.context, 'RoleBinding', input.namespace).catch((): Listed[] => []), list(context, input.context, 'ClusterRoleBinding').catch((): Listed[] => [])]);
    const all = [...(rb as Binding[]), ...(crb as Binding[])];
    return all
      .filter((b) => !input.subject || b.subjects?.some((s) => s.name === input.subject))
      .map((b) => ({ binding: `${b.roleRef?.kind === 'ClusterRole' && !b.metadata?.namespace ? 'ClusterRoleBinding' : 'RoleBinding'}/${b.metadata?.name}`, namespace: b.metadata?.namespace, role: `${b.roleRef?.kind}/${b.roleRef?.name}`, subjects: b.subjects }));
  }),

  tool('list_storage', 'PersistentVolumeClaims with their bound volumes, size and storage class.', 'read', { context: ctx, namespace: ns }, async (input, context) =>
    (await list(context, input.context, 'PersistentVolumeClaim', input.namespace)).map((pvc) => ({ name: pvc.metadata?.name, namespace: pvc.metadata?.namespace, phase: pvc.status?.['phase'], volume: pvc.spec?.['volumeName'], storageClass: pvc.spec?.['storageClassName'], capacity: (pvc.status?.['capacity'] as Record<string, string> | undefined)?.['storage'] })),
  ),

  tool('list_helm_releases', 'Helm releases (current revision each) read from their release Secrets: chart, versions, status, when deployed.', 'read', { context: ctx, namespace: ns }, async (input, context) => {
    const secrets = (await list(context, input.context, 'Secret', input.namespace)) as unknown as HelmSecretShape[];
    return latestHelmReleases(secrets).map((r) => ({ name: r.name, namespace: r.namespace, revision: r.revision, status: r.status, chart: `${r.chart.name}-${r.chart.version}`, appVersion: r.chart.appVersion, lastDeployed: r.lastDeployed, description: r.description }));
  }),

  tool('get_helm_release', 'One Helm release: history of revisions, the values the user set, the rendered manifest and the notes. Like helm get all plus helm history.', 'read', { context: ctx, namespace: z.string(), name: z.string(), revision: z.number().int().optional() }, async (input, context) => {
    const secrets = (await list(context, input.context, 'Secret', input.namespace)) as unknown as HelmSecretShape[];
    const revisions = decodeHelmReleases(secrets).filter((r) => r.name === input.name && r.namespace === input.namespace);
    if (!revisions.length) throw new Error(`no Helm release ${input.namespace}/${input.name}`);
    const chosen = input.revision ? revisions.find((r) => r.revision === input.revision) : revisions[0];
    if (!chosen) throw new Error(`no revision ${input.revision} of ${input.name}`);
    return {
      release: { name: chosen.name, namespace: chosen.namespace, revision: chosen.revision, status: chosen.status, chart: chosen.chart, lastDeployed: chosen.lastDeployed, description: chosen.description, notes: chosen.notes },
      history: revisions.map((r) => ({ revision: r.revision, status: r.status, chart: `${r.chart.name}-${r.chart.version}`, appVersion: r.chart.appVersion, updated: r.lastDeployed, description: r.description })),
      values: chosen.values,
      manifest: chosen.manifest,
    };
  }),

  tool('list_crds', 'CustomResourceDefinitions installed in the cluster.', 'read', { context: ctx }, async (input, context) => {
    const connection = context.registry.connect(input.context);
    const result = await connection.json<{ items?: Array<{ metadata?: { name?: string }; spec?: { group?: string; names?: { kind?: string; plural?: string }; scope?: string; versions?: Array<{ name?: string; served?: boolean }> } }> }>('/apis/apiextensions.k8s.io/v1/customresourcedefinitions');
    return (result.items ?? []).map((crd) => ({ name: crd.metadata?.name, group: crd.spec?.group, kind: crd.spec?.names?.kind, plural: crd.spec?.names?.plural, scope: crd.spec?.scope, versions: crd.spec?.versions?.filter((v) => v.served).map((v) => v.name) }));
  }),

  tool('raw_get', 'GET any API path, for custom resources and anything not covered above, e.g. /apis/cert-manager.io/v1/certificates.', 'read', { context: ctx, path: z.string().regex(/^\/(api|apis)\//, 'must start with /api/ or /apis/') }, async (input, context) => {
    const result = await context.registry.connect(input.context).json<{ items?: Listed[] }>(input.path);
    return Array.isArray(result.items) ? { ...result, items: result.items.map(strip) } : result;
  }),

  tool('apply_yaml', 'Create or replace one object from a YAML document (kubectl apply -f).', 'write', { context: ctx, yaml: z.string() }, async (input, context) => {
    const object = parseYaml(input.yaml) as Listed & { kind?: string };
    if (!object?.kind || !object.metadata?.name) throw new Error('YAML needs kind and metadata.name');
    const resource = resolveResource(object.kind);
    if (!resource) throw new Error(`unknown kind ${object.kind}`);
    const namespace = resource.namespaced ? object.metadata.namespace : undefined;
    if (resource.namespaced && !namespace) throw new Error(`${object.kind} needs metadata.namespace`);
    const connection = context.registry.connect(input.context);
    const path = `${collectionPath(resource, namespace)}/${encodeURIComponent(object.metadata.name)}`;
    try {
      await connection.json(path);
      return strip(await connection.replace<Listed>(path, object));
    } catch {
      return strip(await connection.create<Listed>(collectionPath(resource, namespace), object));
    }
  }),

  tool('patch_resource', 'JSON merge patch one object (kubectl patch --type merge). Send only the fields that change; null removes a key.', 'write', { context: ctx, kind, name: z.string(), namespace: ns, patch: z.record(z.string(), z.unknown()) }, async (input, context) => {
    const resource = resolveResource(input.kind);
    if (!resource) throw new Error(`unknown kind ${input.kind}`);
    const path = `${collectionPath(resource, resource.namespaced ? input.namespace : undefined)}/${encodeURIComponent(input.name)}`;
    return strip(await context.registry.connect(input.context).patch<Listed>(path, input.patch));
  }),

  tool('delete_resource', 'Delete one object.', 'write', { context: ctx, kind, name: z.string(), namespace: ns }, async (input, context) => {
    const resource = resolveResource(input.kind);
    if (!resource) throw new Error(`unknown kind ${input.kind}`);
    const path = `${collectionPath(resource, resource.namespaced ? input.namespace : undefined)}/${encodeURIComponent(input.name)}`;
    return context.registry.connect(input.context).remove(path);
  }),

  tool('scale_workload', 'Set replicas on a Deployment, StatefulSet or ReplicaSet.', 'write', { context: ctx, kind: z.enum(['Deployment', 'StatefulSet', 'ReplicaSet']), name: z.string(), namespace: z.string(), replicas: z.number().int().min(0) }, async (input, context) => {
    const resource = resolveResource(input.kind);
    if (!resource) throw new Error(`unknown kind ${input.kind}`);
    const path = `${collectionPath(resource, input.namespace)}/${encodeURIComponent(input.name)}`;
    const result = await context.registry.connect(input.context).patch<Listed>(path, { spec: { replicas: input.replicas } });
    return { name: input.name, replicas: result.spec?.['replicas'] };
  }),

  tool('rollout_restart', 'Restart a Deployment, StatefulSet or DaemonSet rollout (kubectl rollout restart).', 'write', { context: ctx, kind: z.enum(['Deployment', 'StatefulSet', 'DaemonSet']), name: z.string(), namespace: z.string() }, async (input, context) => {
    const resource = resolveResource(input.kind);
    if (!resource) throw new Error(`unknown kind ${input.kind}`);
    const path = `${collectionPath(resource, input.namespace)}/${encodeURIComponent(input.name)}`;
    await context.registry.connect(input.context).patch(path, { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } } });
    return { restarted: `${input.kind}/${input.name}` };
  }),

  tool('port_forward', 'Forward a pod port to localhost; returns the local port. Use list_port_forwards and stop_port_forward to manage them.', 'write', { context: ctx, namespace: z.string(), pod: z.string(), port: z.number().int().min(1).max(65535), localPort: z.number().int().min(1).max(65535).optional() }, async (input, context) =>
    context.forwards.start({ context: input.context, namespace: input.namespace, pod: input.pod, port: input.port, ...(input.localPort ? { localPort: input.localPort } : {}) }),
  ),

  tool('list_port_forwards', 'Active port forwards.', 'read', {}, async (_input, context) => context.forwards.list()),

  tool('stop_port_forward', 'Stop a port forward by id (from list_port_forwards).', 'write', { id: z.string() }, async (input, context) => ({ stopped: await context.forwards.stop(input.id) })),
] as const;
