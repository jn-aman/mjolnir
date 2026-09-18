import { TimeSeries } from '../TimeSeries.tsx';
import { formatCpu, formatMemory } from '../../lib/metrics.ts';
import { StatusChip } from '../StatusChip.tsx';
import { age } from '../columns.tsx';
import { EditableKeyValues } from './EditableKeyValues.tsx';
import { askEntry, copyEntry, Menu, SEPARATOR, type MenuEntry } from '../ui/ContextMenu.tsx';
import { EditableText } from '../ui/EditableText.tsx';
import { detectObjectStorage, StorageCard } from './StorageCard.tsx';
import type { ContainerChange } from '../../lib/edits.ts';

/**
 * Everything the API says about a pod, laid out the way someone debugging one
 * reads it: what is wrong first, then what it is, then what it is made of.
 *
 * Deliberately exhaustive. A detail panel that shows six fields sends people
 * back to `kubectl describe`, and the whole argument for this app is that they
 * should not have to.
 */

export interface PodShape {
  metadata?: {
    name?: string;
    namespace?: string;
    uid?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: Array<{ kind?: string; name?: string; controller?: boolean }>;
  };
  spec?: {
    nodeName?: string;
    serviceAccountName?: string;
    restartPolicy?: string;
    priorityClassName?: string;
    nodeSelector?: Record<string, string>;
    tolerations?: Array<{ key?: string; operator?: string; value?: string; effect?: string }>;
    volumes?: Array<{ name?: string } & Record<string, unknown>>;
    containers?: ContainerSpec[];
    initContainers?: ContainerSpec[];
  };
  status?: {
    phase?: string;
    podIP?: string;
    hostIP?: string;
    qosClass?: string;
    startTime?: string;
    conditions?: Array<{
      type?: string;
      status?: string;
      reason?: string;
      message?: string;
      lastTransitionTime?: string;
    }>;
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
  };
}

interface ContainerSpec {
  name?: string;
  image?: string;
  imagePullPolicy?: string;
  command?: string[];
  args?: string[];
  ports?: Array<{ name?: string; containerPort?: number; protocol?: string }>;
  env?: Array<{ name?: string; value?: string; valueFrom?: unknown }>;
  volumeMounts?: Array<{ name?: string; mountPath?: string; readOnly?: boolean }>;
  resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
  livenessProbe?: Probe;
  readinessProbe?: Probe;
  startupProbe?: Probe;
}

interface Probe {
  httpGet?: { path?: string; port?: number | string };
  tcpSocket?: { port?: number | string };
  exec?: { command?: string[] };
  initialDelaySeconds?: number;
  periodSeconds?: number;
  failureThreshold?: number;
}

interface ContainerStatus {
  name?: string;
  image?: string;
  imageID?: string;
  containerID?: string;
  ready?: boolean;
  started?: boolean;
  restartCount?: number;
  state?: {
    running?: { startedAt?: string };
    waiting?: { reason?: string; message?: string };
    terminated?: { reason?: string; exitCode?: number; finishedAt?: string };
  };
  lastState?: {
    terminated?: { reason?: string; exitCode?: number; startedAt?: string; finishedAt?: string };
  };
}

interface PodDetailProps {
  readonly pod: PodShape;
  readonly metrics?:
    | { cpu: Array<{ t: number; v: number }>; memory: Array<{ t: number; v: number }> }
    | undefined;
  readonly onOpenLogs: (container: string, previous: boolean) => void;
  readonly onNavigate?: ((target: { kind: string; name?: string; namespace?: string; workspace?: string }) => void) | undefined;
  /** Merge-patches `metadata`. Present when the object can be edited from here. */
  readonly onPatchMetadata?: ((patch: Record<string, unknown>) => Promise<void>) | undefined;
  /** Changes a container's image, env or resources, on the owning workload. */
  readonly onEditContainer?: ((container: string, change: ContainerChange) => Promise<void>) | undefined;
  /** Decodes a key of a Secret in the pod's namespace, on request. */
  readonly onRevealSecret?: ((secret: string, key: string) => Promise<string>) | undefined;
  readonly onOpenWorkspace?: ((id: string) => void) | undefined;
  /** Opens the port-forward dialog, on this port. */
  readonly onForward?: ((port: number) => void) | undefined;
  readonly onShell?: ((container: string) => void) | undefined;
}

export function PodDetail({ pod, metrics, onOpenLogs, onNavigate, onPatchMetadata, onEditContainer, onRevealSecret, onOpenWorkspace, onForward, onShell }: PodDetailProps) {
  const storage = detectObjectStorage(pod.spec?.containers as never);
  const statuses = pod.status?.containerStatuses ?? [];
  const initStatuses = pod.status?.initContainerStatuses ?? [];
  const terminated = statuses.find((status) => status.lastState?.terminated)?.lastState?.terminated;
  const failing = pod.status?.conditions?.filter(
    (condition) => condition.status === 'False' && condition.message,
  );
  const memoryLimit = pod.spec?.containers?.[0]?.resources?.limits?.['memory'];

  return (
    <div className="space-y-5">
      {/* What is wrong, first and in plain language. */}
      {terminated ? (
        <Callout tone="error" title={`Last exit: ${terminated.reason} (code ${terminated.exitCode})`}>
          {terminated.reason === 'OOMKilled'
            ? 'The container exceeded its memory limit and the kernel killed it. Either raise the limit or reduce what it holds in memory.'
            : `The container exited with code ${terminated.exitCode}. Its output is under Logs, switch to Previous.`}
        </Callout>
      ) : null}

      {failing?.map((condition) => (
        <Callout key={condition.type} tone="warn" title={`${condition.type}: ${condition.reason}`}>
          {condition.message}
        </Callout>
      ))}

      {storage ? (
        <StorageCard
          detection={storage}
          pod={pod.metadata?.name ?? ''}
          namespace={pod.metadata?.namespace ?? ''}
          podIP={(pod.status as { podIP?: string } | undefined)?.podIP}
          onRevealSecret={onRevealSecret}
          onOpenBrowser={onOpenWorkspace ? () => onOpenWorkspace('storage') : undefined}
        />
      ) : null}

      {metrics && metrics.cpu.length > 0 ? (
        <Section title="Usage, last hour">
          <div className="space-y-3">
            <div className="rounded-lg border border-line bg-raised p-3">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-tertiary">CPU</span>
                <span className="font-mono text-[14px] tabular-nums text-primary">
                  {formatCpu(metrics.cpu.at(-1)?.v ?? 0)}
                </span>
              </div>
              <TimeSeries
                series={[{ name: 'cpu', points: metrics.cpu }]}
                height={120}
                format={formatCpu}
                ariaLabel="CPU usage of this pod over the last hour"
              />
            </div>
            <div className="rounded-lg border border-line bg-raised p-3">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-tertiary">Memory</span>
                <span className="font-mono text-[14px] tabular-nums text-primary">
                  {formatMemory(metrics.memory.at(-1)?.v ?? 0)}
                  {memoryLimit ? <span className="text-tertiary"> of {memoryLimit}</span> : null}
                </span>
              </div>
              <TimeSeries
                series={[{ name: 'memory', points: metrics.memory }]}
                height={120}
                format={formatMemory}
                ariaLabel="Memory usage of this pod over the last hour"
              />
            </div>
          </div>
        </Section>
      ) : null}

      <Section title="Pod">
        <Fields
          rows={[
            ['Status', pod.status?.phase ?? '-'],
            ['Node', pod.spec?.nodeName ?? '-', true, pod.spec?.nodeName && onNavigate ? () => onNavigate({ kind: 'Node', name: pod.spec?.nodeName ?? '' }) : undefined],
            ['Pod IP', pod.status?.podIP ?? '-', true],
            ['Host IP', pod.status?.hostIP ?? '-', true],
            ['QoS class', pod.status?.qosClass ?? '-'],
            ['Restart policy', pod.spec?.restartPolicy ?? '-'],
            ['Priority class', pod.spec?.priorityClassName ?? '-'],
            ['Service account', pod.spec?.serviceAccountName ?? '-', true],
            ['Started', pod.status?.startTime ? age(pod.status.startTime) + ' ago' : '-'],
            ['Created', pod.metadata?.creationTimestamp ? age(pod.metadata.creationTimestamp) + ' ago' : '-'],
            ['UID', pod.metadata?.uid ?? '-', true],
          ]}
        />
      </Section>

      {pod.metadata?.ownerReferences?.length ? (
        <Section title="Controlled by">
          <div className="flex flex-wrap gap-1.5">
            {pod.metadata.ownerReferences.map((owner) => (
              <span
                key={owner.name}
                className="rounded-md border border-line bg-raised px-2 py-1 font-mono text-[11.5px] text-primary"
              >
                <span className="text-secondary">{owner.kind}/</span>
                {owner.name}
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Labels">
        {onPatchMetadata ? (
          <EditableKeyValues
            values={pod.metadata?.labels ?? {}}
            testId="labels"
            onPatch={(patch) => onPatchMetadata({ labels: patch })}
          />
        ) : (
          <KeyValues values={pod.metadata?.labels ?? {}} />
        )}
      </Section>

      <Section title="Annotations">
        {onPatchMetadata ? (
          <EditableKeyValues
            values={pod.metadata?.annotations ?? {}}
            testId="annotations"
            truncate
            onPatch={(patch) => onPatchMetadata({ annotations: patch })}
          />
        ) : (
          <KeyValues values={pod.metadata?.annotations ?? {}} truncate />
        )}
      </Section>

      {pod.status?.conditions?.length ? (
        <Section title="Conditions">
          <div className="overflow-hidden rounded-md border border-line">
            {pod.status.conditions.map((condition) => (
              <div
                key={condition.type}
                className="grid items-center gap-3 border-b border-subtle bg-raised px-3 py-1.5 last:border-b-0"
                style={{ gridTemplateColumns: '6px minmax(0, 1.3fr) 44px minmax(0, 1fr)' }}
              >
                <span
                  aria-hidden
                  className="h-[6px] w-[6px] rounded-full"
                  style={{
                    background:
                      condition.status === 'True' ? 'var(--status-ok)' : 'var(--status-warn)',
                  }}
                />
                <span title={condition.type} className="truncate text-[12.5px] text-primary">
                  {condition.type}
                </span>
                <span className="font-mono text-[11.5px] text-secondary">{condition.status}</span>
                <span title={condition.reason} className="truncate text-[12px] text-secondary">
                  {condition.reason ?? ''}
                </span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {initStatuses.length > 0 ? (
        <Section title={`Init containers (${initStatuses.length})`}>
          <div className="space-y-2">
            {initStatuses.map((status) => (
              <ContainerCard
                key={status.name}
                status={status}
                spec={pod.spec?.initContainers?.find((c) => c.name === status.name)}
                onOpenLogs={onOpenLogs}
              />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={`Containers (${statuses.length || pod.spec?.containers?.length || 0})`}>
        <div className="space-y-2">
          {(statuses.length
            ? statuses
            : (pod.spec?.containers ?? []).map((spec) => ({ name: spec.name }) as ContainerStatus)
          ).map((status) => (
            <ContainerCard
              key={status.name}
              status={status}
              spec={pod.spec?.containers?.find((c) => c.name === status.name)}
              onEditContainer={onEditContainer}
              onForward={onForward}
              onShell={onShell}
              onOpenLogs={onOpenLogs}
            />
          ))}
        </div>
      </Section>

      {pod.spec?.volumes?.length ? (
        <Section title={`Volumes (${pod.spec.volumes.length})`}>
          <div className="space-y-1">
            {pod.spec.volumes.map((volume) => {
              const kind = Object.keys(volume).find((key) => key !== 'name') ?? 'unknown';
              return (
                <div
                  key={volume.name}
                  className="flex items-center gap-2 rounded-md border border-line bg-raised px-3 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-primary">
                    {volume.name}
                  </span>
                  <span className="shrink-0 rounded-xs bg-overlay px-1.5 py-[1px] font-mono text-[10.5px] text-tertiary">
                    {kind}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      {pod.spec?.tolerations?.length ? (
        <Section title={`Tolerations (${pod.spec.tolerations.length})`}>
          <div className="space-y-1">
            {pod.spec.tolerations.map((toleration, index) => (
              <div
                key={`${toleration.key ?? 'all'}-${index}`}
                className="rounded-md border border-line bg-raised px-3 py-1.5 font-mono text-[11.5px] text-secondary"
              >
                {toleration.key ?? '(all keys)'} {toleration.operator ?? 'Equal'}{' '}
                {toleration.value ?? ''} → {toleration.effect ?? 'all effects'}
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function ContainerCard({
  status,
  spec,
  onOpenLogs,
  onEditContainer,
  onForward,
  onShell,

}: {
  status: ContainerStatus;
  spec?: ContainerSpec | undefined;
  onOpenLogs: (container: string, previous: boolean) => void;
  onEditContainer?: ((container: string, change: ContainerChange) => Promise<void>) | undefined;
  onForward?: ((port: number) => void) | undefined;
  onShell?: ((container: string) => void) | undefined;
}) {
  const state = status.state?.waiting
    ? status.state.waiting.reason ?? 'Waiting'
    : status.state?.terminated
      ? status.state.terminated.reason ?? 'Terminated'
      : status.ready
        ? 'Running'
        : 'NotReady';

  const hasPrevious = Boolean(status.lastState?.terminated);

  const containerMenu: MenuEntry[] = [
    askEntry('Ask about this container', `Container ${status.name ?? ''} (image ${status.image ?? spec?.image ?? 'unknown'}): what does it run, is it healthy, and what do its recent logs say?`),
    ...(onShell ? [{ id: 'shell', label: 'Shell', onSelect: () => onShell(status.name ?? '') }] : []),
    { id: 'logs', label: 'Logs', onSelect: () => onOpenLogs(status.name ?? '', false) },
    { id: 'previous', label: 'Previous logs', onSelect: () => onOpenLogs(status.name ?? '', true) },
    SEPARATOR,
    ...copyEntry('copy-name', 'Copy container name', status.name),
    ...copyEntry('copy-image', 'Copy image', status.image ?? spec?.image),
    ...copyEntry(
      'copy-env',
      'Copy env as .env',
      spec?.env?.length ? spec.env.map((entry) => `${entry.name ?? ''}=${entry.value ?? ''}`).join('\n') : undefined,
    ),
  ];

  return (
    <Menu label={status.name ?? ''} entries={containerMenu} testId="container-menu">
    <div className="rounded-lg border border-line bg-raised">
      <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
        <span className="font-mono text-[12.5px] text-primary">{status.name}</span>
        <StatusChip status={state} />
        {(status.restartCount ?? 0) > 0 ? (
          <span className="font-mono text-[11px] text-warn">{status.restartCount} restarts</span>
        ) : null}
        <div className="flex-1" />
        {onShell ? (
          <button
            type="button"
            data-testid="container-shell"
            onClick={() => onShell(status.name ?? '')}
            className="rounded-sm px-1.5 py-0.5 text-[11.5px] text-secondary hover:bg-hover hover:text-primary"
          >
            Shell
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onOpenLogs(status.name ?? '', false)}
          className="rounded-sm px-1.5 py-0.5 text-[11.5px] text-secondary hover:bg-hover hover:text-primary"
        >
          Logs
        </button>
        {hasPrevious ? (
          <button
            type="button"
            onClick={() => onOpenLogs(status.name ?? '', true)}
            className="rounded-sm px-1.5 py-0.5 text-[11.5px] text-error hover:bg-hover"
          >
            Previous
          </button>
        ) : null}
      </div>

      <div className="space-y-2 px-3 py-2">
        <Line
          label="Image"
          value={spec?.image ?? status.image ?? '-'}
          mono
          {...(onEditContainer ? { onEdit: (next: string) => onEditContainer(status.name ?? '', { image: next }) } : {})}
        />
        {spec?.imagePullPolicy ? <Line label="Pull policy" value={spec.imagePullPolicy} /> : null}
        {status.state?.waiting?.message ? (
          <Line label="Message" value={status.state.waiting.message} tone="warn" />
        ) : null}

        {spec?.ports?.length ? (
          <div className="flex gap-3 text-[11.5px]">
            <span className="w-[86px] shrink-0 text-secondary">Ports</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 font-mono">
              {spec.ports.map((port) => (
                <span key={`${port.containerPort}-${port.name ?? ''}`} className="inline-flex items-center gap-1 text-secondary">
                  {port.containerPort}/{port.protocol ?? 'TCP'}
                  {port.name ? <span className="text-tertiary">({port.name})</span> : null}
                  {onForward && port.containerPort ? (
                    <button
                      type="button"
                      data-testid={`forward-port-${port.containerPort}`}
                      onClick={() => onForward(port.containerPort ?? 0)}
                      className="ml-0.5 rounded-xs px-1 font-sans text-[10.5px] text-accent hover:bg-accent-subtle"
                    >
                      forward
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {spec?.resources?.requests || spec?.resources?.limits || onEditContainer ? (
          <div className="flex gap-3 text-[11.5px]">
            <span className="w-[86px] shrink-0 text-secondary">Resources</span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1 font-mono text-secondary" data-testid="resources">
              {(['requests', 'limits'] as const).map((group) =>
                (['cpu', 'memory'] as const).map((resource) => {
                  const current = spec?.resources?.[group]?.[resource];
                  return (
                    <span key={`${group}-${resource}`} className="whitespace-nowrap">
                      <span className="text-tertiary">
                        {group === 'requests' ? 'req' : 'lim'} {resource}=
                      </span>
                      {onEditContainer ? (
                        <EditableText
                          label={`${group} ${resource}`}
                          value={current ?? '-'}
                          onCommit={(next) => onEditContainer(status.name ?? '', { resources: { [group]: { [resource]: next } } })}
                        />
                      ) : (
                        current ?? '-'
                      )}
                    </span>
                  );
                }),
              )}
            </div>
          </div>
        ) : null}

        {spec?.volumeMounts?.length ? (
          <Line
            label="Mounts"
            mono
            value={spec.volumeMounts
              .map((mount) => `${mount.mountPath}${mount.readOnly ? ' (ro)' : ''}`)
              .join(', ')}
          />
        ) : null}

        {spec?.livenessProbe ? <Line label="Liveness" mono value={describeProbe(spec.livenessProbe)} /> : null}
        {spec?.readinessProbe ? <Line label="Readiness" mono value={describeProbe(spec.readinessProbe)} /> : null}

        {spec?.command?.length ? <Line label="Command" mono value={spec.command.join(' ')} /> : null}
        {spec?.env?.length ? (
          <div className="flex gap-3 text-[11.5px]">
            <span className="w-[86px] shrink-0 text-secondary">Env</span>
            <dl className="m-0 min-w-0 flex-1 space-y-[2px] font-mono">
              {spec.env.map((entry) => (
                <div key={entry.name} className="flex gap-2">
                  <dt className="shrink-0 text-accent">{entry.name}</dt>
                  <dd className="m-0 min-w-0 truncate text-secondary">
                    {entry.value !== undefined
                      ? (
                          <>
                            ={' '}
                            {onEditContainer ? (
                              <EditableText
                                label={entry.name ?? 'env'}
                                value={entry.value}
                                onCommit={(next) => onEditContainer(status.name ?? '', { env: { [entry.name ?? '']: next } })}
                              />
                            ) : (
                              entry.value
                            )}
                          </>
                        )
                      : entry.valueFrom
                        ? `← ${describeValueFrom(entry.valueFrom)}`
                        : ''}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
    </div>
    </Menu>
  );
}

/** Where an env var comes from, named the way the manifest names it. */
function describeValueFrom(source: unknown): string {
  if (!source || typeof source !== 'object') return 'valueFrom';
  const from = source as Record<string, { name?: string; key?: string; fieldPath?: string; resource?: string }>;
  if (from['secretKeyRef']) return `secret ${from['secretKeyRef'].name}/${from['secretKeyRef'].key}`;
  if (from['configMapKeyRef']) return `configMap ${from['configMapKeyRef'].name}/${from['configMapKeyRef'].key}`;
  if (from['fieldRef']) return `field ${from['fieldRef'].fieldPath}`;
  if (from['resourceFieldRef']) return `resource ${from['resourceFieldRef'].resource}`;
  return Object.keys(from)[0] ?? 'valueFrom';
}

function describeProbe(probe: Probe): string {
  const target = probe.httpGet
    ? `http ${probe.httpGet.path ?? '/'}:${probe.httpGet.port ?? ''}`
    : probe.tcpSocket
      ? `tcp :${probe.tcpSocket.port ?? ''}`
      : probe.exec
        ? `exec ${probe.exec.command?.join(' ') ?? ''}`
        : 'unknown';
  const timing = [
    probe.initialDelaySeconds !== undefined ? `delay ${probe.initialDelaySeconds}s` : null,
    probe.periodSeconds !== undefined ? `every ${probe.periodSeconds}s` : null,
    probe.failureThreshold !== undefined ? `×${probe.failureThreshold}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return timing ? `${target} · ${timing}` : target;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-tertiary">
        {title}
      </h3>
      {children}
    </section>
  );
}

type FieldRow = readonly [label: string, value: string, mono?: boolean, onClick?: (() => void) | undefined];

function Fields({ rows }: { rows: readonly FieldRow[] }) {
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-[6px] text-[12.5px]">
      {rows.map(([label, value, mono, onClick]) => (
        <div key={label} className="contents">
          <dt className="text-secondary">{label}</dt>
          <dd className={`m-0 truncate ${mono ? 'font-mono text-[12px]' : ''}`}>
            {onClick ? (
              <button
                type="button"
                onClick={onClick}
                className="truncate text-accent underline-offset-2 hover:underline"
              >
                {value}
              </button>
            ) : (
              <span className="text-primary">{value}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function KeyValues({ values, truncate = false }: { values: Record<string, string>; truncate?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(values).map(([key, value]) => (
        <span
          key={key}
          title={`${key}=${value}`}
          className={`rounded-md border border-[var(--border-strong)] bg-overlay px-2 py-[3px] font-mono text-[11px] ${
            truncate ? 'max-w-[280px] truncate' : ''
          }`}
        >
          <span className="text-secondary">{key}</span>
          <span className="text-tertiary">=</span>
          <span className="text-primary">{value}</span>
        </span>
      ))}
    </div>
  );
}

function Line({
  label,
  value,
  mono = false,
  tone = 'default',
  onEdit,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'default' | 'warn';
  onEdit?: ((next: string) => Promise<void>) | undefined;
}) {
  return (
    <div className="flex gap-3 text-[11.5px]">
      <span className="w-[86px] shrink-0 text-secondary">{label}</span>
      <span
        className={`min-w-0 flex-1 break-words ${mono ? 'font-mono' : ''} ${
          tone === 'warn' ? 'text-warn' : 'text-secondary'
        }`}
      >
        {onEdit ? <EditableText label={label.toLowerCase()} value={value} mono={mono} onCommit={onEdit} testId={`edit-${label.toLowerCase()}`} /> : value}
      </span>
    </div>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: 'error' | 'warn';
  title: string;
  children: React.ReactNode;
}) {
  const border = tone === 'error' ? 'var(--status-error-border)' : 'var(--status-warn)';
  const bg = tone === 'error' ? 'bg-error-bg' : 'bg-warn-bg';
  const text = tone === 'error' ? 'text-error' : 'text-warn';
  return (
    <div className={`rounded-lg border ${bg} p-3`} style={{ borderColor: border }}>
      <div className={`mb-1 text-[12.5px] font-semibold ${text}`}>{title}</div>
      <div className="text-[12px] leading-[18px] text-secondary">{children}</div>
    </div>
  );
}
