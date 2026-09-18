import { api } from './api.ts';
import type { KubeItem } from '../components/columns.tsx';

/**
 * The write operations, named the way kubectl names them.
 *
 * Each one reads the object it will change, computes the new shape, and sends
 * a merge patch of just that part. Arrays are sent whole, because a merge
 * patch replaces arrays, so a container edit is "this pod's containers, with
 * one field changed", never a fragment the server would take as the full list.
 *
 * Container fields on a running pod are immutable except the image, so edits
 * to a pod route to the workload that owns it: pod → ReplicaSet → Deployment.
 * That is what `kubectl set image deployment/…` does, and it is the only edit
 * that survives the next rollout.
 */

interface Owner {
  readonly kind?: string;
  readonly name?: string;
  readonly controller?: boolean;
}

interface Container {
  name?: string;
  image?: string;
  env?: Array<{ name?: string; value?: string; valueFrom?: unknown }>;
  resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
  [key: string]: unknown;
}

export interface ContainerChange {
  readonly image?: string;
  readonly env?: Record<string, string>;
  readonly resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
}

export interface ControllerRef {
  readonly kind: string;
  readonly name: string;
  readonly namespace: string;
}

const ROUTES_TO_TEMPLATE = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob']);

function controllerOf(item: KubeItem): Owner | undefined {
  const owners = (item.metadata as { ownerReferences?: Owner[] } | undefined)?.ownerReferences ?? [];
  return owners.find((owner) => owner.controller) ?? owners[0];
}

/** The workload that owns a pod, following ReplicaSet up to its Deployment. */
export async function resolveController(context: string, pod: KubeItem): Promise<ControllerRef | null> {
  const namespace = pod.metadata?.namespace ?? '';
  const owner = controllerOf(pod);
  if (!owner?.kind || !owner.name) return null;
  if (owner.kind === 'ReplicaSet') {
    try {
      const rs = await api.get<KubeItem>(context, 'ReplicaSet', owner.name, namespace);
      const parent = controllerOf(rs);
      if (parent?.kind && parent.name) return { kind: parent.kind, name: parent.name, namespace };
    } catch {
      // A ReplicaSet with no reachable parent is edited directly below.
    }
  }
  return { kind: owner.kind, name: owner.name, namespace };
}

function applyChange(container: Container, change: ContainerChange): Container {
  const next: Container = { ...container };
  if (change.image !== undefined) next.image = change.image;
  if (change.env) {
    const env = [...(container.env ?? [])];
    for (const [name, value] of Object.entries(change.env)) {
      const index = env.findIndex((entry) => entry.name === name);
      if (index === -1) env.push({ name, value });
      else env[index] = { name, value };
    }
    next.env = env;
  }
  if (change.resources) {
    next.resources = {
      ...(container.resources ?? {}),
      ...(change.resources.requests
        ? { requests: { ...(container.resources?.requests ?? {}), ...change.resources.requests } }
        : {}),
      ...(change.resources.limits ? { limits: { ...(container.resources?.limits ?? {}), ...change.resources.limits } } : {}),
    };
  }
  return next;
}

/**
 * Edits one container's fields, on the workload that owns the pod when there
 * is one. Returns a sentence saying where the change landed.
 */
export async function editContainer(
  context: string,
  pod: KubeItem,
  containerName: string,
  change: ContainerChange,
): Promise<string> {
  const namespace = pod.metadata?.namespace ?? '';
  const controller = await resolveController(context, pod);

  if (controller && ROUTES_TO_TEMPLATE.has(controller.kind)) {
    const workload = await api.get<{ spec?: { template?: { spec?: { containers?: Container[] } }; jobTemplate?: unknown } }>(
      context,
      controller.kind,
      controller.name,
      namespace,
    );
    const containers = workload.spec?.template?.spec?.containers ?? [];
    if (!containers.some((c) => c.name === containerName)) {
      throw new Error(`${controller.kind} ${controller.name} has no container named ${containerName}`);
    }
    const next = containers.map((c) => (c.name === containerName ? applyChange(c, change) : c));
    await api.patch(context, controller.kind, controller.name, { spec: { template: { spec: { containers: next } } } }, namespace);
    return `Updated ${controller.kind.toLowerCase()} ${controller.name}, rolling out`;
  }

  // A bare pod: only the image can change on a live pod.
  if (change.env || change.resources) {
    throw new Error('env and resources cannot change on a running pod without a controller; edit the workload or recreate it');
  }
  const spec = pod.spec as { containers?: Container[] } | undefined;
  const containers = spec?.containers ?? [];
  const next = containers.map((c) => (c.name === containerName ? applyChange(c, change) : c));
  await api.patch(context, 'Pod', pod.metadata?.name ?? '', { spec: { containers: next } }, namespace);
  return `Updated pod ${pod.metadata?.name ?? ''}`;
}

interface ReplicaSetShape extends KubeItem {
  metadata?: KubeItem['metadata'] & { annotations?: Record<string, string>; ownerReferences?: Owner[] };
  spec?: { template?: { metadata?: { labels?: Record<string, string> }; spec?: unknown } };
}

/** `kubectl rollout undo`: the previous ReplicaSet's template becomes current. */
export async function rolloutUndo(context: string, deployment: KubeItem): Promise<string> {
  const name = deployment.metadata?.name ?? '';
  const namespace = deployment.metadata?.namespace ?? '';
  const list = await api.list<ReplicaSetShape>(context, 'ReplicaSet', namespace);
  const owned = list.items
    .filter((rs) => rs.metadata?.ownerReferences?.some((owner) => owner.kind === 'Deployment' && owner.name === name))
    .map((rs) => ({ rs, revision: Number(rs.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? 0) }))
    .sort((a, b) => b.revision - a.revision);
  const previous = owned[1];
  if (!previous?.rs.spec?.template) throw new Error(`${name} has no previous revision to roll back to`);
  const template = structuredClone(previous.rs.spec.template) as { metadata?: { labels?: Record<string, string> } };
  if (template.metadata?.labels) delete template.metadata.labels['pod-template-hash'];
  await api.patch(context, 'Deployment', name, { spec: { template } }, namespace);
  return `Rolled ${name} back to revision ${previous.revision}`;
}

/** `kubectl cordon` / `uncordon`. */
export async function setSchedulable(context: string, node: KubeItem, schedulable: boolean): Promise<void> {
  await api.patch(context, 'Node', node.metadata?.name ?? '', { spec: { unschedulable: schedulable ? null : true } });
}

interface PodShape extends KubeItem {
  metadata?: KubeItem['metadata'] & { ownerReferences?: Owner[] };
  spec?: { nodeName?: string };
}

/**
 * `kubectl drain`: cordon, then evict every pod that is not a DaemonSet's or
 * a static pod. Returns how many were evicted.
 */
export async function drainNode(context: string, node: KubeItem): Promise<number> {
  const nodeName = node.metadata?.name ?? '';
  await setSchedulable(context, node, false);
  const pods = await api.list<PodShape>(context, 'Pod');
  const targets = pods.items.filter((pod) => {
    if (pod.spec?.nodeName !== nodeName) return false;
    const owner = pod.metadata?.ownerReferences?.find((o) => o.controller);
    return owner?.kind !== 'DaemonSet' && owner?.kind !== 'Node';
  });
  await Promise.all(targets.map((pod) => api.evict(context, pod.metadata?.namespace ?? '', pod.metadata?.name ?? '')));
  return targets.length;
}

export interface Taint {
  readonly key: string;
  readonly value?: string;
  readonly effect: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute';
}

/** `kubectl taint`: the full list is sent, so removing is a shorter list. */
export async function setTaints(context: string, node: KubeItem, taints: readonly Taint[]): Promise<void> {
  await api.patch(context, 'Node', node.metadata?.name ?? '', { spec: { taints: taints.length ? taints : null } });
}

/** `kubectl rollout pause` / `resume`. */
export async function setPaused(context: string, deployment: KubeItem, paused: boolean): Promise<void> {
  await api.patch(
    context,
    'Deployment',
    deployment.metadata?.name ?? '',
    { spec: { paused: paused ? true : null } },
    deployment.metadata?.namespace,
  );
}
