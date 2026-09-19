import { gzipSync } from 'node:zlib';
import type { KubeObject } from '@mjolnir/schemas';
import { hours, iso, uid } from './clock.ts';
import { DEMO_CERT_MANAGER, DEMO_INGRESSES, DEMO_TLS_SECRETS } from './extras.ts';

/**
 * A synthetic cluster.
 *
 * This exists for three reasons, in order of how much they matter:
 *
 * 1. **The E2E suite cannot run without it.** Playwright needs a cluster that
 *    contains a CrashLoopBackOff pod at a known moment, every time.
 * 2. **Nobody should have to point a new tool at production to try it.**
 * 3. Screenshots and demos need a cluster that is not somebody's real one.
 *
 * It is deliberately *alive*, metrics jitter, logs accumulate, the crash-looper
 * restarts, because a frozen fixture hides every bug that only appears when
 * data changes underneath the UI.
 */

export const DEMO_CONTEXT = 'demo';

export function isDemoContext(context: string): boolean {
  return context === DEMO_CONTEXT;
}


const minutes = (n: number): number => n * 60_000;

/** Deterministic pseudo-random, so a screenshot taken twice looks the same. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

const rand = seeded(0x5eed);


export const NAMESPACES = ['payments', 'checkout', 'ingest', 'platform', 'kube-system'] as const;
export type DemoNamespace = (typeof NAMESPACES)[number];

interface PodOptions {
  readonly namespace: DemoNamespace;
  readonly name: string;
  readonly app: string;
  readonly node: string;
  readonly containers: Array<{ name: string; image: string; env?: unknown[]; ports?: unknown[] }>;
  readonly phase?: 'Running' | 'Pending' | 'Succeeded' | 'Failed';
  readonly restarts?: number;
  readonly waiting?: { reason: string; message: string };
  readonly lastTerminated?: { exitCode: number; reason: string; finishedAgoMs: number };
  readonly ageMs?: number;
  readonly unschedulable?: string;
}

function makePod(options: PodOptions): KubeObject {
  const phase = options.phase ?? 'Running';
  const ready = phase === 'Running' && !options.waiting;
  const ageMs = options.ageMs ?? hours(6);

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: options.name,
      namespace: options.namespace,
      uid: uid(),
      creationTimestamp: iso(ageMs),
      labels: { app: options.app, 'app.kubernetes.io/name': options.app },
      ownerReferences: [
        {
          apiVersion: 'apps/v1',
          kind: 'ReplicaSet',
          name: `${options.app}-${options.name.split('-')[1] ?? '000'}`,
          controller: true,
        },
      ],
    },
    spec: {
      nodeName: options.unschedulable ? undefined : options.node,
      serviceAccountName: options.app,
      restartPolicy: 'Always',
      containers: options.containers.map((container) => ({
        name: container.name,
        image: container.image,
        ...(container.env ? { env: container.env } : {}),
        ...(container.ports ? { ports: container.ports } : {}),
        resources: {
          requests: { cpu: '100m', memory: '128Mi' },
          limits: { cpu: '1', memory: '512Mi' },
        },
      })),
    },
    status: {
      phase,
      podIP: options.unschedulable ? undefined : `10.42.${Math.floor(rand() * 8)}.${Math.floor(rand() * 250) + 2}`,
      hostIP: options.unschedulable ? undefined : '10.0.1.14',
      qosClass: 'Burstable',
      startTime: iso(ageMs),
      conditions: [
        { type: 'Ready', status: ready ? 'True' : 'False', lastTransitionTime: iso(ageMs) },
        ...(options.unschedulable
          ? [
              {
                type: 'PodScheduled',
                status: 'False',
                reason: 'Unschedulable',
                message: options.unschedulable,
                lastTransitionTime: iso(minutes(9)),
              },
            ]
          : [{ type: 'PodScheduled', status: 'True', lastTransitionTime: iso(ageMs) }]),
      ],
      // A pod that was never scheduled has no container statuses at all, not
      // empty ones. This is the null path the UI must render as dashes rather
      // than NaN, so the fixture has to get it right.
      containerStatuses: options.unschedulable ? undefined : options.containers.map((container) => ({
        name: container.name,
        image: container.image,
        imageID: `docker-pullable://${container.image}@sha256:${'ab12cd34'.repeat(8)}`,
        containerID: options.unschedulable ? undefined : `containerd://${'f0'.repeat(32)}`,
        ready,
        started: ready,
        restartCount: options.restarts ?? 0,
        state: options.waiting
          ? { waiting: options.waiting }
          : phase === 'Pending'
            ? { waiting: { reason: 'ContainerCreating', message: '' } }
            : { running: { startedAt: iso(ageMs) } },
        ...(options.lastTerminated
          ? {
              lastState: {
                terminated: {
                  exitCode: options.lastTerminated.exitCode,
                  reason: options.lastTerminated.reason,
                  startedAt: iso(options.lastTerminated.finishedAgoMs + minutes(4)),
                  finishedAt: iso(options.lastTerminated.finishedAgoMs),
                  containerID: `containerd://${'a1'.repeat(32)}`,
                },
              },
            }
          : {}),
      })),
    },
  };
}

/** The pods every test and screenshot depends on. Names are stable. */
export const DEMO_PODS: readonly KubeObject[] = [
  makePod({
    namespace: 'payments',
    name: 'api-7d9f4b8c6-x2mqz',
    app: 'api',
    node: 'ip-10-0-1-14',
    containers: [
      { name: 'api', image: 'registry.example.com/payments/api:1.24.3' },
      { name: 'istio-proxy', image: 'docker.io/istio/proxyv2:1.24.1' },
    ],
  }),
  makePod({
    namespace: 'payments',
    name: 'api-7d9f4b8c6-k8lpw',
    app: 'api',
    node: 'ip-10-0-2-31',
    containers: [
      { name: 'api', image: 'registry.example.com/payments/api:1.24.3' },
      { name: 'istio-proxy', image: 'docker.io/istio/proxyv2:1.24.1' },
    ],
  }),
  makePod({
    namespace: 'payments',
    name: 'ledger-6c4d8f9b7-nn4tz',
    app: 'ledger',
    node: 'ip-10-0-1-14',
    containers: [{ name: 'ledger', image: 'registry.example.com/payments/ledger:0.9.1' }],
  }),
  makePod({
    namespace: 'checkout',
    name: 'web-5c8b9d774-lk4pn',
    app: 'web',
    node: 'ip-10-0-2-31',
    containers: [{ name: 'web', image: 'registry.example.com/checkout/web:3.1.0' }],
  }),
  // The CrashLoopBackOff pod. Its previous container exited OOMKilled, which is
  // what the log viewer's Previous mode is tested against.
  makePod({
    namespace: 'ingest',
    name: 'worker-6bb4f9c2d-zt8rw',
    app: 'worker',
    node: 'ip-10-0-2-31',
    containers: [{ name: 'worker', image: 'registry.example.com/ingest/worker:2.2.0' }],
    phase: 'Running',
    restarts: 14,
    waiting: {
      reason: 'CrashLoopBackOff',
      message: 'back-off 5m0s restarting failed container=worker pod=worker-6bb4f9c2d-zt8rw',
    },
    lastTerminated: { exitCode: 137, reason: 'OOMKilled', finishedAgoMs: 42_000 },
    ageMs: hours(2),
  }),
  // The Pending pod. Unschedulable, so it has no node, no IP and no metrics -
  // every one of which is a null the UI must render as a dash rather than NaN.
  makePod({
    namespace: 'ingest',
    name: 'worker-6bb4f9c2d-qm91x',
    app: 'worker',
    node: '',
    containers: [{ name: 'worker', image: 'registry.example.com/ingest/worker:2.2.0' }],
    phase: 'Pending',
    ageMs: minutes(9),
    unschedulable: '0/3 nodes are available: 3 Insufficient memory.',
  }),
  makePod({
    namespace: 'platform',
    name: 'grafana-84b6d7c9f-r2wkd',
    app: 'grafana',
    node: 'ip-10-0-3-8',
    containers: [{ name: 'grafana', image: 'docker.io/grafana/grafana:11.4.0' }],
  }),
  makePod({
    namespace: 'platform',
    name: 'minio-0',
    app: 'minio',
    node: 'ip-10-0-3-8',
    containers: [{
        name: 'minio',
        image: 'quay.io/minio/minio:RELEASE.2026-08-14T00-00-00Z',
        ports: [
          { name: 'api', containerPort: 9000, protocol: 'TCP' },
          { name: 'console', containerPort: 9001, protocol: 'TCP' },
        ],
        env: [
          { name: 'MINIO_ROOT_USER', valueFrom: { secretKeyRef: { name: 'minio-root', key: 'MINIO_ROOT_USER' } } },
          { name: 'MINIO_ROOT_PASSWORD', valueFrom: { secretKeyRef: { name: 'minio-root', key: 'MINIO_ROOT_PASSWORD' } } },
          { name: 'MINIO_BROWSER_REDIRECT_URL', value: 'https://minio.platform.internal' },
        ],
      }],
  }),
  makePod({
    namespace: 'kube-system',
    name: 'coredns-6f5c9b8d7-v4hxs',
    app: 'coredns',
    node: 'ip-10-0-1-14',
    containers: [{ name: 'coredns', image: 'registry.k8s.io/coredns/coredns:v1.11.3' }],
  }),
];

export const DEMO_NODES: readonly KubeObject[] = (
  [
    ['ip-10-0-1-14', 'm6i.xlarge', '4', '16Gi', true],
    ['ip-10-0-2-31', 'm6i.xlarge', '4', '16Gi', true],
    ['ip-10-0-3-8', 'm6i.large', '2', '8Gi', true],
  ] as const
).map(([name, instance, cpu, memory, ready]) => ({
  apiVersion: 'v1',
  kind: 'Node',
  metadata: {
    name,
    uid: uid(),
    creationTimestamp: iso(hours(72)),
    labels: {
      'node.kubernetes.io/instance-type': instance,
      'topology.kubernetes.io/region': 'eu-west-1',
      'kubernetes.io/os': 'linux',
    },
  },
  spec: { providerID: `aws:///eu-west-1a/i-0${name.replace(/\D/g, '')}` },
  status: {
    capacity: { cpu, memory, pods: '110' },
    allocatable: { cpu, memory, pods: '110' },
    conditions: [
      { type: 'Ready', status: ready ? 'True' : 'False', lastTransitionTime: iso(hours(72)) },
      { type: 'MemoryPressure', status: 'False', lastTransitionTime: iso(hours(72)) },
      { type: 'DiskPressure', status: 'False', lastTransitionTime: iso(hours(72)) },
    ],
    addresses: [{ type: 'InternalIP', address: `10.0.${name.split('-')[3]}.14` }],
    nodeInfo: {
      architecture: 'amd64',
      operatingSystem: 'linux',
      osImage: 'Amazon Linux 2023',
      kernelVersion: '6.1.115-126.197.amzn2023.x86_64',
      kubeletVersion: 'v1.31.4-eks-2d5f260',
      containerRuntimeVersion: 'containerd://1.7.23',
    },
  },
}));

export const DEMO_NAMESPACES: readonly KubeObject[] = NAMESPACES.map((name) => ({
  apiVersion: 'v1',
  kind: 'Namespace',
  metadata: { name, uid: uid(), creationTimestamp: iso(hours(72)) },
  status: { phase: 'Active' },
}));

/** The pod template a workload would carry, taken from the pods it runs. */
function podTemplateFor(app: string): Record<string, unknown> {
  const pod = DEMO_PODS.find((candidate) => candidate.metadata?.labels?.['app'] === app) as
    | { spec?: { containers?: unknown[] } }
    | undefined;
  return {
    metadata: { labels: { app, 'app.kubernetes.io/name': app } },
    spec: { containers: pod?.spec?.containers ?? [] },
  };
}

/**
 * Which deployments came from a chart, and which from a kubectl apply.
 *
 * Both, because drift reads differently against each: a chart will reassert
 * itself on the next upgrade whether anybody meant it to or not, and an apply
 * only when somebody runs one.
 */
const HELM_MANAGED: Readonly<Record<string, boolean>> = {
  'platform/grafana': true,
  'payments/api': true,
};

/**
 * What was applied, for the one deployment that came from a file.
 *
 * It asks for three replicas and the cluster runs two, which is what a
 * `kubectl scale` during an incident leaves behind: nothing looks wrong until
 * the next apply quietly undoes it.
 */
const APPLIED: Readonly<Record<string, string>> = {
  'checkout/web': JSON.stringify({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'web', namespace: 'checkout', labels: { app: 'web' } },
    spec: { replicas: 3, selector: { matchLabels: { app: 'web' } } },
  }),
};

export const DEMO_DEPLOYMENTS: readonly KubeObject[] = (
  [
    ['payments', 'api', 2, 2],
    ['payments', 'ledger', 1, 1],
    ['checkout', 'web', 1, 1],
    ['ingest', 'worker', 2, 0],
    ['platform', 'grafana', 1, 1],
  ] as const
).map(([namespace, name, replicas, ready]) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: {
    name,
    namespace,
    uid: uid(),
    creationTimestamp: iso(hours(48)),
    // Helm writes this label on everything it installs, and it is how the
    // drift check finds the chart an object came from.
    labels: { app: name, ...(HELM_MANAGED[`${namespace}/${name}`] ? { 'app.kubernetes.io/managed-by': 'Helm' } : {}) },
    annotations: {
      'deployment.kubernetes.io/revision': '3',
      ...(HELM_MANAGED[`${namespace}/${name}`]
        ? { 'meta.helm.sh/release-name': name, 'meta.helm.sh/release-namespace': namespace }
        : {}),
      ...(APPLIED[`${namespace}/${name}`] ? { 'kubectl.kubernetes.io/last-applied-configuration': APPLIED[`${namespace}/${name}`] as string } : {}),
    },
  },
  spec: {
    replicas,
    selector: { matchLabels: { app: name } },
    strategy: { type: 'RollingUpdate' },
    template: podTemplateFor(name),
  },
  status: {
    replicas,
    readyReplicas: ready,
    availableReplicas: ready,
    updatedReplicas: replicas,
    conditions: [
      {
        type: 'Available',
        status: ready === replicas ? 'True' : 'False',
        reason: ready === replicas ? 'MinimumReplicasAvailable' : 'MinimumReplicasUnavailable',
        lastTransitionTime: iso(hours(2)),
      },
    ],
  },
}));

export const DEMO_SERVICES: readonly KubeObject[] = (
  [
    ['payments', 'api', 'ClusterIP', 8080],
    ['payments', 'ledger', 'ClusterIP', 9090],
    ['checkout', 'web', 'LoadBalancer', 80],
    ['platform', 'grafana', 'ClusterIP', 3000],
    ['platform', 'minio', 'ClusterIP', 9000],
  ] as const
).map(([namespace, name, type, port]) => ({
  apiVersion: 'v1',
  kind: 'Service',
  metadata: { name, namespace, uid: uid(), creationTimestamp: iso(hours(48)) },
  spec: {
    type,
    clusterIP: `172.20.${Math.floor(rand() * 250)}.${Math.floor(rand() * 250)}`,
    selector: { app: name },
    ports: [{ name: 'http', port, targetPort: port, protocol: 'TCP' }],
  },
  status: {},
}));

export const DEMO_EVENTS: readonly KubeObject[] = [
  {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: { name: 'worker-oom.1', namespace: 'ingest', uid: uid() },
    type: 'Warning',
    reason: 'BackOff',
    message: 'Back-off restarting failed container worker in pod worker-6bb4f9c2d-zt8rw',
    count: 14,
    firstTimestamp: iso(hours(2)),
    lastTimestamp: iso(42_000),
    involvedObject: { kind: 'Pod', name: 'worker-6bb4f9c2d-zt8rw', namespace: 'ingest' },
    source: { component: 'kubelet', host: 'ip-10-0-2-31' },
  },
  {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: { name: 'worker-unsched.1', namespace: 'ingest', uid: uid() },
    type: 'Warning',
    reason: 'FailedScheduling',
    message: '0/3 nodes are available: 3 Insufficient memory.',
    count: 6,
    firstTimestamp: iso(minutes(9)),
    lastTimestamp: iso(minutes(1)),
    involvedObject: { kind: 'Pod', name: 'worker-6bb4f9c2d-qm91x', namespace: 'ingest' },
    source: { component: 'default-scheduler' },
  },
  {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: { name: 'api-scaled.1', namespace: 'payments', uid: uid() },
    type: 'Normal',
    reason: 'ScalingReplicaSet',
    message: 'Scaled up replica set api-7d9f4b8c6 to 2',
    count: 1,
    firstTimestamp: iso(hours(2)),
    lastTimestamp: iso(hours(2)),
    involvedObject: { kind: 'Deployment', name: 'api', namespace: 'payments' },
    source: { component: 'deployment-controller' },
  },
];

export const DEMO_CONFIGMAPS: readonly KubeObject[] = [
  {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: 'api-config', namespace: 'payments', uid: uid(), creationTimestamp: iso(hours(48)) },
    data: { LOG_LEVEL: 'info', ACQUIRER: 'stripe-eu', LEDGER_BATCH_SIZE: '12' },
  },
];

/** A Helm 3 release Secret, encoded the way Helm encodes it: gzip, base64, then the Secret's base64. */
function helmReleaseSecret(namespace: string, name: string, revision: number, status: string, chart: { name: string; version: string; appVersion: string }, values: Record<string, unknown>, deployedAgoMs: number): KubeObject {
  const release = {
    name,
    namespace,
    version: revision,
    info: {
      status,
      first_deployed: iso(deployedAgoMs + hours(72)),
      last_deployed: iso(deployedAgoMs),
      description: status === 'deployed' ? 'Upgrade complete' : 'Superseded',
      notes: `Get the application URL by running:\n  kubectl -n ${namespace} port-forward svc/${name} 8080:80\n`,
    },
    chart: { metadata: { name: chart.name, version: chart.version, appVersion: chart.appVersion, description: `${chart.name} chart` } },
    config: values,
    manifest: `---\n# Source: ${chart.name}/templates/deployment.yaml\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${name}\n  namespace: ${namespace}\nspec:\n  replicas: ${String(values['replicaCount'] ?? 1)}\n`,
  };
  const encoded = Buffer.from(gzipSync(Buffer.from(JSON.stringify(release))).toString('base64')).toString('base64');
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    type: 'helm.sh/release.v1',
    metadata: {
      name: `sh.helm.release.v1.${name}.v${revision}`,
      namespace,
      uid: uid(),
      creationTimestamp: iso(deployedAgoMs),
      labels: { owner: 'helm', name, version: String(revision), status, modifiedAt: String(Math.floor((Date.now() - deployedAgoMs) / 1000)) },
    },
    data: { release: encoded },
  } as KubeObject;
}

export const DEMO_HELM_SECRETS: readonly KubeObject[] = [
  helmReleaseSecret('platform', 'grafana', 1, 'superseded', { name: 'grafana', version: '8.4.2', appVersion: '11.1.0' }, { replicaCount: 1, adminPassword: 'not-a-real-secret' }, hours(40)),
  helmReleaseSecret('platform', 'grafana', 2, 'superseded', { name: 'grafana', version: '8.5.0', appVersion: '11.2.0' }, { replicaCount: 1, persistence: { enabled: true, size: '10Gi' } }, hours(20)),
  helmReleaseSecret('platform', 'grafana', 3, 'deployed', { name: 'grafana', version: '8.5.1', appVersion: '11.2.2' }, { replicaCount: 1, persistence: { enabled: true, size: '10Gi' }, ingress: { enabled: true, hosts: ['grafana.platform.internal'] } }, hours(4)),
  helmReleaseSecret('platform', 'minio', 1, 'deployed', { name: 'minio', version: '5.2.0', appVersion: 'RELEASE.2026-08-14T00-00-00Z' }, { mode: 'standalone', persistence: { size: '50Gi' } }, hours(30)),
  helmReleaseSecret('payments', 'api', 5, 'deployed', { name: 'mjolnir-service', version: '1.9.0', appVersion: '1.5.0' }, { image: { tag: '1.5.0' }, replicaCount: 2 }, hours(6)),
];

/**
 * One endpoint per Service, naming a pod that really exists in the demo.
 *
 * Without these a Service is a name with nothing behind it, and anything that
 * asks "what would a connection to this actually reach" gets no answer. Port
 * forwarding is the obvious one: "forward Redis" is a sentence about a
 * service, and the pod behind it is what the forward attaches to.
 */
export const DEMO_ENDPOINTS: readonly KubeObject[] = (DEMO_SERVICES as ReadonlyArray<KubeObject & { metadata?: { name?: string; namespace?: string }; spec?: { ports?: Array<{ port?: number; targetPort?: number; name?: string }> } }>).flatMap(
  (service) => {
    const name = service.metadata?.name ?? '';
    const namespace = service.metadata?.namespace ?? '';
    const backing = (DEMO_PODS as ReadonlyArray<KubeObject & { metadata?: { name?: string; namespace?: string; labels?: Record<string, string> } }>).find(
      (pod) => pod.metadata?.namespace === namespace && pod.metadata?.labels?.['app'] === name,
    );
    if (!backing) return [];
    return [
      {
        apiVersion: 'v1',
        kind: 'Endpoints',
        metadata: { name, namespace, uid: uid(), creationTimestamp: iso(hours(48)) },
        subsets: [
          {
            addresses: [{ ip: '10.42.0.11', targetRef: { kind: 'Pod', name: backing.metadata?.name, namespace } }],
            ports: (service.spec?.ports ?? []).map((port) => ({ name: port.name, port: port.targetPort ?? port.port, protocol: 'TCP' })),
          },
        ],
      } as KubeObject,
    ];
  },
);

export const DEMO_SECRETS: readonly KubeObject[] = [
  {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: 'minio-root', namespace: 'platform', uid: uid(), creationTimestamp: iso(hours(48)) },
    type: 'Opaque',
    // Base64 of obviously fake values. Never anything that resembles a credential.
    data: { MINIO_ROOT_USER: 'ZGVtby11c2Vy', MINIO_ROOT_PASSWORD: 'bm90LWEtcmVhbC1zZWNyZXQ=' },
  },
];

/**
 * ReplicaSets: the current one per workload, owned by its Deployment, and an
 * older revision for two of them so "undo rollout" has somewhere to go.
 */
export const DEMO_REPLICASETS: readonly KubeObject[] = (() => {
  type Owned = KubeObject & { metadata?: { ownerReferences?: Array<{ name?: string }>; labels?: Record<string, string> } };
  const seen = new Map<string, { namespace: string; app: string; hash: string }>();
  for (const pod of DEMO_PODS as readonly Owned[]) {
    const rs = pod.metadata?.ownerReferences?.[0]?.name;
    const app = pod.metadata?.labels?.['app'];
    const namespace = pod.metadata?.namespace;
    if (rs && app && namespace && !seen.has(rs)) seen.set(rs, { namespace, app, hash: rs.slice(app.length + 1) });
  }
  const make = (name: string, meta: { namespace: string; app: string; hash: string }, revision: string, replicas: number, image?: string) => {
    const template = podTemplateFor(meta.app) as { spec: { containers: Array<Record<string, unknown>> } };
    return {
      apiVersion: 'apps/v1',
      kind: 'ReplicaSet',
      metadata: {
        name,
        namespace: meta.namespace,
        uid: uid(),
        creationTimestamp: iso(hours(revision === '3' ? 6 : 30)),
        labels: { app: meta.app, 'pod-template-hash': meta.hash },
        annotations: { 'deployment.kubernetes.io/revision': revision },
        ownerReferences: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: meta.app, controller: true }],
      },
      spec: {
        replicas,
        selector: { matchLabels: { app: meta.app, 'pod-template-hash': meta.hash } },
        template: image
          ? { ...template, spec: { ...template.spec, containers: template.spec.containers.map((c, i) => (i === 0 ? { ...c, image } : c)) } }
          : template,
      },
      status: { replicas, readyReplicas: replicas, availableReplicas: replicas },
    } as KubeObject;
  };
  const out: KubeObject[] = [];
  for (const [name, meta] of seen) {
    out.push(make(name, meta, '3', DEMO_PODS.filter((pod) => (pod as Owned).metadata?.ownerReferences?.[0]?.name === name).length));
    if (meta.app === 'api') out.push(make('api-5c7d8e9f0', { ...meta, hash: '5c7d8e9f0' }, '2', 0, 'ghcr.io/mjolnir/api:1.4.1'));
    if (meta.app === 'worker') out.push(make('worker-58f0a1b2c', { ...meta, hash: '58f0a1b2c' }, '2', 0, 'ghcr.io/mjolnir/worker:2.0.9'));
  }
  return out;
})();

/** Every kind the demo cluster answers for, keyed by lowercase plural. */
export const DEMO_RESOURCES: Readonly<Record<string, readonly KubeObject[]>> = {
  pods: DEMO_PODS,
  replicasets: DEMO_REPLICASETS,
  nodes: DEMO_NODES,
  namespaces: DEMO_NAMESPACES,
  deployments: DEMO_DEPLOYMENTS,
  services: DEMO_SERVICES,
  events: DEMO_EVENTS,
  configmaps: DEMO_CONFIGMAPS,
  secrets: [...DEMO_SECRETS, ...DEMO_HELM_SECRETS, ...DEMO_TLS_SECRETS],
  endpoints: DEMO_ENDPOINTS,
  ingresses: DEMO_INGRESSES,
  certificates: DEMO_CERT_MANAGER,
};
