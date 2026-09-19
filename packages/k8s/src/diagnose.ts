/**
 * What broke, and what broke it.
 *
 * Everything here is already in hand: events, pod statuses, node conditions,
 * replica sets, the previous container's last exit. The work is not fetching
 * it, it is deciding what matters and saying so in the order a person would
 * want to read it.
 *
 * ## The two rules
 *
 * **The first cause goes on top, not the loudest symptom.** A cluster with a
 * bad config map produces forty CrashLoopBackOff events and one
 * `CreateContainerConfigError`, and `kubectl get events` sorts them so the
 * forty bury the one. Findings here carry a `cause` rank: a change that
 * preceded a failure outranks the failure, and a failure outranks the backoff
 * it produced.
 *
 * **Every term is explained where it appears.** "BackOff" is not a word, it
 * is Kubernetes telling you it is waiting longer each time before retrying,
 * and a person looking at a broken cluster at two in the morning should not
 * have to know that. Each finding carries a plain sentence, the evidence it
 * was drawn from, and the thing to do next.
 *
 * This file is pure. It takes objects and returns findings, so every rule is
 * tested against a fixture rather than a cluster.
 */

export interface KubeMeta {
  readonly name?: string;
  readonly namespace?: string;
  readonly uid?: string;
  readonly creationTimestamp?: string;
  readonly labels?: Record<string, string>;
  readonly annotations?: Record<string, string>;
  readonly ownerReferences?: ReadonlyArray<{ kind?: string; name?: string; uid?: string; controller?: boolean }>;
  readonly managedFields?: ReadonlyArray<{ manager?: string; operation?: string; time?: string }>;
}

export interface KubeEvent {
  readonly metadata?: KubeMeta;
  readonly type?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly count?: number;
  readonly firstTimestamp?: string | null;
  readonly lastTimestamp?: string | null;
  readonly eventTime?: string | null;
  readonly involvedObject?: { kind?: string; name?: string; namespace?: string; uid?: string; fieldPath?: string };
  readonly source?: { component?: string; host?: string };
  readonly reportingComponent?: string;
}

export interface ContainerState {
  readonly waiting?: { reason?: string; message?: string };
  readonly running?: { startedAt?: string };
  readonly terminated?: { reason?: string; message?: string; exitCode?: number; startedAt?: string; finishedAt?: string; signal?: number };
}

export interface ContainerStatus {
  readonly name?: string;
  readonly ready?: boolean;
  readonly started?: boolean;
  readonly restartCount?: number;
  readonly image?: string;
  readonly state?: ContainerState;
  readonly lastState?: ContainerState;
}

export interface PodObject {
  readonly metadata?: KubeMeta;
  readonly spec?: {
    readonly nodeName?: string;
    readonly containers?: ReadonlyArray<{
      name?: string;
      image?: string;
      resources?: { limits?: Record<string, string>; requests?: Record<string, string> };
      livenessProbe?: unknown;
      readinessProbe?: unknown;
      env?: ReadonlyArray<{
        name?: string;
        valueFrom?: { configMapKeyRef?: { name?: string; key?: string }; secretKeyRef?: { name?: string; key?: string } };
      }>;
      envFrom?: ReadonlyArray<{ configMapRef?: { name?: string }; secretRef?: { name?: string } }>;
    }>;
    readonly volumes?: ReadonlyArray<{ name?: string; configMap?: { name?: string }; secret?: { secretName?: string }; persistentVolumeClaim?: { claimName?: string } }>;
  };
  readonly status?: {
    readonly phase?: string;
    readonly reason?: string;
    readonly message?: string;
    readonly startTime?: string;
    readonly containerStatuses?: readonly ContainerStatus[];
    readonly initContainerStatuses?: readonly ContainerStatus[];
    readonly conditions?: ReadonlyArray<{ type?: string; status?: string; reason?: string; message?: string; lastTransitionTime?: string }>;
  };
}

export interface NodeObject {
  readonly metadata?: KubeMeta;
  readonly status?: {
    readonly conditions?: ReadonlyArray<{ type?: string; status?: string; reason?: string; message?: string; lastTransitionTime?: string }>;
    readonly allocatable?: Record<string, string>;
  };
  readonly spec?: { readonly unschedulable?: boolean; readonly taints?: ReadonlyArray<{ key?: string; effect?: string; value?: string }> };
}

export interface WorkloadObject {
  readonly kind?: string;
  readonly metadata?: KubeMeta;
  readonly spec?: { readonly replicas?: number };
  readonly status?: {
    readonly replicas?: number;
    readonly readyReplicas?: number;
    readonly availableReplicas?: number;
    readonly unavailableReplicas?: number;
    readonly updatedReplicas?: number;
    readonly conditions?: ReadonlyArray<{ type?: string; status?: string; reason?: string; message?: string; lastTransitionTime?: string }>;
  };
}

/** Whatever the failing thing is: a workload, a namespace, or the cluster. */
export interface DiagnoseInput {
  readonly now?: number;
  readonly events?: readonly KubeEvent[];
  readonly pods?: readonly PodObject[];
  readonly nodes?: readonly NodeObject[];
  readonly workloads?: readonly WorkloadObject[];
  /** ConfigMaps and Secrets the pods mount, so a change can be dated. */
  readonly configs?: ReadonlyArray<{ kind: string; metadata?: KubeMeta }>;
  /** ReplicaSets, so a rollout can be dated without a separate history call. */
  readonly replicaSets?: ReadonlyArray<{ metadata?: KubeMeta; spec?: { replicas?: number }; status?: { replicas?: number } }>;
}

export type Severity = 'critical' | 'warning' | 'info';

export interface EvidenceLine {
  /** Where this came from, named so nothing in the panel is unattributed. */
  readonly source: string;
  readonly text: string;
  readonly at?: string | undefined;
}

export interface FindingAction {
  readonly label: string;
  readonly kind: 'logs' | 'previous-logs' | 'open' | 'events' | 'describe' | 'nodes';
  readonly target?: { kind: string; name: string; namespace?: string | undefined; container?: string | undefined } | undefined;
}

export interface Finding {
  readonly id: string;
  readonly rule: string;
  readonly severity: Severity;
  /** Short, and in the words of the person looking, not the API's. */
  readonly title: string;
  /** What it means, spelled out. No unexplained Kubernetes vocabulary. */
  readonly detail: string;
  /** What to do about it, when there is a clear answer. Omitted when there is not. */
  readonly fix?: string | undefined;
  readonly object: { kind: string; name: string; namespace?: string | undefined };
  readonly at?: string | undefined;
  readonly evidence: readonly EvidenceLine[];
  readonly actions: readonly FindingAction[];
  /**
   * How close to the root this is. Lower is closer.
   *
   * 0 a change someone made, 1 a thing that failed, 2 the retry loop that
   * followed, 3 background noise. This is the whole ordering trick: the
   * config map that was edited four minutes before everything caught fire
   * sorts above the four hundred backoff events it caused.
   */
  readonly cause: number;
  /**
   * Findings sharing this are the same problem, seen on more than one pod.
   *
   * Three replicas of a broken deployment produce three identical findings,
   * and a panel that lists them three times is a panel nobody reads twice.
   * They collapse into one, keyed on the workload rather than the pod.
   */
  readonly group?: string | undefined;
  /** Every object this covers once collapsed. One entry when it is just the one. */
  readonly affected?: readonly string[] | undefined;
}

export interface TimelineEntry {
  readonly at: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  readonly object: { kind: string; name: string; namespace?: string | undefined };
}

export interface Diagnosis {
  readonly findings: readonly Finding[];
  readonly timeline: readonly TimelineEntry[];
  /** One sentence for the top of the panel. Never "3 issues found". */
  readonly summary: string;
  readonly healthy: boolean;
  /** Counts, for the chips above the list. */
  readonly counts: { critical: number; warning: number; info: number };
}

const MINUTE = 60_000;

/** Everything is judged against a window; older news is not news. */
export const DEFAULT_WINDOW_MS = 60 * MINUTE;

export function diagnose(input: DiagnoseInput): Diagnosis {
  const now = input.now ?? Date.now();
  const findings: Finding[] = [];

  for (const rule of RULES) findings.push(...rule(input, now));
  const collapsed = collapse(findings);

  // First cause, then most recent, then severity. Sorting by time alone puts
  // the last backoff event above the deploy that caused it, which is exactly
  // the failure mode `kubectl get events --sort-by` has.
  const ranked = [...collapsed].sort((a, b) => {
    if (a.cause !== b.cause) return a.cause - b.cause;
    const bySeverity = weight(a.severity) - weight(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return time(b.at) - time(a.at);
  });

  const counts = {
    critical: ranked.filter((finding) => finding.severity === 'critical').length,
    warning: ranked.filter((finding) => finding.severity === 'warning').length,
    info: ranked.filter((finding) => finding.severity === 'info').length,
  };

  return {
    findings: ranked,
    timeline: buildTimeline(input, now),
    summary: summarise(ranked, counts),
    healthy: counts.critical === 0 && counts.warning === 0,
    counts,
  };
}

/**
 * The headline.
 *
 * Names the thing and what is wrong with it, because "3 issues found" is a
 * count, not an answer, and the person already knew there were issues.
 */
function summarise(findings: readonly Finding[], counts: Diagnosis['counts']): string {
  const first = findings[0];
  if (!first) return 'Nothing is failing here right now.';
  const others = findings.length - 1;
  const tail =
    others === 0
      ? ''
      : others === 1
        ? ', and one other thing below'
        : ` and ${others} other things below`;
  const lead = counts.critical > 0 || first.severity === 'critical' ? first.title : first.title;
  return `${lead}${tail}.`;
}

/**
 * One problem, once.
 *
 * The first of a group wins, and the rest become names on it. Sorting happens
 * after, so which one survives does not change the order of anything.
 */
function collapse(findings: readonly Finding[]): Finding[] {
  const byGroup = new Map<string, Finding>();
  const result: Finding[] = [];
  for (const finding of findings) {
    if (!finding.group) {
      result.push({ ...finding, affected: [finding.object.name] });
      continue;
    }
    const existing = byGroup.get(finding.group);
    if (!existing) {
      const entry = { ...finding, affected: [finding.object.name] };
      byGroup.set(finding.group, entry);
      result.push(entry);
      continue;
    }
    const merged: Finding = { ...existing, affected: [...(existing.affected ?? []), finding.object.name] };
    byGroup.set(finding.group, merged);
    result[result.indexOf(existing)] = merged;
  }
  return result;
}

/**
 * The workload behind a pod.
 *
 * `api-8df977b79-fwqrj` belongs to ReplicaSet `api-8df977b79` which belongs to
 * Deployment `api`, and the deployment is what a person calls the thing. The
 * owner reference gives the replica set; the trailing hash comes off it.
 */
export function workloadOf(pod: PodObject): { kind: string; name: string } {
  const owner = pod.metadata?.ownerReferences?.find((reference) => reference.controller) ?? pod.metadata?.ownerReferences?.[0];
  if (owner?.kind === 'ReplicaSet' && owner.name) {
    /*
     * The suffix is Kubernetes' pod-template-hash, and it is written in an
     * alphabet with no vowels in it precisely so that it never spells a word.
     * Matching that alphabet rather than "any letters and digits" is what
     * keeps `payments-prod` from being read as `payments`.
     */
    return { kind: 'Deployment', name: owner.name.replace(/-[bcdfghjklmnpqrstvwxz2456789]{4,10}$/, '') };
  }
  if (owner?.kind && owner.name) return { kind: owner.kind, name: owner.name };
  return { kind: 'Pod', name: pod.metadata?.name ?? 'unknown' };
}

/**
 * "the api container in api" is how a template reads and not how a person does.
 *
 * Single-container workloads almost always name the container after the
 * workload, so the two halves collapse to one.
 */
function containerIn(container: string | undefined, workload: string): string {
  const name = container ?? 'A container';
  return name === workload ? workload : `${name} in ${workload}`;
}

function weight(severity: Severity): number {
  return severity === 'critical' ? 0 : severity === 'warning' ? 1 : 2;
}

function time(at?: string | undefined): number {
  return at ? Date.parse(at) || 0 : 0;
}

function eventAt(event: KubeEvent): string | undefined {
  return event.lastTimestamp ?? event.eventTime ?? event.firstTimestamp ?? event.metadata?.creationTimestamp ?? undefined;
}

function ref(object: { metadata?: KubeMeta } | undefined, kind: string): { kind: string; name: string; namespace?: string | undefined } {
  return { kind, name: object?.metadata?.name ?? 'unknown', namespace: object?.metadata?.namespace };
}

function recent(at: string | undefined, now: number, window = DEFAULT_WINDOW_MS): boolean {
  if (!at) return false;
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) && now - parsed <= window;
}

/** One line of evidence from an event, with its own count folded in. */
function fromEvent(event: KubeEvent): EvidenceLine {
  const repeated = (event.count ?? 1) > 1 ? ` (${event.count} times)` : '';
  return {
    source: `${event.reason ?? 'Event'} from ${event.source?.component ?? event.reportingComponent ?? 'the cluster'}${repeated}`,
    text: event.message ?? '',
    at: eventAt(event),
  };
}

type Rule = (input: DiagnoseInput, now: number) => Finding[];

// ---------------------------------------------------------------------------
// The rules. Each one answers a question somebody actually asks.
// ---------------------------------------------------------------------------

/**
 * A container that will not stay running.
 *
 * Reported against the *previous* exit rather than the current wait, because
 * "CrashLoopBackOff" tells you the kubelet is waiting and the exit code tells
 * you why it is waiting, and only one of those is useful.
 */
const crashLooping: Rule = (input) => {
  const findings: Finding[] = [];
  for (const pod of input.pods ?? []) {
    for (const status of [...(pod.status?.containerStatuses ?? []), ...(pod.status?.initContainerStatuses ?? [])]) {
      const waiting = status.state?.waiting;
      if (waiting?.reason !== 'CrashLoopBackOff') continue;

      const last = status.lastState?.terminated;
      const exit = last?.exitCode;
      const oom = last?.reason === 'OOMKilled';
      const signalled = typeof last?.signal === 'number' && last.signal > 0;

      const why = oom
        ? 'It ran out of memory and was killed.'
        : exit === 0
          ? 'It exited cleanly, which for a long-running container means it finished and had nothing left to do.'
          : exit === 1
            ? 'It exited with code 1, which almost always means the process itself failed on startup. The last logs say why.'
            : exit === 137
              ? 'It was killed with SIGKILL (code 137), usually a memory limit or a liveness probe that gave up on it.'
              : exit === 143
                ? 'It was asked to stop and did (code 143), so something outside the container decided to end it.'
                : signalled
                  ? `It was killed by signal ${last?.signal}.`
                  : typeof exit === 'number'
                    ? `It exited with code ${exit}.`
                    : 'It exited, and the cluster did not record why.';

      const workload = workloadOf(pod);
      findings.push({
        id: `crashloop:${pod.metadata?.namespace}/${pod.metadata?.name}/${status.name}`,
        rule: 'crash-looping',
        group: `crash-looping:${pod.metadata?.namespace}/${workload.name}/${status.name}`,
        severity: 'critical',
        // Named for the workload, not the pod: `api` is the thing that is
        // broken, and `api-8df977b79-fwqrj` is one of the three ways it shows.
        title: `${containerIn(status.name, workload.name)} keeps crashing`,
        // "BackOff" is the single most common unexplained word in Kubernetes.
        detail: `${why} Kubernetes has restarted it ${status.restartCount ?? 0} time${status.restartCount === 1 ? '' : 's'} and is now waiting longer between each try, which is what "CrashLoopBackOff" means.`,
        fix: oom
          ? 'Raise the memory limit, or find what is holding memory. The previous logs usually stop right where it ran out.'
          : 'Read the previous container logs. They are the output of the run that failed, and the current logs are from a container that has not started yet.',
        object: ref(pod, 'Pod'),
        at: last?.finishedAt ?? undefined,
        evidence: [
          ...(last?.reason ? [{ source: 'Last exit', text: `${last.reason}${typeof exit === 'number' ? `, code ${exit}` : ''}`, at: last.finishedAt ?? undefined }] : []),
          ...(last?.message ? [{ source: 'Last message', text: last.message }] : []),
          ...(waiting.message ? [{ source: 'Kubelet', text: waiting.message }] : []),
        ],
        actions: [
          { label: 'Logs from the run that failed', kind: 'previous-logs', target: { kind: 'Pod', name: pod.metadata?.name ?? '', namespace: pod.metadata?.namespace, container: status.name } },
          { label: 'Open the pod', kind: 'open', target: ref(pod, 'Pod') },
        ],
        cause: 1,
      });
    }
  }
  return findings;
};

/** Killed for memory, whether or not it is looping yet. */
const outOfMemory: Rule = (input, now) => {
  const findings: Finding[] = [];
  for (const pod of input.pods ?? []) {
    for (const status of pod.status?.containerStatuses ?? []) {
      const terminated = status.lastState?.terminated ?? status.state?.terminated;
      if (terminated?.reason !== 'OOMKilled') continue;
      if (status.state?.waiting?.reason === 'CrashLoopBackOff') continue; // already reported, with more detail
      if (!recent(terminated.finishedAt ?? undefined, now, 6 * 60 * MINUTE)) continue;

      const limit = pod.spec?.containers?.find((container) => container.name === status.name)?.resources?.limits?.['memory'];
      findings.push({
        id: `oom:${pod.metadata?.namespace}/${pod.metadata?.name}/${status.name}`,
        rule: 'out-of-memory',
        group: `out-of-memory:${pod.metadata?.namespace}/${workloadOf(pod).name}/${status.name}`,
        severity: 'critical',
        title: `${containerIn(status.name, workloadOf(pod).name)} ran out of memory`,
        detail: `${
          limit
            ? `It asked for more than its limit of ${limit} and the kernel killed it. Nothing in the container did anything wrong; it was stopped from outside.`
            : 'The kernel killed it for using too much memory. It has no memory limit set, so this was the node running out, not the container exceeding its own allowance.'
        }${(status.restartCount ?? 0) > 1 ? ` It has come back ${status.restartCount} times, so this is happening repeatedly rather than once.` : ''}`,
        fix: limit
          ? `Raise the limit above ${limit}, or find what is holding memory. The previous logs usually stop right at the point it ran out.`
          : 'Set a memory limit so this container cannot take the node down with it, then find what is holding memory.',
        object: ref(pod, 'Pod'),
        at: terminated.finishedAt ?? undefined,
        evidence: [{ source: 'Last exit', text: `OOMKilled, code ${terminated.exitCode ?? 137}`, at: terminated.finishedAt ?? undefined }],
        actions: [
          { label: 'Logs from before it was killed', kind: 'previous-logs', target: { kind: 'Pod', name: pod.metadata?.name ?? '', namespace: pod.metadata?.namespace, container: status.name } },
          { label: 'Open the pod', kind: 'open', target: ref(pod, 'Pod') },
        ],
        cause: 1,
      });
    }
  }
  return findings;
};

/** The image is wrong, private, or gone. */
const imageProblems: Rule = (input) => {
  const findings: Finding[] = [];
  for (const pod of input.pods ?? []) {
    for (const status of [...(pod.status?.containerStatuses ?? []), ...(pod.status?.initContainerStatuses ?? [])]) {
      const reason = status.state?.waiting?.reason ?? '';
      if (!['ImagePullBackOff', 'ErrImagePull', 'InvalidImageName', 'ImageInspectError'].includes(reason)) continue;
      const message = status.state?.waiting?.message ?? '';
      const denied = /unauthorized|authentication required|denied|forbidden/i.test(message);
      const missing = /not found|manifest unknown|does not exist/i.test(message);

      findings.push({
        id: `image:${pod.metadata?.namespace}/${pod.metadata?.name}/${status.name}`,
        rule: 'image-unavailable',
        group: `image-unavailable:${pod.metadata?.namespace}/${status.image ?? workloadOf(pod).name}`,
        severity: 'critical',
        title: `${workloadOf(pod).name} cannot pull its image`,
        detail: denied
          ? `The registry refused the pull for ${status.image ?? 'the image'}. The node has no credentials for it, or the ones it has are not allowed to read this repository.`
          : missing
            ? `The registry does not have ${status.image ?? 'that image'}. Usually a tag that was never pushed, or a typo in it.`
            : reason === 'InvalidImageName'
              ? `${status.image ?? 'The image name'} is not a valid image reference, so nothing tried to pull it.`
              : `The node could not pull ${status.image ?? 'the image'}, and is waiting longer between each retry.`,
        fix: denied
          ? 'Add an imagePullSecret to the pod or its service account, and check the secret is in the same namespace.'
          : missing
            ? 'Check the tag exists in the registry. A digest is worth using here: a tag that moves can do this to you twice.'
            : undefined,
        object: ref(pod, 'Pod'),
        evidence: [
          { source: 'Kubelet', text: message || reason },
          ...(status.image ? [{ source: 'Image', text: status.image }] : []),
        ],
        actions: [{ label: 'Open the pod', kind: 'open', target: ref(pod, 'Pod') }],
        cause: 1,
      });
    }
  }
  return findings;
};

/**
 * A config map or secret the pod needs is missing a key, or missing.
 *
 * This is the one that gets buried. It produces a single event and then the
 * pod sits in `CreateContainerConfigError` generating nothing, while
 * everything else in the namespace is noisier.
 */
const configProblems: Rule = (input) => {
  const findings: Finding[] = [];
  for (const pod of input.pods ?? []) {
    for (const status of [...(pod.status?.containerStatuses ?? []), ...(pod.status?.initContainerStatuses ?? [])]) {
      const reason = status.state?.waiting?.reason ?? '';
      if (!['CreateContainerConfigError', 'CreateContainerError'].includes(reason)) continue;
      const message = status.state?.waiting?.message ?? '';
      /*
       * The kubelet says this two ways and both turn up in the wild:
       *
       *   secret "api-secret" not found
       *   couldn't find key DATABASE_URL in ConfigMap shop/api-config
       *
       * The second is the one that matters most and the one a quoted-name
       * pattern misses entirely, so both are matched and the namespace
       * prefix is stripped off the name.
       */
      const named =
        /(?:configmap|secret)\s+"([^"]+)"/i.exec(message)?.[1] ??
        /in\s+(?:configmap|secret)\s+([^\s"]+)/i.exec(message)?.[1]?.split('/').pop();
      const key = /key\s+"?([\w.-]+)"?(?:\s+not found|\s+in\s)/i.exec(message)?.[1];
      const isSecret = /secret/i.test(message);

      findings.push({
        id: `config:${pod.metadata?.namespace}/${pod.metadata?.name}/${status.name}`,
        rule: 'config-missing',
        // The same missing key on every replica is one missing key.
        group: `config-missing:${pod.metadata?.namespace}/${named ?? ''}/${key ?? message}`,
        severity: 'critical',
        title: key
          ? `${named ?? 'A config'} has no key called ${key}`
          : named
            ? `${isSecret ? 'Secret' : 'ConfigMap'} ${named} is missing`
            : `${pod.metadata?.name ?? 'A pod'} cannot build its container`,
        detail: key
          ? `The pod asks for ${key} from ${named ?? 'a config'} and it is not there, so the container is never created. This produces no logs at all, because nothing has started.`
          : `The container could not be created from its configuration: ${message || reason}. Nothing has started, so there are no logs to read.`,
        fix: key
          ? `Add ${key} to ${named ?? 'the config'}, or correct the name the pod is asking for.`
          : named
            ? `Create ${named} in ${pod.metadata?.namespace ?? 'this namespace'}, or point the pod at the one that exists.`
            : undefined,
        object: ref(pod, 'Pod'),
        evidence: [{ source: 'Kubelet', text: message || reason }],
        actions: [
          { label: 'Open the pod', kind: 'open', target: ref(pod, 'Pod') },
          ...(named
            ? [
                {
                  label: `Open ${named}`,
                  kind: 'open' as const,
                  target: { kind: isSecret ? 'Secret' : 'ConfigMap', name: named, namespace: pod.metadata?.namespace },
                },
              ]
            : []),
        ],
        cause: 1,
      });
    }
  }
  return findings;
};

/** Nowhere to run. The scheduler says why and the message is usually precise. */
const unschedulable: Rule = (input, now) => {
  const findings: Finding[] = [];
  const failures = (input.events ?? []).filter((event) => event.reason === 'FailedScheduling' && recent(eventAt(event), now, 6 * 60 * MINUTE));
  const byPod = new Map<string, KubeEvent>();
  for (const event of failures) {
    const key = `${event.involvedObject?.namespace}/${event.involvedObject?.name}`;
    const existing = byPod.get(key);
    if (!existing || time(eventAt(event)) > time(eventAt(existing))) byPod.set(key, event);
  }

  const owners = new Map((input.pods ?? []).map((entry) => [entry.metadata?.name ?? '', workloadOf(entry).name]));
  for (const event of byPod.values()) {
    const message = event.message ?? '';
    const subject = owners.get(event.involvedObject?.name ?? '') ?? event.involvedObject?.name ?? 'A pod';
    const cpu = /insufficient cpu/i.test(message);
    const memory = /insufficient memory/i.test(message);
    const taints = /untolerated taint|didn't tolerate/i.test(message);
    const affinity = /affinity|selector/i.test(message);
    const volume = /volume node affinity|had volume node affinity conflict|unbound immediate PersistentVolumeClaims/i.test(message);

    findings.push({
      id: `unschedulable:${event.involvedObject?.namespace}/${event.involvedObject?.name}`,
      rule: 'unschedulable',
      group: `unschedulable:${event.involvedObject?.namespace}/${subject}`,
      severity: 'critical',
      title: `${subject} has nowhere to run`,
      detail:
        cpu || memory
          ? `No node has enough spare ${cpu && memory ? 'CPU or memory' : cpu ? 'CPU' : 'memory'} for what this pod requests. Requests are a reservation, not a measurement: a node can look idle and still have nothing left to give.`
          : taints
            ? 'Every node that could take this pod carries a taint it does not tolerate. Taints are a node saying "only pods that name me", and control plane nodes carry one by default.'
            : volume
              ? 'Its storage is not available where it could run: either the volume claim is still unbound, or the volume exists in a zone with no room.'
              : affinity
                ? 'Its node selector or affinity rules match no node with space.'
                : `The scheduler could not place it: ${message}`,
      fix:
        cpu || memory
          ? 'Lower the requests, add a node, or free one up. The requests, not the usage, are what the scheduler reads.'
          : taints
            ? 'Add a toleration to the pod, or remove the taint from a node that should accept it.'
            : undefined,
      object: { kind: 'Pod', name: event.involvedObject?.name ?? 'unknown', namespace: event.involvedObject?.namespace },
      at: eventAt(event),
      evidence: [fromEvent(event)],
      actions: [
        { label: 'Open the pod', kind: 'open', target: { kind: 'Pod', name: event.involvedObject?.name ?? '', namespace: event.involvedObject?.namespace } },
        { label: 'Look at the nodes', kind: 'nodes' },
      ],
      cause: 1,
    });
  }
  return findings;
};

/** Probes that keep failing. One failure is normal; a pattern is not. */
const failingProbes: Rule = (input, now) => {
  // Events name the pod; people name the workload. The pods we already have
  // are the only way to get from one to the other.
  const owners = new Map((input.pods ?? []).map((entry) => [entry.metadata?.name ?? '', workloadOf(entry).name]));
  const grouped = new Map<string, { event: KubeEvent; count: number }>();
  for (const event of input.events ?? []) {
    if (event.reason !== 'Unhealthy' || !recent(eventAt(event), now)) continue;
    const key = `${event.involvedObject?.namespace}/${event.involvedObject?.name}`;
    const current = grouped.get(key);
    const count = (current?.count ?? 0) + (event.count ?? 1);
    grouped.set(key, { event, count });
  }

  return [...grouped.values()]
    .filter((entry) => entry.count >= 3)
    .map(({ event, count }) => {
      const message = event.message ?? '';
      const liveness = /liveness/i.test(message);
      const readiness = /readiness/i.test(message);
      const startup = /startup/i.test(message);
      const code = /HTTP probe failed with statuscode: (\d+)/i.exec(message)?.[1];
      const refused = /connection refused/i.test(message);
      const timeout = /timeout|context deadline exceeded/i.test(message);

      const podName = event.involvedObject?.name ?? '';
      const subject = owners.get(podName) ?? (podName || 'A pod');
      const sort = liveness ? 'liveness' : readiness ? 'readiness' : startup ? 'startup' : 'health';
      return {
        id: `probe:${event.involvedObject?.namespace}/${podName}`,
        rule: 'probe-failing',
        group: `probe-failing:${event.involvedObject?.namespace}/${subject}/${sort}`,
        severity: liveness ? ('critical' as const) : ('warning' as const),
        title: `${subject} is failing its ${sort} check`,
        detail: liveness
          ? `Kubernetes checks this container is alive, and ${count} of those checks failed. When a liveness check fails enough times the container is killed and restarted, so this becomes a restart loop if it continues.`
          : readiness
            ? `Kubernetes checks this container is ready for traffic, and ${count} of those checks failed. While it fails, the pod is taken out of its Service, so requests go elsewhere: the pod stays up and receives nothing.`
            : `${count} health checks failed.`,
        fix: refused
          ? 'Nothing is listening on the port being checked. Either the process has not finished starting, or the probe names the wrong port.'
          : timeout
            ? 'The check timed out rather than being refused, so the process is up but too slow to answer. A startup probe buys a slow boot time without loosening the liveness check.'
            : code
              ? `The endpoint answered ${code} rather than a success. It is reachable, so this is the application saying it is not well.`
              : undefined,
        object: { kind: 'Pod', name: event.involvedObject?.name ?? 'unknown', namespace: event.involvedObject?.namespace },
        at: eventAt(event),
        evidence: [fromEvent(event)],
        actions: [
          { label: 'Logs', kind: 'logs' as const, target: { kind: 'Pod', name: event.involvedObject?.name ?? '', namespace: event.involvedObject?.namespace } },
          { label: 'Open the pod', kind: 'open' as const, target: { kind: 'Pod', name: event.involvedObject?.name ?? '', namespace: event.involvedObject?.namespace } },
        ],
        cause: 1,
      };
    });
};

/** Volumes that will not attach or mount. */
const volumeProblems: Rule = (input, now) => {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const event of input.events ?? []) {
    if (!['FailedMount', 'FailedAttachVolume', 'VolumeFailedDelete', 'ProvisioningFailed'].includes(event.reason ?? '')) continue;
    if (!recent(eventAt(event), now, 3 * 60 * MINUTE)) continue;
    const key = `${event.involvedObject?.namespace}/${event.involvedObject?.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const message = event.message ?? '';
    const multiAttach = /Multi-Attach error/i.test(message);
    const timeout = /timed out waiting for the condition/i.test(message);

    findings.push({
      id: `volume:${key}`,
      rule: 'volume-problem',
      severity: 'critical',
      title: `${event.involvedObject?.name ?? 'A pod'} cannot mount its storage`,
      detail: multiAttach
        ? 'The volume is already attached to another node and this kind of volume can only be attached to one at a time. It usually means the old pod has not finished going away, and it usually resolves itself within a few minutes.'
        : timeout
          ? 'The mount did not complete in time. The pod will keep waiting and retrying; it has not failed, it is stuck.'
          : `The volume could not be mounted: ${message}`,
      fix: multiAttach ? 'Wait for the previous pod to terminate, or delete it if its node is gone.' : undefined,
      object: { kind: event.involvedObject?.kind ?? 'Pod', name: event.involvedObject?.name ?? 'unknown', namespace: event.involvedObject?.namespace },
      at: eventAt(event),
      evidence: [fromEvent(event)],
      actions: [{ label: 'Open it', kind: 'open', target: { kind: event.involvedObject?.kind ?? 'Pod', name: event.involvedObject?.name ?? '', namespace: event.involvedObject?.namespace } }],
      cause: 1,
    });
  }
  return findings;
};

/** Pods thrown off a node, which is always somebody else's fault. */
const evictions: Rule = (input, now) => {
  const findings: Finding[] = [];
  for (const pod of input.pods ?? []) {
    if (pod.status?.reason !== 'Evicted') continue;
    if (!recent(pod.metadata?.creationTimestamp, now, 6 * 60 * MINUTE)) continue;
    const message = pod.status.message ?? '';
    const resource = /(ephemeral-storage|memory|disk)/i.exec(message)?.[1]?.toLowerCase();
    findings.push({
      id: `evicted:${pod.metadata?.namespace}/${pod.metadata?.name}`,
      rule: 'evicted',
      severity: 'warning',
      title: `${pod.metadata?.name ?? 'A pod'} was evicted from ${pod.spec?.nodeName ?? 'its node'}`,
      detail: resource
        ? `The node ran short of ${resource} and pushed this pod off to save itself. The pod did nothing wrong; it was the one chosen to go.`
        : `The node removed this pod: ${message}`,
      fix: resource === 'ephemeral-storage' ? 'Something on that node is filling the disk, often logs or an emptyDir. Set a limit on ephemeral-storage so the noisy pod is the one evicted.' : undefined,
      object: ref(pod, 'Pod'),
      at: pod.metadata?.creationTimestamp,
      evidence: [{ source: 'Pod status', text: message }],
      actions: [{ label: 'Look at the nodes', kind: 'nodes' }],
      cause: 1,
    });
  }
  return findings;
};

/** A node that is not well, which explains everything on it. */
const nodePressure: Rule = (input) => {
  const findings: Finding[] = [];
  for (const node of input.nodes ?? []) {
    const conditions = node.status?.conditions ?? [];
    const ready = conditions.find((condition) => condition.type === 'Ready');
    if (ready?.status === 'False' || ready?.status === 'Unknown') {
      findings.push({
        id: `node-not-ready:${node.metadata?.name}`,
        rule: 'node-not-ready',
        severity: 'critical',
        title: `Node ${node.metadata?.name ?? 'unknown'} is not ready`,
        detail:
          ready.status === 'Unknown'
            ? 'The node has stopped reporting in. Everything on it is still listed as running because nothing has been able to say otherwise, which is not the same as it working.'
            : `The node says it is not ready: ${ready.message ?? ready.reason ?? 'no reason given'}. Nothing new will be scheduled onto it, and what is on it may be evicted.`,
        object: ref(node, 'Node'),
        at: ready.lastTransitionTime,
        evidence: [{ source: 'Node condition', text: ready.message ?? ready.reason ?? '', at: ready.lastTransitionTime }],
        actions: [{ label: 'Open the node', kind: 'open', target: ref(node, 'Node') }],
        // A sick node explains the pods on it, so it sorts above them.
        cause: 0,
      });
      continue;
    }

    for (const condition of conditions) {
      if (condition.status !== 'True') continue;
      const kind = condition.type ?? '';
      if (!['MemoryPressure', 'DiskPressure', 'PIDPressure', 'NetworkUnavailable'].includes(kind)) continue;
      findings.push({
        id: `node-pressure:${node.metadata?.name}:${kind}`,
        rule: 'node-pressure',
        severity: 'warning',
        title: `Node ${node.metadata?.name ?? 'unknown'} is under ${kind.replace('Pressure', '').replace('NetworkUnavailable', 'network').toLowerCase()} pressure`,
        detail:
          kind === 'MemoryPressure'
            ? 'The node is low on memory and will start evicting pods to recover. Anything evicted on this node was evicted because of this, not because of anything it did.'
            : kind === 'DiskPressure'
              ? 'The node is low on disk. It will start deleting unused images, then evicting pods. Image pulls on this node may also begin failing.'
              : kind === 'PIDPressure'
                ? 'The node is running out of process IDs, which means something on it is spawning processes and not reaping them.'
                : 'The node reports its network is unavailable, usually a CNI plugin that has not come up.',
        object: ref(node, 'Node'),
        at: condition.lastTransitionTime,
        evidence: [{ source: 'Node condition', text: condition.message ?? condition.reason ?? '', at: condition.lastTransitionTime }],
        actions: [{ label: 'Open the node', kind: 'open', target: ref(node, 'Node') }],
        cause: 0,
      });
    }

    if (node.spec?.unschedulable === true) {
      findings.push({
        id: `node-cordoned:${node.metadata?.name}`,
        rule: 'node-cordoned',
        severity: 'info',
        title: `Node ${node.metadata?.name ?? 'unknown'} is cordoned`,
        detail: 'Somebody marked this node unschedulable, so nothing new will be placed on it. What is already running keeps running. This is usually deliberate, before maintenance.',
        object: ref(node, 'Node'),
        evidence: [{ source: 'Node spec', text: 'spec.unschedulable is true' }],
        actions: [{ label: 'Open the node', kind: 'open', target: ref(node, 'Node') }],
        cause: 3,
      });
    }
  }
  return findings;
};

/**
 * A rollout that happened just before everything went wrong.
 *
 * This is the finding that earns the feature. Nothing in the API links "the
 * deployment changed" to "the pods started failing"; a person does it by
 * looking at two timestamps, and doing that for them is most of the value.
 */
const recentRollout: Rule = (input, now) => {
  const findings: Finding[] = [];
  const failureTimes = collectFailureTimes(input);

  const sets = input.replicaSets ?? [];
  for (const replicaSet of sets) {
    const created = replicaSet.metadata?.creationTimestamp;
    if (!created || !recent(created, now, 2 * 60 * MINUTE)) continue;
    const owner = replicaSet.metadata?.ownerReferences?.find((reference) => reference.controller)?.name;
    const createdAt = Date.parse(created);

    /*
     * A rollout replaces something. A first deploy does not.
     *
     * Without this, every workload in a namespace someone just created is
     * reported as "rolled out just before this started", which is true, is the
     * top of the list, and is worthless: nothing was replaced, so there is
     * nothing to roll back to. The signal is a *previous* replica set for the
     * same owner.
     */
    const older = sets.some(
      (other) =>
        other !== replicaSet &&
        other.metadata?.ownerReferences?.some((reference) => reference.name === owner) === true &&
        Date.parse(other.metadata?.creationTimestamp ?? '') < createdAt,
    );
    if (!older) continue;

    // Only interesting if something broke after it. A healthy rollout is not
    // a finding, it is Tuesday.
    const after = failureTimes.filter((at) => at >= createdAt && at - createdAt <= 30 * MINUTE);
    if (after.length === 0) continue;

    const gap = Math.max(1, Math.round((Math.min(...after) - createdAt) / MINUTE));
    findings.push({
      id: `rollout:${replicaSet.metadata?.namespace}/${replicaSet.metadata?.name}`,
      rule: 'rollout-preceded-failure',
      severity: 'warning',
      title: `${owner ?? replicaSet.metadata?.name ?? 'A workload'} was rolled out ${minutesAgo(createdAt, now)}, just before this started`,
      detail: `A new version went out and the first failure followed ${gap} minute${gap === 1 ? '' : 's'} later. That is not proof it caused this, but it is the first thing to check, and rolling back is the fastest way to find out.`,
      fix: owner ? `kubectl rollout undo deployment/${owner} -n ${replicaSet.metadata?.namespace ?? 'default'}` : undefined,
      object: { kind: 'Deployment', name: owner ?? replicaSet.metadata?.name ?? 'unknown', namespace: replicaSet.metadata?.namespace },
      at: created,
      evidence: [
        { source: 'ReplicaSet', text: `${replicaSet.metadata?.name ?? 'a new replica set'} was created`, at: created },
        { source: 'First failure after it', text: new Date(Math.min(...after)).toISOString(), at: new Date(Math.min(...after)).toISOString() },
      ],
      actions: [{ label: 'Open the workload', kind: 'open', target: { kind: 'Deployment', name: owner ?? '', namespace: replicaSet.metadata?.namespace } }],
      // A change that preceded the failure is as close to a root cause as
      // this data gets, so it sorts above everything it may have caused.
      cause: 0,
    });
  }
  return findings;
};

/**
 * A config map or secret edited just before the trouble.
 *
 * `managedFields` records when each manager last wrote, which is the only
 * timestamp Kubernetes keeps for "this object changed". It is enough to date
 * an edit, and dating the edit is the whole point.
 */
const recentConfigChange: Rule = (input) => {
  const findings: Finding[] = [];
  const failureTimes = collectFailureTimes(input);
  if (failureTimes.length === 0) return findings;
  const firstFailure = Math.min(...failureTimes);
  /*
   * Only what the pods in question actually read.
   *
   * The empty-set fallback is deliberate and narrow: with no pods at all we
   * cannot tell what is referenced, so every config is a candidate. With pods
   * that reference nothing, the answer is genuinely nothing, and falling back
   * there is how asking about one workload returns a config map belonging to
   * a different one.
   */
  const pods = input.pods ?? [];
  const referenced = referencedConfigs(pods);
  if (pods.length > 0 && referenced.size === 0) return findings;

  for (const config of input.configs ?? []) {
    const name = config.metadata?.name ?? '';
    // Kubernetes writes this one into every namespace itself, so its timestamp
    // is the namespace's age and never anybody's change.
    if (MANAGED_CONFIGS.has(name)) continue;
    if (pods.length > 0 && !referenced.has(name)) continue;
    const written = lastWrite(config.metadata);
    if (!written) continue;
    const at = Date.parse(written);
    if (!Number.isFinite(at)) continue;
    // Changed before the failure, and not so long before that it is unrelated.
    if (at > firstFailure || firstFailure - at > 30 * MINUTE) continue;
    const gap = Math.max(1, Math.round((firstFailure - at) / MINUTE));

    findings.push({
      id: `config-change:${config.metadata?.namespace}/${config.metadata?.name}`,
      rule: 'config-changed-before-failure',
      severity: 'warning',
      title: `${config.kind} ${config.metadata?.name ?? 'unknown'} was changed ${gap} minute${gap === 1 ? '' : 's'} before this started`,
      detail: `It was last written at ${written}, and the first failure came ${gap} minute${gap === 1 ? '' : 's'} after. Pods do not restart when a config map changes, so anything that read it at startup is still running the old value and anything that restarted since has the new one.`,
      fix: 'Compare it against what the running pods actually loaded. A mounted config map updates in place, but a value read into a variable at startup does not.',
      object: { kind: config.kind, name: config.metadata?.name ?? 'unknown', namespace: config.metadata?.namespace },
      at: written,
      evidence: [{ source: 'Last written by', text: writerOf(config.metadata) ?? 'unknown', at: written }],
      actions: [{ label: `Open the ${config.kind.toLowerCase()}`, kind: 'open', target: { kind: config.kind, name: config.metadata?.name ?? '', namespace: config.metadata?.namespace } }],
      cause: 0,
    });
  }
  return findings;
};

/** A workload that is not at the replica count it is asking for. */
const notAtStrength: Rule = (input) => {
  const findings: Finding[] = [];
  for (const workload of input.workloads ?? []) {
    const wanted = workload.spec?.replicas ?? 0;
    const ready = workload.status?.readyReplicas ?? 0;
    if (wanted === 0 || ready >= wanted) continue;

    const progressing = workload.status?.conditions?.find((condition) => condition.type === 'Progressing');
    const stalled = progressing?.status === 'False' && progressing.reason === 'ProgressDeadlineExceeded';

    findings.push({
      id: `understrength:${workload.metadata?.namespace}/${workload.metadata?.name}`,
      rule: 'not-at-strength',
      severity: ready === 0 ? 'critical' : 'warning',
      title:
        ready === 0
          ? `${workload.metadata?.name ?? 'A workload'} has no pods running at all`
          : `${workload.metadata?.name ?? 'A workload'} is running ${ready} of ${wanted}`,
      detail: stalled
        ? 'The rollout has given up: it ran past its progress deadline without enough pods becoming ready, so it has stopped waiting. The old pods are still serving if this was an update.'
        : ready === 0
          ? 'Nothing is serving. Whatever is below this is why.'
          : `${wanted - ready} pod${wanted - ready === 1 ? ' is' : 's are'} not ready, so it is running with less capacity than it asked for.`,
      object: { kind: workload.kind ?? 'Deployment', name: workload.metadata?.name ?? 'unknown', namespace: workload.metadata?.namespace },
      at: progressing?.lastTransitionTime,
      evidence: [
        { source: 'Replicas', text: `${ready} ready of ${wanted} wanted` },
        ...(progressing?.message ? [{ source: 'Progressing', text: progressing.message, at: progressing.lastTransitionTime }] : []),
      ],
      actions: [{ label: 'Open the workload', kind: 'open', target: { kind: workload.kind ?? 'Deployment', name: workload.metadata?.name ?? '', namespace: workload.metadata?.namespace } }],
      // A symptom of everything else, so it sorts under the causes.
      cause: 2,
    });
  }
  return findings;
};

/** Quota refusals, which look like nothing happening at all. */
const quotaRefusals: Rule = (input, now) => {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const event of input.events ?? []) {
    const message = event.message ?? '';
    if (!/exceeded quota|forbidden: failed quota/i.test(message)) continue;
    if (!recent(eventAt(event), now, 3 * 60 * MINUTE)) continue;
    const key = `${event.involvedObject?.namespace}/${event.involvedObject?.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    findings.push({
      id: `quota:${key}`,
      rule: 'quota-exceeded',
      severity: 'critical',
      title: `${event.involvedObject?.namespace ?? 'This namespace'} has hit its quota`,
      detail: `New pods are being refused before they are ever scheduled: ${message}. Nothing appears in the pod list, because nothing was created, which is why this looks like nothing happening.`,
      fix: 'Raise the ResourceQuota, or lower the requests on what is trying to start.',
      object: { kind: event.involvedObject?.kind ?? 'ReplicaSet', name: event.involvedObject?.name ?? 'unknown', namespace: event.involvedObject?.namespace },
      at: eventAt(event),
      evidence: [fromEvent(event)],
      actions: [{ label: 'Open it', kind: 'open', target: { kind: event.involvedObject?.kind ?? 'ReplicaSet', name: event.involvedObject?.name ?? '', namespace: event.involvedObject?.namespace } }],
      cause: 1,
    });
  }
  return findings;
};

/** Jobs that ran out of retries. */
const failedJobs: Rule = (input, now) => {
  const findings: Finding[] = [];
  for (const event of input.events ?? []) {
    if (!['BackoffLimitExceeded', 'DeadlineExceeded'].includes(event.reason ?? '')) continue;
    if (!recent(eventAt(event), now, 12 * 60 * MINUTE)) continue;
    findings.push({
      id: `job:${event.involvedObject?.namespace}/${event.involvedObject?.name}`,
      rule: 'job-failed',
      severity: 'warning',
      title: `Job ${event.involvedObject?.name ?? 'unknown'} gave up`,
      detail:
        event.reason === 'DeadlineExceeded'
          ? 'It ran past its activeDeadlineSeconds and was stopped mid-run, so whatever it was doing is half done.'
          : 'It failed more times than its backoffLimit allows, so Kubernetes stopped retrying. The pods from the failed attempts are usually still there with their logs.',
      object: { kind: 'Job', name: event.involvedObject?.name ?? 'unknown', namespace: event.involvedObject?.namespace },
      at: eventAt(event),
      evidence: [fromEvent(event)],
      actions: [{ label: 'Open the job', kind: 'open', target: { kind: 'Job', name: event.involvedObject?.name ?? '', namespace: event.involvedObject?.namespace } }],
      cause: 1,
    });
  }
  return findings;
};

/** Restarts that are not yet a loop but are not normal either. */
const quietRestarts: Rule = (input, now) => {
  const findings: Finding[] = [];
  for (const pod of input.pods ?? []) {
    for (const status of pod.status?.containerStatuses ?? []) {
      const restarts = status.restartCount ?? 0;
      if (restarts < 3) continue;
      if (status.state?.waiting?.reason === 'CrashLoopBackOff') continue; // reported properly above
      // An OOM kill is reported with its cause, which is strictly more useful
      // than "it restarted a lot". Two findings about one container is one
      // finding too many.
      if (status.lastState?.terminated?.reason === 'OOMKilled') continue;
      const last = status.lastState?.terminated;
      if (!recent(last?.finishedAt ?? undefined, now, 3 * 60 * MINUTE)) continue;

      findings.push({
        id: `restarts:${pod.metadata?.namespace}/${pod.metadata?.name}/${status.name}`,
        rule: 'restarting-quietly',
        group: `restarting-quietly:${pod.metadata?.namespace}/${workloadOf(pod).name}/${status.name}`,
        severity: 'warning',
        title: `${containerIn(status.name, workloadOf(pod).name)} has restarted ${restarts} times`,
        detail: `It is running now, so nothing looks wrong in a pod list, but it has died and come back ${restarts} times and the last one was ${minutesAgo(Date.parse(last?.finishedAt ?? ''), now)}. Each restart drops whatever it was serving.`,
        fix: 'The previous logs hold the reason. This is the failure that hides, because by the time anyone looks, the pod is Running again.',
        object: ref(pod, 'Pod'),
        at: last?.finishedAt ?? undefined,
        evidence: [
          { source: 'Last exit', text: `${last?.reason ?? 'ended'}${typeof last?.exitCode === 'number' ? `, code ${last.exitCode}` : ''}`, at: last?.finishedAt ?? undefined },
        ],
        actions: [
          { label: 'Logs from the run that failed', kind: 'previous-logs', target: { kind: 'Pod', name: pod.metadata?.name ?? '', namespace: pod.metadata?.namespace, container: status.name } },
          { label: 'Open the pod', kind: 'open', target: ref(pod, 'Pod') },
        ],
        cause: 1,
      });
    }
  }
  return findings;
};

const RULES: readonly Rule[] = [
  recentRollout,
  recentConfigChange,
  nodePressure,
  crashLooping,
  outOfMemory,
  imageProblems,
  configProblems,
  unschedulable,
  volumeProblems,
  quotaRefusals,
  failingProbes,
  evictions,
  failedJobs,
  quietRestarts,
  notAtStrength,
];

// ---------------------------------------------------------------------------

/** Every moment something went wrong, so a change can be dated against them. */
function collectFailureTimes(input: DiagnoseInput): number[] {
  const times: number[] = [];
  for (const event of input.events ?? []) {
    if (event.type !== 'Warning') continue;
    const at = Date.parse(eventAt(event) ?? '');
    if (Number.isFinite(at)) times.push(at);
  }
  for (const pod of input.pods ?? []) {
    for (const status of pod.status?.containerStatuses ?? []) {
      const at = Date.parse(status.lastState?.terminated?.finishedAt ?? '');
      if (Number.isFinite(at)) times.push(at);
    }
  }
  return times;
}

/** Config maps the cluster maintains itself. Their age is the namespace's age. */
const MANAGED_CONFIGS = new Set(['kube-root-ca.crt', 'openshift-service-ca.crt']);

/**
 * Every config map and secret these pods read, by any of the four routes.
 *
 * A volume, a secret volume, `env.valueFrom` and `envFrom` are all ways to
 * depend on one, and a rule that checks only volumes misses the case that
 * actually breaks things, which is an environment variable read at startup.
 */
function referencedConfigs(pods: readonly PodObject[]): Set<string> {
  const names = new Set<string>();
  for (const pod of pods) {
    for (const volume of pod.spec?.volumes ?? []) {
      if (volume.configMap?.name) names.add(volume.configMap.name);
      if (volume.secret?.secretName) names.add(volume.secret.secretName);
    }
    for (const container of pod.spec?.containers ?? []) {
      for (const entry of container.envFrom ?? []) {
        if (entry.configMapRef?.name) names.add(entry.configMapRef.name);
        if (entry.secretRef?.name) names.add(entry.secretRef.name);
      }
      for (const entry of container.env ?? []) {
        const from = entry.valueFrom;
        if (from?.configMapKeyRef?.name) names.add(from.configMapKeyRef.name);
        if (from?.secretKeyRef?.name) names.add(from.secretKeyRef.name);
      }
    }
  }
  return names;
}

/** When this object was last written, by anyone. */
function lastWrite(meta: KubeMeta | undefined): string | undefined {
  const times = (meta?.managedFields ?? [])
    .map((field) => field.time)
    .filter((time): time is string => typeof time === 'string')
    .sort();
  return times.at(-1) ?? undefined;
}

function writerOf(meta: KubeMeta | undefined): string | undefined {
  const latest = [...(meta?.managedFields ?? [])]
    .filter((field) => typeof field.time === 'string')
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
    .at(-1);
  return latest?.manager;
}

export function minutesAgo(at: number, now: number): string {
  if (!Number.isFinite(at)) return 'recently';
  const minutes = Math.round((now - at) / MINUTE);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return 'a minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
}

/**
 * Everything that happened, in order, with the normal events kept.
 *
 * A timeline of only the warnings hides the deploy, and the deploy is usually
 * the answer. Scaling, rollouts and kills are ordinary events and they belong
 * here precisely because they are the changes.
 */
function buildTimeline(input: DiagnoseInput, now: number): TimelineEntry[] {
  const interesting = new Set([
    'Scheduled',
    'Pulled',
    'Created',
    'Started',
    'Killing',
    'ScalingReplicaSet',
    'SuccessfulCreate',
    'SuccessfulDelete',
    'Unhealthy',
    'BackOff',
    'Failed',
    'FailedScheduling',
    'FailedMount',
    'Evicted',
    'NodeNotReady',
    'NodeHasInsufficientMemory',
    'Preempted',
    'OOMKilling',
  ]);

  return (input.events ?? [])
    .filter((event) => recent(eventAt(event), now) && (event.type === 'Warning' || interesting.has(event.reason ?? '')))
    .map((event) => ({
      at: eventAt(event) ?? '',
      severity: event.type === 'Warning' ? ('warning' as const) : ('info' as const),
      title: explainReason(event.reason ?? 'Event', event.count ?? 1),
      detail: event.message ?? '',
      object: {
        kind: event.involvedObject?.kind ?? 'Object',
        name: event.involvedObject?.name ?? 'unknown',
        namespace: event.involvedObject?.namespace,
      },
    }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 200);
}

/**
 * Event reasons in words.
 *
 * Kubernetes reason strings are internal names that leaked into the user
 * interface years ago and never left. "BackOff" is not a thing that happened
 * to anyone; "waiting longer before trying again" is.
 */
export function explainReason(reason: string, count = 1): string {
  const repeated = count > 1 ? ` (${count} times)` : '';
  const plain: Record<string, string> = {
    BackOff: 'Waiting longer before the next retry',
    Failed: 'Failed',
    FailedScheduling: 'Could not be placed on any node',
    FailedMount: 'Could not mount its storage',
    FailedAttachVolume: 'Could not attach its volume',
    Unhealthy: 'Failed a health check',
    Killing: 'Being stopped',
    Preempted: 'Pushed out to make room for a higher priority pod',
    Evicted: 'Evicted from its node',
    Scheduled: 'Placed on a node',
    Pulled: 'Image pulled',
    Pulling: 'Pulling its image',
    Created: 'Container created',
    Started: 'Container started',
    ScalingReplicaSet: 'Rollout: replica count changed',
    SuccessfulCreate: 'Created a pod',
    SuccessfulDelete: 'Deleted a pod',
    NodeNotReady: 'Its node stopped being ready',
    OOMKilling: 'Killed for using too much memory',
    ProvisioningFailed: 'Storage could not be provisioned',
    BackoffLimitExceeded: 'Gave up after too many failures',
    DeadlineExceeded: 'Ran past its deadline and was stopped',
  };
  return `${plain[reason] ?? reason}${repeated}`;
}
