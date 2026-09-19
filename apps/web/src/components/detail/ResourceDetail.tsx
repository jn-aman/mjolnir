import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api.ts';
import { age as relativeAge } from '../columns.tsx';
import { Bar, Callout, Chips, Conditions, Fields, RefChip, Section, Table, Tags, bytes, parseQuantity, type ConditionShape } from './parts.tsx';

/**
 * A detail pane for every kind that is not a Pod.
 *
 * Twenty-four kinds used to land on "a detailed view for this is not built
 * yet, the YAML tab has everything", which is true and useless: YAML is the
 * thing you read when the UI has given up. What a person actually wants from a
 * Service is which pods are behind it, from a Node whether it is full, from a
 * Role what it can actually do, and from a CronJob when it last ran and
 * whether that worked.
 *
 * So this is one dispatcher over per-kind renderers, all built from the same
 * pieces in parts.tsx. A kind with no renderer still gets metadata, labels,
 * annotations and owners, which is more than the old message and never lies.
 */

export interface DetailProps {
  readonly context: string;
  readonly kind: string;
  readonly item: KubeObject;
  readonly onNavigate?: ((target: { kind: string; name?: string; namespace?: string }) => void) | undefined;
}

export interface KubeObject {
  metadata?: {
    name?: string;
    namespace?: string;
    uid?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    creationTimestamp?: string;
    finalizers?: string[];
    ownerReferences?: Array<{ kind?: string; name?: string; controller?: boolean }>;
    [key: string]: unknown;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  [key: string]: unknown;
}

export function ResourceDetail({ context, kind, item, onNavigate }: DetailProps) {
  const body = renderFor(kind, { context, kind, item, ...(onNavigate ? { onNavigate } : {}) });
  return (
    <div className="flex flex-col gap-5" data-testid={`detail-${kind}`}>
      {body}
      <Metadata item={item} />
    </div>
  );
}

function renderFor(kind: string, props: DetailProps): ReactNode {
  switch (kind) {
    case 'Node':
      return <NodeDetail {...props} />;
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet':
    case 'ReplicaSet':
      return <WorkloadDetail {...props} />;
    case 'Job':
      return <JobDetail {...props} />;
    case 'CronJob':
      return <CronJobDetail {...props} />;
    case 'Service':
      return <ServiceDetail {...props} />;
    case 'Ingress':
      return <IngressDetail {...props} />;
    case 'Endpoints':
      return <EndpointsDetail {...props} />;
    case 'NetworkPolicy':
      return <NetworkPolicyDetail {...props} />;
    case 'PersistentVolumeClaim':
      return <PvcDetail {...props} />;
    case 'PersistentVolume':
      return <PvDetail {...props} />;
    case 'StorageClass':
      return <StorageClassDetail {...props} />;
    case 'Namespace':
      return <NamespaceDetail {...props} />;
    case 'Event':
      return <EventDetail {...props} />;
    case 'HorizontalPodAutoscaler':
      return <HpaDetail {...props} />;
    case 'PodDisruptionBudget':
      return <PdbDetail {...props} />;
    case 'ResourceQuota':
      return <QuotaDetail {...props} />;
    case 'LimitRange':
      return <LimitRangeDetail {...props} />;
    case 'ServiceAccount':
      return <ServiceAccountDetail {...props} />;
    case 'Role':
    case 'ClusterRole':
      return <RoleDetail {...props} />;
    case 'RoleBinding':
    case 'ClusterRoleBinding':
      return <BindingDetail {...props} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ nodes */

function NodeDetail({ context, item, onNavigate }: DetailProps) {
  const status = (item.status ?? {}) as {
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
    conditions?: ConditionShape[];
    nodeInfo?: Record<string, string>;
    addresses?: Array<{ type?: string; address?: string }>;
    images?: Array<{ names?: string[]; sizeBytes?: number }>;
  };
  const spec = (item.spec ?? {}) as { taints?: Array<{ key?: string; value?: string; effect?: string }>; unschedulable?: boolean; podCIDR?: string; providerID?: string };
  const pods = usePods(context, undefined, (pod) => (pod.spec as { nodeName?: string } | undefined)?.nodeName === item.metadata?.name);

  const capacity = status.capacity ?? {};
  const allocatable = status.allocatable ?? {};
  const requested = pods.reduce<{ cpu: number; memory: number }>(
    (total, pod) => {
      for (const container of ((pod.spec as { containers?: Array<{ resources?: { requests?: Record<string, string> } }> } | undefined)?.containers ?? [])) {
        total.cpu += parseQuantity(container.resources?.requests?.['cpu']);
        total.memory += parseQuantity(container.resources?.requests?.['memory']);
      }
      return total;
    },
    { cpu: 0, memory: 0 },
  );

  const info = status.nodeInfo ?? {};
  const roles = Object.keys(item.metadata?.labels ?? {})
    .filter((label) => label.startsWith('node-role.kubernetes.io/'))
    .map((label) => label.slice('node-role.kubernetes.io/'.length))
    .filter(Boolean);

  return (
    <>
      {spec.unschedulable ? (
        <Callout tone="warn" title="Cordoned">
          This node is marked unschedulable, so nothing new lands here. Pods already running are untouched until it is drained.
        </Callout>
      ) : null}

      <Section title="Capacity" hint={`${pods.length} pod${pods.length === 1 ? '' : 's'} scheduled`}>
        <div className="flex flex-col gap-3">
          <Bar label="CPU requested" used={requested.cpu} total={parseQuantity(allocatable['cpu'])} unit="cores" />
          <Bar label="Memory requested" used={requested.memory / 1024 ** 3} total={parseQuantity(allocatable['memory']) / 1024 ** 3} unit="GiB" tint="var(--series-3)" />
          <Bar label="Pods" used={pods.length} total={Number(allocatable['pods'] ?? 0)} tint="var(--series-5)" />
        </div>
        <div className="mt-3">
          <Fields
            rows={[
              // Kubernetes reports these as 12305060Ki and 492080353919, which
              // nobody can read. The raw value stays in the YAML tab.
              ['Allocatable CPU', `${allocatable['cpu'] ?? '-'} of ${capacity['cpu'] ?? '-'}`, true],
              ['Allocatable memory', `${bytes(parseQuantity(allocatable['memory']))} of ${bytes(parseQuantity(capacity['memory']))}`, true],
              ['Ephemeral storage', bytes(parseQuantity(allocatable['ephemeral-storage'])), true],
            ]}
          />
        </div>
      </Section>

      <Section title="Identity">
        <Fields
          rows={[
            roles.length > 0 && ['Roles', <Tags key="r" values={roles} tint="var(--series-1)" />],
            ['Addresses', <Tags key="a" values={(status.addresses ?? []).map((address) => `${address.type}: ${address.address}`)} />],
            ['Kubelet', info['kubeletVersion'] ?? '-', true],
            ['Container runtime', info['containerRuntimeVersion'] ?? '-', true],
            ['OS', `${info['osImage'] ?? '-'} (${info['operatingSystem'] ?? '?'}/${info['architecture'] ?? '?'})`],
            ['Kernel', info['kernelVersion'] ?? '-', true],
            spec.podCIDR ? ['Pod CIDR', spec.podCIDR, true] : null,
            spec.providerID ? ['Provider ID', spec.providerID, true] : null,
          ]}
        />
      </Section>

      <Section title="Taints" hint="what this node refuses unless a pod tolerates it">
        <Tags
          values={(spec.taints ?? []).map((taint) => `${taint.key}${taint.value ? `=${taint.value}` : ''}:${taint.effect}`)}
          tint="var(--status-warn)"
          empty="No taints. Any pod may schedule here."
        />
      </Section>

      <Section title="Conditions">
        <Conditions conditions={status.conditions} />
      </Section>

      <Section title="Pods on this node" hint={`${pods.length}`}>
        <PodChips pods={pods} onNavigate={onNavigate} />
      </Section>
    </>
  );
}

/* -------------------------------------------------------------- workloads */

function WorkloadDetail({ context, kind, item, onNavigate }: DetailProps) {
  const spec = (item.spec ?? {}) as {
    replicas?: number;
    selector?: { matchLabels?: Record<string, string>; matchExpressions?: unknown[] };
    strategy?: { type?: string; rollingUpdate?: Record<string, unknown> };
    updateStrategy?: { type?: string; rollingUpdate?: Record<string, unknown> };
    serviceName?: string;
    template?: { spec?: { containers?: Array<{ name?: string; image?: string }>; nodeSelector?: Record<string, string>; serviceAccountName?: string } };
    minReadySeconds?: number;
    revisionHistoryLimit?: number;
  };
  const status = (item.status ?? {}) as {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    updatedReplicas?: number;
    unavailableReplicas?: number;
    currentNumberScheduled?: number;
    numberReady?: number;
    desiredNumberScheduled?: number;
    conditions?: ConditionShape[];
    observedGeneration?: number;
  };
  const selector = spec.selector?.matchLabels;
  const pods = usePods(context, item.metadata?.namespace, (pod) => matches(pod, selector));

  const desired = kind === 'DaemonSet' ? (status.desiredNumberScheduled ?? 0) : (spec.replicas ?? 0);
  const ready = kind === 'DaemonSet' ? (status.numberReady ?? 0) : (status.readyReplicas ?? 0);
  const strategy = spec.strategy ?? spec.updateStrategy;
  const containers = spec.template?.spec?.containers ?? [];

  return (
    <>
      {desired > 0 && ready < desired ? (
        <Callout tone="warn" title={`${ready} of ${desired} ready`}>
          {status.unavailableReplicas ? `${status.unavailableReplicas} unavailable. ` : ''}
          The pods below carry the reason.
        </Callout>
      ) : null}

      <Section title="Rollout">
        <div className="flex flex-col gap-3">
          <Bar label="Ready" used={ready} total={Math.max(desired, ready)} tint={ready >= desired ? 'var(--status-ok)' : 'var(--status-warn)'} />
          {status.updatedReplicas !== undefined ? <Bar label="Up to date" used={status.updatedReplicas} total={Math.max(desired, 1)} tint="var(--series-1)" /> : null}
        </div>
        <div className="mt-3">
          <Fields
            rows={[
              ['Strategy', `${strategy?.type ?? 'RollingUpdate'}${strategy?.rollingUpdate ? ` (${Object.entries(strategy.rollingUpdate).map(([key, value]) => `${key} ${String(value)}`).join(', ')})` : ''}`],
              kind === 'StatefulSet' && spec.serviceName ? ['Governing service', spec.serviceName, true] : null,
              spec.minReadySeconds ? ['Min ready', `${spec.minReadySeconds}s`] : null,
              ['Observed generation', String(status.observedGeneration ?? '-'), true],
            ]}
          />
        </div>
      </Section>

      <Section title="Selector" hint="the labels that decide which pods belong to this">
        <Chips values={selector} empty="no matchLabels; see the YAML for matchExpressions" />
      </Section>

      <Section title="Containers" hint={`${containers.length} in the template`}>
        <Table
          head={['Name', 'Image']}
          rows={containers.map((container) => [
            <span key="n" className="font-medium text-primary">{container.name}</span>,
            <span key="i" className="break-words font-mono text-[11.5px] [overflow-wrap:anywhere]">{container.image}</span>,
          ])}
        />
        {spec.template?.spec?.serviceAccountName ? (
          <div className="mt-2">
            <Fields rows={[['Service account', spec.template.spec.serviceAccountName, true]]} />
          </div>
        ) : null}
      </Section>

      {status.conditions?.length ? (
        <Section title="Conditions">
          <Conditions conditions={status.conditions} />
        </Section>
      ) : null}

      <Section title="Pods" hint={`${pods.length} matching the selector`}>
        <PodChips pods={pods} onNavigate={onNavigate} />
      </Section>
    </>
  );
}

function JobDetail({ context, item, onNavigate }: DetailProps) {
  const spec = (item.spec ?? {}) as { completions?: number; parallelism?: number; backoffLimit?: number; activeDeadlineSeconds?: number; selector?: { matchLabels?: Record<string, string> } };
  const status = (item.status ?? {}) as { succeeded?: number; failed?: number; active?: number; startTime?: string; completionTime?: string; conditions?: ConditionShape[] };
  const pods = usePods(context, item.metadata?.namespace, (pod) => matches(pod, spec.selector?.matchLabels));
  const failed = status.failed ?? 0;

  return (
    <>
      {failed > 0 ? (
        <Callout tone="error" title={`${failed} attempt${failed === 1 ? '' : 's'} failed`}>
          The backoff limit is {spec.backoffLimit ?? 6}. After that the job gives up and stays failed.
        </Callout>
      ) : null}

      <Section title="Progress">
        <Fields
          rows={[
            ['Succeeded', String(status.succeeded ?? 0)],
            ['Active', String(status.active ?? 0)],
            ['Failed', String(failed)],
            ['Completions wanted', String(spec.completions ?? 1)],
            ['Parallelism', String(spec.parallelism ?? 1)],
            ['Started', status.startTime ? `${relativeAge(status.startTime)} ago` : 'not yet'],
            status.completionTime ? ['Finished', `${relativeAge(status.completionTime)} ago`] : null,
            spec.activeDeadlineSeconds ? ['Deadline', `${spec.activeDeadlineSeconds}s`] : null,
          ]}
        />
      </Section>

      {status.conditions?.length ? (
        <Section title="Conditions">
          <Conditions conditions={status.conditions} />
        </Section>
      ) : null}

      <Section title="Pods" hint={`${pods.length}`}>
        <PodChips pods={pods} onNavigate={onNavigate} />
      </Section>
    </>
  );
}

function CronJobDetail({ context, item, onNavigate }: DetailProps) {
  const spec = (item.spec ?? {}) as {
    schedule?: string;
    suspend?: boolean;
    concurrencyPolicy?: string;
    startingDeadlineSeconds?: number;
    successfulJobsHistoryLimit?: number;
    failedJobsHistoryLimit?: number;
    timeZone?: string;
  };
  const status = (item.status ?? {}) as { lastScheduleTime?: string; lastSuccessfulTime?: string; active?: Array<{ name?: string }> };
  const jobs = useList(context, 'Job', item.metadata?.namespace, (job) =>
    (job.metadata?.ownerReferences ?? []).some((owner) => owner.kind === 'CronJob' && owner.name === item.metadata?.name),
  );

  return (
    <>
      {spec.suspend ? (
        <Callout tone="warn" title="Suspended">
          The schedule is not running. Existing jobs are untouched.
        </Callout>
      ) : null}

      <Section title="Schedule">
        <Fields
          rows={[
            ['Cron', spec.schedule ?? '-', true],
            spec.timeZone ? ['Time zone', spec.timeZone] : null,
            ['Last scheduled', status.lastScheduleTime ? `${relativeAge(status.lastScheduleTime)} ago` : 'never'],
            ['Last success', status.lastSuccessfulTime ? `${relativeAge(status.lastSuccessfulTime)} ago` : 'never'],
            ['Concurrency', spec.concurrencyPolicy ?? 'Allow'],
            ['Kept history', `${spec.successfulJobsHistoryLimit ?? 3} successful, ${spec.failedJobsHistoryLimit ?? 1} failed`],
            ['Running now', String(status.active?.length ?? 0)],
          ]}
        />
      </Section>

      <Section title="Jobs it created" hint={`${jobs.length}`}>
        <Table
          head={['Job', 'Succeeded', 'Failed', 'Age']}
          align={['left', 'right', 'right', 'right']}
          rows={jobs.map((job) => {
            const jobStatus = (job.status ?? {}) as { succeeded?: number; failed?: number };
            return [
              <RefChip
                key="j"
                kind="Job"
                name={job.metadata?.name ?? ''}
                onOpen={onNavigate ? () => onNavigate({ kind: 'Job', name: job.metadata?.name ?? '', ...(job.metadata?.namespace ? { namespace: job.metadata.namespace } : {}) }) : undefined}
              />,
              <span key="s" style={{ color: jobStatus.succeeded ? 'var(--status-ok)' : undefined }}>{jobStatus.succeeded ?? 0}</span>,
              <span key="f" style={{ color: jobStatus.failed ? 'var(--status-error)' : undefined }}>{jobStatus.failed ?? 0}</span>,
              <span key="a">{job.metadata?.creationTimestamp ? relativeAge(job.metadata.creationTimestamp) : '-'}</span>,
            ];
          })}
          empty="No jobs yet, or they have aged out of the kept history."
        />
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- network */

function ServiceDetail({ context, item, onNavigate }: DetailProps) {
  const spec = (item.spec ?? {}) as {
    type?: string;
    clusterIP?: string;
    clusterIPs?: string[];
    externalIPs?: string[];
    externalName?: string;
    sessionAffinity?: string;
    selector?: Record<string, string>;
    ports?: Array<{ name?: string; port?: number; targetPort?: number | string; nodePort?: number; protocol?: string }>;
    ipFamilies?: string[];
  };
  const status = (item.status ?? {}) as { loadBalancer?: { ingress?: Array<{ ip?: string; hostname?: string }> } };
  const pods = usePods(context, item.metadata?.namespace, (pod) => matches(pod, spec.selector));
  const lb = (status.loadBalancer?.ingress ?? []).map((entry) => entry.ip ?? entry.hostname ?? '').filter(Boolean);

  return (
    <>
      {spec.selector && pods.length === 0 ? (
        <Callout tone="warn" title="No pods match this selector">
          Traffic to this service goes nowhere. Either the selector is wrong, or the workload behind it is not running.
        </Callout>
      ) : null}
      {spec.type === 'LoadBalancer' && lb.length === 0 ? (
        <Callout tone="warn" title="No load balancer address yet">
          The cloud controller has not assigned one. On a cluster with no load balancer provider it never will.
        </Callout>
      ) : null}

      <Section title="Routing">
        <Fields
          rows={[
            ['Type', spec.type ?? 'ClusterIP'],
            ['Cluster IP', (spec.clusterIPs ?? [spec.clusterIP]).filter(Boolean).join(', ') || 'none', true],
            lb.length > 0 ? ['Load balancer', lb.join(', '), true] : null,
            spec.externalIPs?.length ? ['External IPs', spec.externalIPs.join(', '), true] : null,
            spec.externalName ? ['External name', spec.externalName, true] : null,
            ['Session affinity', spec.sessionAffinity ?? 'None'],
            spec.ipFamilies?.length ? ['IP families', spec.ipFamilies.join(', ')] : null,
          ]}
        />
      </Section>

      <Section title="Ports">
        <Table
          head={['Name', 'Port', 'Target', 'Node port', 'Protocol']}
          align={['left', 'right', 'right', 'right', 'left']}
          rows={(spec.ports ?? []).map((port) => [
            <span key="n">{port.name ?? '-'}</span>,
            <span key="p" className="font-mono text-primary">{port.port}</span>,
            <span key="t" className="font-mono">{String(port.targetPort ?? port.port)}</span>,
            <span key="np" className="font-mono">{port.nodePort ?? '-'}</span>,
            <span key="pr">{port.protocol ?? 'TCP'}</span>,
          ])}
        />
      </Section>

      <Section title="Selector">
        <Chips values={spec.selector} empty="No selector. Endpoints are managed by hand." />
      </Section>

      <Section title="Backing pods" hint={`${pods.length}`}>
        <PodChips pods={pods} onNavigate={onNavigate} />
      </Section>
    </>
  );
}

function IngressDetail({ item, onNavigate }: DetailProps) {
  const spec = (item.spec ?? {}) as {
    ingressClassName?: string;
    tls?: Array<{ hosts?: string[]; secretName?: string }>;
    rules?: Array<{ host?: string; http?: { paths?: Array<{ path?: string; pathType?: string; backend?: { service?: { name?: string; port?: { number?: number; name?: string } } } }> } }>;
    defaultBackend?: { service?: { name?: string; port?: { number?: number } } };
  };
  const status = (item.status ?? {}) as { loadBalancer?: { ingress?: Array<{ ip?: string; hostname?: string }> } };
  const address = (status.loadBalancer?.ingress ?? []).map((entry) => entry.ip ?? entry.hostname ?? '').filter(Boolean);
  const namespace = item.metadata?.namespace;

  const rows: ReactNode[][] = [];
  for (const rule of spec.rules ?? []) {
    for (const path of rule.http?.paths ?? []) {
      const service = path.backend?.service;
      rows.push([
        <span key="h" className="break-words font-mono text-[11.5px] text-primary [overflow-wrap:anywhere]">{rule.host ?? '*'}</span>,
        <span key="p" className="font-mono text-[11.5px]">{path.path ?? '/'}</span>,
        <span key="t" className="text-[11px] text-tertiary">{path.pathType ?? 'Prefix'}</span>,
        service ? (
          <RefChip
            key="s"
            kind="Service"
            name={`${service.name}:${service.port?.number ?? service.port?.name ?? ''}`}
            onOpen={onNavigate ? () => onNavigate({ kind: 'Service', name: service.name ?? '', ...(namespace ? { namespace } : {}) }) : undefined}
          />
        ) : (
          <span key="s">-</span>
        ),
      ]);
    }
  }

  return (
    <>
      {address.length === 0 ? (
        <Callout tone="warn" title="No address yet">
          The ingress controller has not published one. Without it these rules are not reachable from outside.
        </Callout>
      ) : null}

      <Section title="Entry">
        <Fields
          rows={[
            ['Class', spec.ingressClassName ?? 'default'],
            ['Address', address.join(', ') || 'none', true],
            spec.defaultBackend?.service ? ['Default backend', `${spec.defaultBackend.service.name}:${spec.defaultBackend.service.port?.number ?? ''}`, true] : null,
          ]}
        />
      </Section>

      <Section title="Rules" hint={`${rows.length} path${rows.length === 1 ? '' : 's'}`}>
        <Table head={['Host', 'Path', 'Type', 'Backend']} rows={rows} />
      </Section>

      <Section title="TLS">
        <Table
          head={['Secret', 'Hosts']}
          rows={(spec.tls ?? []).map((tls) => [
            <RefChip
              key="s"
              kind="Secret"
              name={tls.secretName ?? ''}
              onOpen={onNavigate && tls.secretName ? () => onNavigate({ kind: 'Secret', name: tls.secretName ?? '', ...(namespace ? { namespace } : {}) }) : undefined}
            />,
            <span key="h" className="break-words font-mono text-[11.5px] [overflow-wrap:anywhere]">{(tls.hosts ?? []).join(', ')}</span>,
          ])}
          empty="No TLS. This ingress serves plain HTTP."
        />
      </Section>
    </>
  );
}

function EndpointsDetail({ item, onNavigate }: DetailProps) {
  const subsets = (item['subsets'] ?? []) as Array<{
    addresses?: Array<{ ip?: string; nodeName?: string; targetRef?: { kind?: string; name?: string; namespace?: string } }>;
    notReadyAddresses?: Array<{ ip?: string; targetRef?: { kind?: string; name?: string } }>;
    ports?: Array<{ name?: string; port?: number; protocol?: string }>;
  }>;
  const ready = subsets.flatMap((subset) => subset.addresses ?? []);
  const notReady = subsets.flatMap((subset) => subset.notReadyAddresses ?? []);
  const ports = subsets.flatMap((subset) => subset.ports ?? []);

  return (
    <>
      {ready.length === 0 ? (
        <Callout tone="warn" title="No ready addresses">
          Nothing is behind this service right now, so requests to it fail.
        </Callout>
      ) : null}

      <Section title="Ready" hint={`${ready.length}`}>
        <Table
          head={['Address', 'Node', 'Target']}
          rows={ready.map((address) => [
            <span key="a" className="font-mono text-[11.5px] text-primary">{address.ip}</span>,
            <span key="n" className="font-mono text-[11.5px]">{address.nodeName ?? '-'}</span>,
            address.targetRef?.name ? (
              <RefChip
                key="t"
                kind={address.targetRef.kind ?? 'Pod'}
                name={address.targetRef.name}
                onOpen={
                  onNavigate
                    ? () =>
                        onNavigate({
                          kind: address.targetRef?.kind ?? 'Pod',
                          name: address.targetRef?.name ?? '',
                          ...(address.targetRef?.namespace ? { namespace: address.targetRef.namespace } : {}),
                        })
                    : undefined
                }
              />
            ) : (
              <span key="t">-</span>
            ),
          ])}
        />
      </Section>

      {notReady.length > 0 ? (
        <Section title="Not ready" hint={`${notReady.length}`}>
          <Tags values={notReady.map((address) => `${address.ip}${address.targetRef?.name ? ` (${address.targetRef.name})` : ''}`)} tint="var(--status-warn)" />
        </Section>
      ) : null}

      <Section title="Ports">
        <Tags values={ports.map((port) => `${port.name ? `${port.name} ` : ''}${port.port}/${port.protocol ?? 'TCP'}`)} tint="var(--series-1)" />
      </Section>
    </>
  );
}

function NetworkPolicyDetail({ item }: DetailProps) {
  const spec = (item.spec ?? {}) as {
    podSelector?: { matchLabels?: Record<string, string> };
    policyTypes?: string[];
    ingress?: Array<{ from?: unknown[]; ports?: Array<{ port?: unknown; protocol?: string }> }>;
    egress?: Array<{ to?: unknown[]; ports?: Array<{ port?: unknown; protocol?: string }> }>;
  };
  const types = spec.policyTypes ?? [];
  const selectorEmpty = Object.keys(spec.podSelector?.matchLabels ?? {}).length === 0;

  return (
    <>
      {types.includes('Ingress') && (spec.ingress ?? []).length === 0 ? (
        <Callout tone="warn" title="Denies all ingress">
          An Ingress policy type with no rules means nothing may reach the selected pods.
        </Callout>
      ) : null}

      <Section title="Applies to">
        {selectorEmpty ? (
          <span className="text-[12px] text-secondary">Every pod in this namespace, because the pod selector is empty.</span>
        ) : (
          <Chips values={spec.podSelector?.matchLabels} />
        )}
        <div className="mt-2">
          <Tags values={types} tint="var(--series-1)" empty="no policy types" />
        </div>
      </Section>

      <Section title="Ingress rules" hint={`${(spec.ingress ?? []).length}`}>
        <Table
          head={['From', 'Ports']}
          rows={(spec.ingress ?? []).map((rule) => [
            <span key="f" className="break-words font-mono text-[11px] [overflow-wrap:anywhere]">{describePeers(rule.from)}</span>,
            <span key="p" className="font-mono text-[11px]">{(rule.ports ?? []).map((port) => `${String(port.port ?? 'any')}/${port.protocol ?? 'TCP'}`).join(', ') || 'all'}</span>,
          ])}
          empty={types.includes('Ingress') ? 'none, so all ingress is denied' : 'none'}
        />
      </Section>

      <Section title="Egress rules" hint={`${(spec.egress ?? []).length}`}>
        <Table
          head={['To', 'Ports']}
          rows={(spec.egress ?? []).map((rule) => [
            <span key="t" className="break-words font-mono text-[11px] [overflow-wrap:anywhere]">{describePeers(rule.to)}</span>,
            <span key="p" className="font-mono text-[11px]">{(rule.ports ?? []).map((port) => `${String(port.port ?? 'any')}/${port.protocol ?? 'TCP'}`).join(', ') || 'all'}</span>,
          ])}
          empty={types.includes('Egress') ? 'none, so all egress is denied' : 'none'}
        />
      </Section>
    </>
  );
}

function describePeers(peers: unknown[] | undefined): string {
  if (!peers?.length) return 'anywhere';
  return peers
    .map((peer) => {
      const entry = peer as { ipBlock?: { cidr?: string; except?: string[] }; namespaceSelector?: { matchLabels?: Record<string, string> }; podSelector?: { matchLabels?: Record<string, string> } };
      if (entry.ipBlock) return `${entry.ipBlock.cidr}${entry.ipBlock.except?.length ? ` except ${entry.ipBlock.except.join(', ')}` : ''}`;
      const parts: string[] = [];
      if (entry.namespaceSelector) parts.push(`namespace ${pairs(entry.namespaceSelector.matchLabels) || 'any'}`);
      if (entry.podSelector) parts.push(`pods ${pairs(entry.podSelector.matchLabels) || 'any'}`);
      return parts.join(' and ') || 'any';
    })
    .join('; ');
}

function pairs(values: Record<string, string> | undefined): string {
  return Object.entries(values ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
}

/* ---------------------------------------------------------------- storage */

function PvcDetail({ context, item, onNavigate }: DetailProps) {
  const spec = (item.spec ?? {}) as { storageClassName?: string; accessModes?: string[]; volumeName?: string; volumeMode?: string; resources?: { requests?: Record<string, string> } };
  const status = (item.status ?? {}) as { phase?: string; capacity?: Record<string, string>; conditions?: ConditionShape[] };
  const pods = usePods(context, item.metadata?.namespace, (pod) =>
    (((pod.spec as { volumes?: Array<{ persistentVolumeClaim?: { claimName?: string } }> } | undefined)?.volumes ?? [])).some(
      (volume) => volume.persistentVolumeClaim?.claimName === item.metadata?.name,
    ),
  );

  return (
    <>
      {status.phase === 'Pending' ? (
        <Callout tone="warn" title="Pending">
          No volume has been bound. Usually the storage class has no provisioner, or the cluster has no capacity that matches.
        </Callout>
      ) : null}

      <Section title="Claim">
        <Fields
          rows={[
            ['Phase', status.phase ?? '-'],
            ['Requested', spec.resources?.requests?.['storage'] ?? '-', true],
            ['Bound capacity', status.capacity?.['storage'] ?? 'not bound', true],
            ['Storage class', spec.storageClassName ?? 'default'],
            ['Access modes', (spec.accessModes ?? []).join(', ') || '-'],
            ['Volume mode', spec.volumeMode ?? 'Filesystem'],
            spec.volumeName
              ? [
                  'Volume',
                  <RefChip key="v" kind="PersistentVolume" name={spec.volumeName} onOpen={onNavigate ? () => onNavigate({ kind: 'PersistentVolume', name: spec.volumeName ?? '' }) : undefined} />,
                ]
              : null,
          ]}
        />
      </Section>

      {status.conditions?.length ? (
        <Section title="Conditions">
          <Conditions conditions={status.conditions} />
        </Section>
      ) : null}

      <Section title="Mounted by" hint={`${pods.length} pod${pods.length === 1 ? '' : 's'}`}>
        <PodChips pods={pods} onNavigate={onNavigate} />
      </Section>
    </>
  );
}

function PvDetail({ item, onNavigate }: DetailProps) {
  const spec = (item.spec ?? {}) as {
    capacity?: Record<string, string>;
    accessModes?: string[];
    persistentVolumeReclaimPolicy?: string;
    storageClassName?: string;
    claimRef?: { name?: string; namespace?: string };
    hostPath?: { path?: string };
    nfs?: { server?: string; path?: string };
    csi?: { driver?: string; volumeHandle?: string };
  };
  const status = (item.status ?? {}) as { phase?: string; reason?: string };
  const source = spec.csi
    ? `CSI ${spec.csi.driver} (${spec.csi.volumeHandle ?? ''})`
    : spec.nfs
      ? `NFS ${spec.nfs.server}:${spec.nfs.path}`
      : spec.hostPath
        ? `hostPath ${spec.hostPath.path}`
        : 'see the YAML';

  return (
    <>
      {status.phase === 'Released' ? (
        <Callout tone="warn" title="Released">
          The claim is gone but the volume is still here. With a Retain policy nothing reclaims it until you do.
        </Callout>
      ) : null}
      <Section title="Volume">
        <Fields
          rows={[
            ['Phase', status.phase ?? '-'],
            ['Capacity', spec.capacity?.['storage'] ?? '-', true],
            ['Access modes', (spec.accessModes ?? []).join(', ') || '-'],
            ['Reclaim policy', spec.persistentVolumeReclaimPolicy ?? '-'],
            ['Storage class', spec.storageClassName ?? 'none'],
            ['Source', source, true],
            status.reason ? ['Reason', status.reason] : null,
            spec.claimRef?.name
              ? [
                  'Claimed by',
                  <RefChip
                    key="c"
                    kind="PersistentVolumeClaim"
                    name={`${spec.claimRef.namespace ?? ''}/${spec.claimRef.name}`}
                    onOpen={
                      onNavigate
                        ? () =>
                            onNavigate({
                              kind: 'PersistentVolumeClaim',
                              name: spec.claimRef?.name ?? '',
                              ...(spec.claimRef?.namespace ? { namespace: spec.claimRef.namespace } : {}),
                            })
                        : undefined
                    }
                  />,
                ]
              : null,
          ]}
        />
      </Section>
    </>
  );
}

function StorageClassDetail({ item }: DetailProps) {
  const provisioner = item['provisioner'] as string | undefined;
  const parameters = item['parameters'] as Record<string, string> | undefined;
  const isDefault = item.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true';
  return (
    <>
      <Section title="Provisioning">
        <Fields
          rows={[
            ['Provisioner', provisioner ?? '-', true],
            ['Default class', isDefault ? 'yes' : 'no'],
            ['Reclaim policy', (item['reclaimPolicy'] as string) ?? 'Delete'],
            ['Volume binding', (item['volumeBindingMode'] as string) ?? 'Immediate'],
            ['Allow expansion', item['allowVolumeExpansion'] === true ? 'yes' : 'no'],
          ]}
        />
      </Section>
      <Section title="Parameters">
        <Chips values={parameters} empty="none" />
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- cluster */

function NamespaceDetail({ context, item, onNavigate }: DetailProps) {
  const name = item.metadata?.name;
  const status = (item.status ?? {}) as { phase?: string; conditions?: ConditionShape[] };
  const pods = usePods(context, name, () => true);
  const quotas = useList(context, 'ResourceQuota', name, () => true);
  const running = pods.filter((pod) => ((pod.status as { phase?: string } | undefined)?.phase ?? '') === 'Running').length;

  return (
    <>
      {status.phase === 'Terminating' ? (
        <Callout tone="warn" title="Terminating">
          Deletion is waiting on finalizers. A namespace stuck here usually has an API service or a custom resource that cannot be cleaned up.
        </Callout>
      ) : null}

      <Section title="Contents">
        <Fields
          rows={[
            ['Phase', status.phase ?? '-'],
            ['Pods', `${pods.length} (${running} running)`],
            ['Resource quotas', String(quotas.length)],
          ]}
        />
      </Section>

      {quotas.length > 0 ? (
        <Section title="Quota">
          <div className="flex flex-col gap-3">
            {quotas.map((quota) => {
              const quotaStatus = (quota.status ?? {}) as { hard?: Record<string, string>; used?: Record<string, string> };
              return Object.entries(quotaStatus.hard ?? {}).map(([key, hard]) => (
                <Bar
                  key={`${quota.metadata?.name}-${key}`}
                  label={key}
                  used={parseQuantity(quotaStatus.used?.[key])}
                  total={parseQuantity(hard)}
                  tint="var(--series-4)"
                />
              ));
            })}
          </div>
        </Section>
      ) : null}

      <Section title="Pods" hint={`${pods.length}`}>
        <PodChips pods={pods} onNavigate={onNavigate} limit={40} />
      </Section>
    </>
  );
}

function EventDetail({ item, onNavigate }: DetailProps) {
  const involved = (item['involvedObject'] ?? {}) as { kind?: string; name?: string; namespace?: string; fieldPath?: string };
  const source = (item['source'] ?? {}) as { component?: string; host?: string };
  const type = item['type'] as string | undefined;
  const count = item['count'] as number | undefined;

  return (
    <>
      <Callout tone={type === 'Warning' ? 'warn' : 'info'} title={(item['reason'] as string) ?? 'Event'}>
        {(item['message'] as string) ?? ''}
      </Callout>

      <Section title="About">
        <Fields
          rows={[
            ['Type', type ?? '-'],
            ['Count', String(count ?? 1)],
            ['First seen', item['firstTimestamp'] ? `${relativeAge(item['firstTimestamp'] as string)} ago` : '-'],
            ['Last seen', item['lastTimestamp'] ? `${relativeAge(item['lastTimestamp'] as string)} ago` : '-'],
            ['Reported by', `${source.component ?? '-'}${source.host ? ` on ${source.host}` : ''}`, true],
            involved.name
              ? [
                  'Object',
                  <RefChip
                    key="o"
                    kind={involved.kind ?? 'Pod'}
                    name={involved.name}
                    hint={involved.fieldPath}
                    onOpen={
                      onNavigate
                        ? () => onNavigate({ kind: involved.kind ?? 'Pod', name: involved.name ?? '', ...(involved.namespace ? { namespace: involved.namespace } : {}) })
                        : undefined
                    }
                  />,
                ]
              : null,
          ]}
        />
      </Section>
    </>
  );
}

/* ----------------------------------------------------------------- config */

function HpaDetail({ item, onNavigate }: DetailProps) {
  const spec = (item.spec ?? {}) as {
    minReplicas?: number;
    maxReplicas?: number;
    scaleTargetRef?: { kind?: string; name?: string };
    metrics?: Array<{ type?: string; resource?: { name?: string; target?: { type?: string; averageUtilization?: number; averageValue?: string } } }>;
  };
  const status = (item.status ?? {}) as {
    currentReplicas?: number;
    desiredReplicas?: number;
    conditions?: ConditionShape[];
    currentMetrics?: Array<{ resource?: { name?: string; current?: { averageUtilization?: number; averageValue?: string } } }>;
  };
  const namespace = item.metadata?.namespace;
  const atMax = (status.currentReplicas ?? 0) >= (spec.maxReplicas ?? 0);

  return (
    <>
      {atMax ? (
        <Callout tone="warn" title="At the maximum">
          This autoscaler cannot add replicas. If load is still rising, raise maxReplicas.
        </Callout>
      ) : null}

      <Section title="Scaling">
        <Fields
          rows={[
            [
              'Target',
              spec.scaleTargetRef?.name ? (
                <RefChip
                  key="t"
                  kind={spec.scaleTargetRef.kind ?? 'Deployment'}
                  name={spec.scaleTargetRef.name}
                  onOpen={
                    onNavigate
                      ? () => onNavigate({ kind: spec.scaleTargetRef?.kind ?? 'Deployment', name: spec.scaleTargetRef?.name ?? '', ...(namespace ? { namespace } : {}) })
                      : undefined
                  }
                />
              ) : (
                '-'
              ),
            ],
            ['Replicas', `${status.currentReplicas ?? 0} now, ${status.desiredReplicas ?? 0} wanted`],
            ['Range', `${spec.minReplicas ?? 1} to ${spec.maxReplicas ?? '-'}`],
          ]}
        />
        <div className="mt-3">
          <Bar label="Replicas" used={status.currentReplicas ?? 0} total={spec.maxReplicas ?? 1} tint={atMax ? 'var(--status-warn)' : 'var(--series-1)'} />
        </div>
      </Section>

      <Section title="Metrics">
        <Table
          head={['Metric', 'Target', 'Current']}
          rows={(spec.metrics ?? []).map((metric, index) => {
            const current = status.currentMetrics?.[index]?.resource?.current;
            return [
              <span key="m" className="font-medium text-primary">{metric.resource?.name ?? metric.type ?? '-'}</span>,
              <span key="t" className="font-mono text-[11.5px]">
                {metric.resource?.target?.averageUtilization !== undefined ? `${metric.resource.target.averageUtilization}%` : (metric.resource?.target?.averageValue ?? '-')}
              </span>,
              <span key="c" className="font-mono text-[11.5px] text-primary">
                {current?.averageUtilization !== undefined ? `${current.averageUtilization}%` : (current?.averageValue ?? 'unknown')}
              </span>,
            ];
          })}
          empty="No metrics configured."
        />
      </Section>

      {status.conditions?.length ? (
        <Section title="Conditions">
          <Conditions conditions={status.conditions} />
        </Section>
      ) : null}
    </>
  );
}

function PdbDetail({ item }: DetailProps) {
  const spec = (item.spec ?? {}) as { minAvailable?: number | string; maxUnavailable?: number | string; selector?: { matchLabels?: Record<string, string> } };
  const status = (item.status ?? {}) as { currentHealthy?: number; desiredHealthy?: number; disruptionsAllowed?: number; expectedPods?: number; conditions?: ConditionShape[] };
  const blocked = (status.disruptionsAllowed ?? 0) === 0;

  return (
    <>
      {blocked ? (
        <Callout tone="warn" title="No disruptions allowed">
          A drain of any node running these pods will block until more become healthy. This is the budget doing its job, and it is also the thing that stalls an upgrade.
        </Callout>
      ) : null}

      <Section title="Budget">
        <Fields
          rows={[
            spec.minAvailable !== undefined ? ['Min available', String(spec.minAvailable)] : null,
            spec.maxUnavailable !== undefined ? ['Max unavailable', String(spec.maxUnavailable)] : null,
            ['Healthy now', `${status.currentHealthy ?? 0} of ${status.expectedPods ?? 0}`],
            ['Wanted healthy', String(status.desiredHealthy ?? 0)],
            ['Disruptions allowed', String(status.disruptionsAllowed ?? 0)],
          ]}
        />
        <div className="mt-3">
          <Bar
            label="Healthy"
            used={status.currentHealthy ?? 0}
            total={Math.max(status.expectedPods ?? 0, 1)}
            tint={blocked ? 'var(--status-warn)' : 'var(--status-ok)'}
          />
        </div>
      </Section>

      <Section title="Selector">
        <Chips values={spec.selector?.matchLabels} />
      </Section>
    </>
  );
}

function QuotaDetail({ item }: DetailProps) {
  const status = (item.status ?? {}) as { hard?: Record<string, string>; used?: Record<string, string> };
  const scopes = ((item.spec ?? {}) as { scopes?: string[] }).scopes ?? [];
  const entries = Object.entries(status.hard ?? {});

  return (
    <>
      <Section title="Usage" hint={`${entries.length} limit${entries.length === 1 ? '' : 's'}`}>
        <div className="flex flex-col gap-3">
          {entries.map(([key, hard]) => {
            const used = parseQuantity(status.used?.[key]);
            const total = parseQuantity(hard);
            const memory = /memory|storage/i.test(key);
            return (
              <Bar
                key={key}
                label={key}
                used={memory ? used / 1024 ** 3 : used}
                total={memory ? total / 1024 ** 3 : total}
                {...(memory ? { unit: 'GiB' } : {})}
                tint={used / Math.max(total, 1) > 0.9 ? 'var(--status-error)' : 'var(--series-4)'}
              />
            );
          })}
          {entries.length === 0 ? <span className="text-[12px] text-tertiary">No limits set.</span> : null}
        </div>
      </Section>
      {scopes.length > 0 ? (
        <Section title="Scopes">
          <Tags values={scopes} tint="var(--series-1)" />
        </Section>
      ) : null}
    </>
  );
}

function LimitRangeDetail({ item }: DetailProps) {
  const limits = ((item.spec ?? {}) as { limits?: Array<Record<string, unknown>> }).limits ?? [];
  const rows: ReactNode[][] = [];
  for (const limit of limits) {
    const type = String(limit['type'] ?? '');
    for (const field of ['min', 'max', 'default', 'defaultRequest', 'maxLimitRequestRatio']) {
      const values = limit[field] as Record<string, string> | undefined;
      if (!values) continue;
      for (const [resource, value] of Object.entries(values)) {
        rows.push([
          <span key="t">{type}</span>,
          <span key="f" className="text-primary">{field}</span>,
          <span key="r" className="font-mono text-[11.5px]">{resource}</span>,
          <span key="v" className="font-mono text-[11.5px] text-primary">{value}</span>,
        ]);
      }
    }
  }
  return (
    <Section title="Limits" hint="applied to every pod and container created in this namespace">
      <Table head={['Type', 'Field', 'Resource', 'Value']} rows={rows} empty="No limits." />
    </Section>
  );
}

/* ---------------------------------------------------------------- access */

function ServiceAccountDetail({ context, item, onNavigate }: DetailProps) {
  const secrets = (item['secrets'] ?? []) as Array<{ name?: string }>;
  const pullSecrets = (item['imagePullSecrets'] ?? []) as Array<{ name?: string }>;
  const namespace = item.metadata?.namespace;
  const name = item.metadata?.name;
  const bindings = useList(context, 'RoleBinding', namespace, (binding) =>
    ((binding['subjects'] ?? []) as Array<{ kind?: string; name?: string; namespace?: string }>).some(
      (subject) => subject.kind === 'ServiceAccount' && subject.name === name,
    ),
  );
  const pods = usePods(context, namespace, (pod) => ((pod.spec as { serviceAccountName?: string } | undefined)?.serviceAccountName ?? 'default') === name);

  return (
    <>
      <Section title="Tokens and secrets">
        <Fields
          rows={[
            ['Mount token', item['automountServiceAccountToken'] === false ? 'no' : 'yes'],
            ['Secrets', <Tags key="s" values={secrets.map((secret) => secret.name ?? '')} empty="none, tokens are projected" />],
            pullSecrets.length > 0 ? ['Image pull secrets', <Tags key="p" values={pullSecrets.map((secret) => secret.name ?? '')} tint="var(--series-4)" />] : null,
          ]}
        />
      </Section>

      <Section title="Role bindings" hint={`${bindings.length} in this namespace`}>
        <Table
          head={['Binding', 'Grants']}
          rows={bindings.map((binding) => {
            const role = (binding['roleRef'] ?? {}) as { kind?: string; name?: string };
            return [
              <RefChip
                key="b"
                kind="RoleBinding"
                name={binding.metadata?.name ?? ''}
                onOpen={onNavigate ? () => onNavigate({ kind: 'RoleBinding', name: binding.metadata?.name ?? '', ...(namespace ? { namespace } : {}) }) : undefined}
              />,
              <RefChip
                key="r"
                kind={role.kind ?? 'Role'}
                name={role.name ?? ''}
                onOpen={onNavigate ? () => onNavigate({ kind: role.kind ?? 'Role', name: role.name ?? '', ...(role.kind === 'Role' && namespace ? { namespace } : {}) }) : undefined}
              />,
            ];
          })}
          empty="Nothing in this namespace binds a role to this account. It may still be bound cluster-wide."
        />
      </Section>

      <Section title="Pods running as this" hint={`${pods.length}`}>
        <PodChips pods={pods} onNavigate={onNavigate} />
      </Section>
    </>
  );
}

function RoleDetail({ item }: DetailProps) {
  const rules = (item['rules'] ?? []) as Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[]; resourceNames?: string[]; nonResourceURLs?: string[] }>;
  const wildcard = rules.some((rule) => rule.verbs?.includes('*') && rule.resources?.includes('*'));

  return (
    <>
      {wildcard ? (
        <Callout tone="warn" title="Grants everything">
          A rule here allows every verb on every resource. That is cluster-admin in all but name.
        </Callout>
      ) : null}
      <Section title="Rules" hint={`${rules.length}`}>
        <Table
          head={['API groups', 'Resources', 'Verbs']}
          rows={rules.map((rule) => [
            <span key="g" className="font-mono text-[11px]">{(rule.apiGroups ?? ['']).map((group) => group || 'core').join(', ')}</span>,
            <span key="r" className="break-words font-mono text-[11px] text-primary [overflow-wrap:anywhere]">
              {(rule.resources ?? rule.nonResourceURLs ?? []).join(', ')}
              {rule.resourceNames?.length ? ` (${rule.resourceNames.join(', ')})` : ''}
            </span>,
            <span key="v" className="break-words font-mono text-[11px] [overflow-wrap:anywhere]" style={{ color: rule.verbs?.includes('*') ? 'var(--status-warn)' : undefined }}>
              {(rule.verbs ?? []).join(', ')}
            </span>,
          ])}
          empty="No rules. This role grants nothing."
        />
      </Section>
    </>
  );
}

function BindingDetail({ item, onNavigate }: DetailProps) {
  const role = (item['roleRef'] ?? {}) as { kind?: string; name?: string };
  const subjects = (item['subjects'] ?? []) as Array<{ kind?: string; name?: string; namespace?: string }>;
  const namespace = item.metadata?.namespace;

  return (
    <>
      <Section title="Grants">
        <Fields
          rows={[
            [
              'Role',
              <RefChip
                key="r"
                kind={role.kind ?? 'Role'}
                name={role.name ?? ''}
                onOpen={onNavigate ? () => onNavigate({ kind: role.kind ?? 'Role', name: role.name ?? '', ...(role.kind === 'Role' && namespace ? { namespace } : {}) }) : undefined}
              />,
            ],
          ]}
        />
      </Section>

      <Section title="To" hint={`${subjects.length} subject${subjects.length === 1 ? '' : 's'}`}>
        <Table
          head={['Kind', 'Name', 'Namespace']}
          rows={subjects.map((subject) => [
            <span key="k">{subject.kind ?? '-'}</span>,
            subject.kind === 'ServiceAccount' ? (
              <RefChip
                key="n"
                kind="ServiceAccount"
                name={subject.name ?? ''}
                onOpen={
                  onNavigate
                    ? () => onNavigate({ kind: 'ServiceAccount', name: subject.name ?? '', ...(subject.namespace ? { namespace: subject.namespace } : {}) })
                    : undefined
                }
              />
            ) : (
              <span key="n" className="break-words font-mono text-[11.5px] text-primary [overflow-wrap:anywhere]">{subject.name}</span>
            ),
            <span key="ns" className="font-mono text-[11.5px]">{subject.namespace ?? '-'}</span>,
          ])}
          empty="No subjects. This binding grants nothing to anyone."
        />
      </Section>
    </>
  );
}

/* --------------------------------------------------------------- shared */

function Metadata({ item }: { item: KubeObject }) {
  const metadata = item.metadata ?? {};
  const owners = metadata.ownerReferences ?? [];
  return (
    <>
      <Section title="Labels">
        <Chips values={metadata.labels} />
      </Section>
      <Section title="Annotations">
        <Chips values={metadata.annotations} />
      </Section>
      <Section title="Metadata">
        <Fields
          rows={[
            ['Created', metadata.creationTimestamp ? `${relativeAge(metadata.creationTimestamp)} ago` : '-'],
            ['UID', metadata.uid ?? '-', true],
            owners.length > 0 ? ['Owned by', <Tags key="o" values={owners.map((owner) => `${owner.kind}/${owner.name}`)} tint="var(--series-1)" />] : null,
            metadata.finalizers?.length ? ['Finalizers', <Tags key="f" values={metadata.finalizers} tint="var(--status-warn)" />] : null,
          ]}
        />
      </Section>
    </>
  );
}

function PodChips({ pods, onNavigate, limit = 24 }: { pods: readonly KubeObject[]; onNavigate?: ((target: { kind: string; name?: string; namespace?: string }) => void) | undefined; limit?: number }) {
  if (pods.length === 0) return <span className="text-[12px] text-tertiary">none</span>;
  const shown = pods.slice(0, limit);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((pod) => {
        const phase = (pod.status as { phase?: string } | undefined)?.phase ?? '';
        return (
          <RefChip
            key={pod.metadata?.uid ?? pod.metadata?.name}
            kind="Pod"
            name={pod.metadata?.name ?? ''}
            hint={phase === 'Running' ? undefined : phase}
            onOpen={
              onNavigate
                ? () => onNavigate({ kind: 'Pod', name: pod.metadata?.name ?? '', ...(pod.metadata?.namespace ? { namespace: pod.metadata.namespace } : {}) })
                : undefined
            }
          />
        );
      })}
      {pods.length > shown.length ? <span className="self-center text-[11.5px] text-tertiary">and {pods.length - shown.length} more</span> : null}
    </div>
  );
}

/** True when every label in the selector is present on the object with the same value. */
function matches(object: KubeObject, selector: Record<string, string> | undefined): boolean {
  if (!selector || Object.keys(selector).length === 0) return false;
  const labels = object.metadata?.labels ?? {};
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

/**
 * A related list, fetched once when the pane opens.
 *
 * Deliberately a fetch and not a watch: a detail pane is open for seconds, the
 * lists it needs are small, and adding twenty-seven more watches to answer
 * "which pods are on this node" would cost more than it tells anyone.
 */
function useList(context: string, kind: string, namespace: string | undefined, predicate: (item: KubeObject) => boolean): KubeObject[] {
  const [items, setItems] = useState<KubeObject[]>([]);
  useEffect(() => {
    let cancelled = false;
    void api
      .list<KubeObject>(context, kind, namespace)
      .then((response) => {
        if (!cancelled) setItems(response.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [context, kind, namespace]);
  return items.filter(predicate);
}

function usePods(context: string, namespace: string | undefined, predicate: (pod: KubeObject) => boolean): KubeObject[] {
  return useList(context, 'Pod', namespace, predicate);
}

export { bytes };
