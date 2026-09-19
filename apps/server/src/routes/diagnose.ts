import { Router } from 'express';
import { diagnose, type DiagnoseInput, type KubeEvent, type NodeObject, type PodObject, type WorkloadObject } from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from '../clusters.ts';
import type { FlagStore } from '../flags.ts';
import { HttpError, handle, param, query } from '../http.ts';

const log = logger.child('diagnose');

/**
 * "What broke?", server side.
 *
 * Every input is already something this app can read; the work is reading all
 * of it at once. A person doing this by hand runs six kubectl commands, holds
 * the timestamps in their head, and gets it right about half the time at two
 * in the morning. This runs the six in parallel and does the correlation.
 *
 * Scoped three ways, and the scope decides what is fetched rather than what is
 * filtered afterwards: asking about one deployment should not pull every pod
 * in the cluster.
 */
export function diagnoseRoutes(registry: ClusterRegistry, flags: FlagStore): Router {
  const router = Router();

  router.get(
    '/:context',
    handle(async (req, res) => {
      if (!flags.value('kubernetes.diagnose')) {
        throw new HttpError(404, 'not-found', 'the diagnosis tool is switched off in this build');
      }

      const contextName = param(req, 'context');
      const namespace = query(req, 'namespace') ?? '';
      const kind = query(req, 'kind') ?? '';
      const name = query(req, 'name') ?? '';
      const connection = registry.connect(contextName);

      const started = Date.now();
      const input = await gather(connection, { namespace, kind, name });
      const result = diagnose({ ...input, now: Date.now() });

      log.info('diagnosed', {
        context: contextName,
        scope: name ? `${kind}/${name}` : namespace || 'cluster',
        findings: result.findings.length,
        ms: Date.now() - started,
      });
      res.json({ ...result, scope: { namespace: namespace || null, kind: kind || null, name: name || null } });
    }),
  );

  return router;
}

interface Json {
  json<T = unknown>(path: string): Promise<T>;
}

interface Scope {
  readonly namespace: string;
  readonly kind: string;
  readonly name: string;
}

/**
 * Everything the rules need, fetched at once.
 *
 * `allSettled` rather than `all`, deliberately. A token that cannot list nodes
 * is the normal case for a namespace-scoped user, and a diagnosis that refuses
 * to run because one of six reads was forbidden is worthless to exactly the
 * people most likely to be running with a restricted token. Every rule already
 * treats missing input as nothing to say.
 */
async function gather(connection: Json, scope: Scope): Promise<DiagnoseInput> {
  const namespace = scope.namespace;
  const base = namespace ? `/api/v1/namespaces/${encodeURIComponent(namespace)}` : '/api/v1';
  const appsBase = namespace ? `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}` : '/apis/apps/v1';

  const [events, pods, nodes, replicaSets, deployments, configMaps, secrets] = await Promise.allSettled([
    // Events are capped server side at an hour by default, and this asks for
    // the tail rather than the whole ring buffer.
    connection.json<{ items?: KubeEvent[] }>(`${base}/events?limit=500`),
    connection.json<{ items?: PodObject[] }>(`${base}/pods?limit=500`),
    connection.json<{ items?: NodeObject[] }>('/api/v1/nodes?limit=200'),
    connection.json<{ items?: Array<{ metadata?: { name?: string; namespace?: string; creationTimestamp?: string } }> }>(`${appsBase}/replicasets?limit=200`),
    connection.json<{ items?: WorkloadObject[] }>(`${appsBase}/deployments?limit=200`),
    connection.json<{ items?: Array<{ metadata?: unknown }> }>(`${base}/configmaps?limit=200`),
    // Secrets carry their data, which we neither want nor should move. The
    // metadata is all any rule here reads, and asking for only that keeps
    // every secret value out of this process entirely.
    connection.json<{ items?: Array<{ metadata?: unknown }> }>(`${base}/secrets?limit=200`),
  ]);

  const settle = <T,>(result: PromiseSettledResult<{ items?: T[] }>): T[] => {
    if (result.status === 'fulfilled') return result.value.items ?? [];
    log.debug('a source was unavailable, carrying on without it', { error: String(result.reason) });
    return [];
  };

  const allPods = settle(pods);
  const scoped = narrow(allPods, scope);

  return {
    events: narrowEvents(settle(events), scope, scoped),
    pods: scoped,
    nodes: settle(nodes),
    workloads: settle<WorkloadObject>(deployments).filter((workload) => matches(workload.metadata?.name, scope)),
    replicaSets: settle(replicaSets) as NonNullable<DiagnoseInput['replicaSets']>,
    configs: [
      ...settle(configMaps).map((item) => ({ kind: 'ConfigMap', metadata: item.metadata as never })),
      ...settle(secrets).map((item) => ({ kind: 'Secret', metadata: item.metadata as never })),
    ],
  };
}

/**
 * The pods this question is about.
 *
 * A named workload means its pods, found by owner chain rather than by a label
 * guess: `app=name` is a convention, not a rule, and a chart that names its
 * labels differently would silently return nothing.
 */
function narrow(pods: readonly PodObject[], scope: Scope): PodObject[] {
  if (!scope.name) return [...pods];
  const wanted = scope.name.toLowerCase();
  return pods.filter((pod) => {
    const podName = pod.metadata?.name?.toLowerCase() ?? '';
    if (scope.kind.toLowerCase() === 'pod') return podName === wanted;
    // A deployment owns a replica set which owns the pod, and the replica set
    // is named `<deployment>-<hash>`, so the pod is `<deployment>-<hash>-<id>`.
    if (podName.startsWith(`${wanted}-`)) return true;
    return (pod.metadata?.ownerReferences ?? []).some((owner) => owner.name?.toLowerCase().startsWith(wanted));
  });
}

/** Events about the thing asked about, or about the pods underneath it. */
function narrowEvents(events: readonly KubeEvent[], scope: Scope, pods: readonly PodObject[]): KubeEvent[] {
  if (!scope.name) return [...events];
  const names = new Set([scope.name.toLowerCase(), ...pods.map((pod) => pod.metadata?.name?.toLowerCase() ?? '')]);
  return events.filter((event) => {
    const involved = event.involvedObject?.name?.toLowerCase() ?? '';
    // A replica set's events belong to its deployment as far as anyone asking
    // "what broke" is concerned.
    return names.has(involved) || involved.startsWith(`${scope.name.toLowerCase()}-`);
  });
}

function matches(name: string | undefined, scope: Scope): boolean {
  if (!scope.name) return true;
  return (name ?? '').toLowerCase() === scope.name.toLowerCase();
}
