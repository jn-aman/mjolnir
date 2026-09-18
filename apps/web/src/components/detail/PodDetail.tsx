import { Sparkline } from '../TimeSeries.tsx';
import { StatusChip } from '../StatusChip.tsx';
import { age } from '../columns.tsx';

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
}

export function PodDetail({ pod, metrics, onOpenLogs }: PodDetailProps) {
  const statuses = pod.status?.containerStatuses ?? [];
  const initStatuses = pod.status?.initContainerStatuses ?? [];
  const terminated = statuses.find((status) => status.lastState?.terminated)?.lastState?.terminated;
  const failing = pod.status?.conditions?.filter(
    (condition) => condition.status === 'False' && condition.message,
  );

  return (
    <div className="space-y-5">
      {/* What is wrong, first and in plain language. */}
      {terminated ? (
        <Callout tone="error" title={`Last exit: ${terminated.reason} (code ${terminated.exitCode})`}>
          {terminated.reason === 'OOMKilled'
            ? 'The container exceeded its memory limit and the kernel killed it. Either raise the limit or reduce what it holds in memory.'
            : `The container exited with code ${terminated.exitCode}. Its output is under Logs — switch to Previous.`}
        </Callout>
      ) : null}

      {failing?.map((condition) => (
        <Callout key={condition.type} tone="warn" title={`${condition.type}: ${condition.reason}`}>
          {condition.message}
        </Callout>
      ))}

      {metrics && metrics.cpu.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          <MetricTile
            label="CPU"
            value={`${((metrics.cpu.at(-1)?.v ?? 0) * 1000).toFixed(0)}m`}
            points={metrics.cpu}
            tone="var(--series-1)"
          />
          <MetricTile
            label="Memory"
            value={`${((metrics.memory.at(-1)?.v ?? 0) / (1024 * 1024)).toFixed(0)} MiB`}
            points={metrics.memory}
            tone="var(--series-3)"
          />
        </div>
      ) : null}

      <Section title="Pod">
        <Fields
          rows={[
            ['Status', pod.status?.phase ?? '—'],
            ['Node', pod.spec?.nodeName ?? '—', true],
            ['Pod IP', pod.status?.podIP ?? '—', true],
            ['Host IP', pod.status?.hostIP ?? '—', true],
            ['QoS class', pod.status?.qosClass ?? '—'],
            ['Restart policy', pod.spec?.restartPolicy ?? '—'],
            ['Priority class', pod.spec?.priorityClassName ?? '—'],
            ['Service account', pod.spec?.serviceAccountName ?? '—', true],
            ['Started', pod.status?.startTime ? age(pod.status.startTime) + ' ago' : '—'],
            ['Created', pod.metadata?.creationTimestamp ? age(pod.metadata.creationTimestamp) + ' ago' : '—'],
            ['UID', pod.metadata?.uid ?? '—', true],
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

      {pod.metadata?.labels ? (
        <Section title="Labels">
          <KeyValues values={pod.metadata.labels} />
        </Section>
      ) : null}

      {pod.metadata?.annotations ? (
        <Section title="Annotations">
          <KeyValues values={pod.metadata.annotations} truncate />
        </Section>
      ) : null}

      {pod.status?.conditions?.length ? (
        <Section title="Conditions">
          <div className="overflow-hidden rounded-md border border-line">
            {pod.status.conditions.map((condition) => (
              <div
                key={condition.type}
                className="flex items-center gap-2 border-b border-subtle bg-raised px-3 py-1.5 last:border-b-0"
              >
                <span
                  aria-hidden
                  className="h-[6px] w-[6px] shrink-0 rounded-full"
                  style={{
                    background:
                      condition.status === 'True' ? 'var(--status-ok)' : 'var(--status-warn)',
                  }}
                />
                <span className="w-[150px] shrink-0 text-[12.5px] text-primary">{condition.type}</span>
                <span className="w-[54px] shrink-0 font-mono text-[11.5px] text-secondary">
                  {condition.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-secondary">
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
}: {
  status: ContainerStatus;
  spec?: ContainerSpec | undefined;
  onOpenLogs: (container: string, previous: boolean) => void;
}) {
  const state = status.state?.waiting
    ? status.state.waiting.reason ?? 'Waiting'
    : status.state?.terminated
      ? status.state.terminated.reason ?? 'Terminated'
      : status.ready
        ? 'Running'
        : 'NotReady';

  const hasPrevious = Boolean(status.lastState?.terminated);

  return (
    <div className="rounded-lg border border-line bg-raised">
      <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
        <span className="font-mono text-[12.5px] text-primary">{status.name}</span>
        <StatusChip status={state} />
        {(status.restartCount ?? 0) > 0 ? (
          <span className="font-mono text-[11px] text-warn">{status.restartCount} restarts</span>
        ) : null}
        <div className="flex-1" />
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
        <Line label="Image" value={status.image ?? spec?.image ?? '—'} mono />
        {spec?.imagePullPolicy ? <Line label="Pull policy" value={spec.imagePullPolicy} /> : null}
        {status.state?.waiting?.message ? (
          <Line label="Message" value={status.state.waiting.message} tone="warn" />
        ) : null}

        {spec?.ports?.length ? (
          <Line
            label="Ports"
            mono
            value={spec.ports
              .map((port) => `${port.containerPort}/${port.protocol ?? 'TCP'}${port.name ? ` (${port.name})` : ''}`)
              .join(', ')}
          />
        ) : null}

        {spec?.resources?.requests || spec?.resources?.limits ? (
          <Line
            label="Resources"
            mono
            value={[
              spec.resources.requests
                ? `req ${Object.entries(spec.resources.requests).map(([k, v]) => `${k}=${v}`).join(' ')}`
                : null,
              spec.resources.limits
                ? `lim ${Object.entries(spec.resources.limits).map(([k, v]) => `${k}=${v}`).join(' ')}`
                : null,
            ]
              .filter(Boolean)
              .join('  ·  ')}
          />
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
          <Line label="Env" value={`${spec.env.length} variables`} />
        ) : null}
      </div>
    </div>
  );
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

function Fields({ rows }: { rows: Array<[string, string, boolean?]> }) {
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-[6px] text-[12.5px]">
      {rows.map(([label, value, mono]) => (
        <div key={label} className="contents">
          <dt className="text-tertiary">{label}</dt>
          <dd className={`m-0 truncate text-primary ${mono ? 'font-mono text-[12px]' : ''}`}>
            {value}
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
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'default' | 'warn';
}) {
  return (
    <div className="flex gap-3 text-[11.5px]">
      <span className="w-[86px] shrink-0 text-secondary">{label}</span>
      <span
        className={`min-w-0 flex-1 break-words ${mono ? 'font-mono' : ''} ${
          tone === 'warn' ? 'text-warn' : 'text-secondary'
        }`}
      >
        {value}
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

function MetricTile({
  label,
  value,
  points,
  tone,
}: {
  label: string;
  value: string;
  points: Array<{ t: number; v: number }>;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-raised p-3">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-tertiary">
        {label}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="font-mono text-[19px] leading-none tabular-nums text-primary">{value}</span>
        <Sparkline points={points} tone={tone} width={92} height={26} />
      </div>
    </div>
  );
}
