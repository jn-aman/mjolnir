import {
  Archive,
  ArrowLeftRight,
  Bell,
  Cloud,
  MonitorSmartphone,
  Coins,
  Database,
  GitBranch,
  GitCompare,
  History,
  Package,
  Radio,
  Route,
  Ship,
  ShieldAlert,
  Siren,
  Terminal,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';

/**
 * Everything the shell will hold, declared before it is built.
 *
 * The navigation, the command palette and the rail all read this list, so a
 * feature arrives by filling in a panel, not by finding a place for it. Until
 * a panel exists, the entry opens an honest page: what it will do, and the
 * command that does the same thing today. A slot that says "planned" is a
 * promise the layout keeps; a slot that does not exist is a redesign later.
 *
 * `tools` live in the cluster's own navigation because they act on the cluster
 * you are looking at. `workspace` entries are not about one cluster (cloud
 * identities, local containers, buckets, databases, brokers, certificates,
 * image provenance) and live in the Toolbox, behind one tile on the rail.
 */

export interface ToolCommand {
  readonly label: string;
  readonly command: string;
}

export interface ToolDefinition {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tint: string;
  readonly area: 'tools' | 'workspace';
  /** One sentence: what it is for. */
  readonly summary: string;
  /** What it will do, concretely, once built. */
  readonly detail: readonly string[];
  /** What does the job today, so the page is useful before the feature is. */
  readonly today: readonly ToolCommand[];
  /** A module's sidebar entries. Only for `workspace` entries. */
  readonly sections?: readonly string[];
}

/** The Kubernetes module, alongside the others; it is not the app. */
export const KUBERNETES_MODULE = { id: 'kubernetes', label: 'Kubernetes', tint: 'var(--series-1)' } as const;

export function isModule(id: string): boolean {
  return id === KUBERNETES_MODULE.id || TOOLS.some((tool) => tool.area === 'workspace' && tool.id === id);
}

export function modules(): ToolDefinition[] {
  return TOOLS.filter((tool) => tool.area === 'workspace');
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'helm',
    label: 'Helm',
    icon: Package,
    tint: 'var(--series-1)',
    area: 'tools',
    summary: 'Every release in the cluster with its history, values, manifest and notes, read from the release Secrets. Upgrades and rollbacks arrive with the Helm engine.',
    detail: [
      'Releases per namespace with chart, version, status and when they last deployed',
      'Values side by side with the chart defaults, edited in place',
      'A diff of what an upgrade would change, then one click to apply or roll back to any revision',
      'Repositories added once and kept per profile',
    ],
    today: [{ label: 'List releases', command: 'helm list -A' }],
  },
  {
    id: 'argocd',
    label: 'Argo CD',
    icon: GitBranch,
    tint: 'var(--series-2)',
    area: 'tools',
    summary: 'Applications with sync and health state, and the live diff against Git.',
    detail: [
      'Every Application with sync status, health and the revision it points at',
      'The diff between the cluster and the desired state, per resource',
      'Sync, refresh and rollback, run through the Argo CD API so its RBAC still applies',
    ],
    today: [{ label: 'List applications', command: 'argocd app list' }],
  },
  {
    id: 'portforward',
    label: 'Port forwards',
    icon: ArrowLeftRight,
    tint: 'var(--series-3)',
    area: 'tools',
    summary: 'Forward a pod port to localhost and keep it alive while the app runs. Services and reconnect-survival next.',
    detail: [
      'Start a forward from any pod or service row, with the local port chosen for you',
      'Every active forward in one list, with traffic, and restarted for you when the pod moves',
      'Open the forwarded port in your browser in one click',
    ],
    today: [{ label: 'Forward a service', command: 'kubectl -n <namespace> port-forward svc/<service> 8080:80' }],
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: Terminal,
    tint: 'var(--series-4)',
    area: 'tools',
    summary: 'Container shells work today from any pod (Shell in its menu). Node shells and a local terminal pointed at the cluster are next.',
    detail: [
      'Container shells and node shells in the dock, so they stay open while you browse',
      'A local terminal with KUBECONFIG and the namespace preset',
      'Tabs that survive a reconnect and remember their history per cluster',
    ],
    today: [{ label: 'Shell into a pod', command: 'kubectl -n <namespace> exec -it <pod> -- sh' }],
  },
  {
    id: 'trivy',
    label: 'Vulnerabilities',
    icon: ShieldAlert,
    tint: 'var(--status-error)',
    area: 'tools',
    summary: 'Scan any image with Trivy: from a container card, a Docker image row, or here for the whole cluster.',
    detail: [
      'Findings by severity with the fixed version where one exists',
      'Grouped by the workload that runs the image, not by the image alone',
      'SBOM export, and a scan on the image of any pod from its menu',
    ],
    today: [{ label: 'Scan an image', command: 'trivy image <image>' }],
  },
  {
    id: 'whatbroke',
    label: 'What broke?',
    icon: Siren,
    tint: 'var(--status-warn)',
    area: 'tools',
    summary: 'A timeline of every change and warning in the cluster, correlated so the first cause is on top.',
    detail: [
      'Rollouts, restarts, evictions, failed probes and scaling on one timeline',
      'Warnings linked to the change that preceded them',
      'Jump from any entry to the object, its logs or its YAML at that moment',
    ],
    today: [{ label: 'Recent events', command: 'kubectl get events -A --sort-by=.lastTimestamp' }],
  },
  {
    id: 'cloud',
    label: 'Cloud access',
    icon: Cloud,
    tint: 'var(--series-1)',
    area: 'workspace',
    summary: 'Every AWS, Azure and Google identity you use, with sessions that obtain and rotate credentials for you.',
    detail: [
      'AWS: IAM users (with MFA), IAM roles chained from any session, federated roles via SAML, IAM Identity Center (SSO) sessions with device-code login',
      'Azure: tenants and subscriptions via device-code or browser login; GCP: user and service-account sessions',
      'Named profiles written to the credential file or served through credential_process, so every CLI and SDK just works',
      'Sessions start, refresh and expire visibly; keys rotate on a schedule you set; nothing long-lived sits on disk',
      'Regions, default namespaces and role chains remembered per session; integrations with EKS, AKS and GKE clusters light the rail',
      'Secrets in the OS keychain (Keychain, Credential Manager, libsecret); an audit log of every session started',
      'Team sync of session definitions, never of credentials, through a shared file or a Git repo',
    ],
    today: [{ label: 'Who am I', command: 'aws sts get-caller-identity' }],
    sections: ['Sessions', 'AWS', 'Azure', 'Google Cloud', 'Profiles', 'Audit log'],
  },
  {
    id: 'docker',
    label: 'Containers',
    icon: Ship,
    tint: 'var(--series-3)',
    area: 'workspace',
    summary: 'Everything the Docker CLI and Desktop do, containers, images, volumes, networks, Compose, builds, registries, from the same window as your clusters.',
    detail: [
      'Containers: run, start, stop, restart, pause, kill, rename, logs, exec, attach, stats, inspect, copy files in and out, commit, export',
      'Images: pull, push, tag, build (with BuildKit and build args), history, inspect, save/load, prune, and which containers use each layer',
      'Volumes and networks: create, inspect, attach, prune; bind mounts and named volumes shown on every container',
      'Compose: projects as one unit, up, down, restart, scale, per-service logs, config view, env files',
      'Registries and contexts: log in, browse tags, switch between local, remote and rootless engines; Docker Hub, GHCR, ECR, ACR, GAR',
      'System: disk usage, prune, events stream, resource limits of the engine; Kubernetes-in-Docker clusters (kind, k3d, OrbStack) appear in the rail',
    ],
    today: [{ label: 'Running containers', command: 'docker ps' }],
    sections: ['Containers', 'Images', 'Volumes', 'Networks', 'Compose', 'Registries', 'System'],
  },
  {
    id: 'storage',
    label: 'Object storage',
    icon: Archive,
    tint: 'var(--log-pod-b)',
    area: 'workspace',
    summary: 'Browse buckets in MinIO, RustFS, SeaweedFS, Garage, Ceph RGW and any S3-compatible store, in the cluster or outside it.',
    detail: [
      'Stores detected from the pods that run them: the pod overview shows the endpoint and where the keys are, a literal env value, or a Secret decoded on request',
      'Connect with a port-forward the app opens for you, or to an external endpoint with keys you paste or a profile from Cloud access',
      'Buckets and prefixes as folders with size and last modified; preview text, JSON, images, Parquet and logs in place',
      'Upload, download, rename, delete, copy between buckets; presigned links with the expiry you choose',
      'Bucket policies, versioning, lifecycle and replication shown and editable where the store supports them',
    ],
    today: [{ label: 'List a bucket', command: 'mc ls <alias>/<bucket>' }],
    sections: ['Connections', 'Buckets', 'Transfers', 'Presigned links'],
  },
  {
    id: 'machines',
    label: 'Machines',
    icon: MonitorSmartphone,
    tint: 'var(--series-3)',
    area: 'workspace',
    summary: 'Every host you care about, with a tiny agent that reports CPU, memory, disk, network, temperatures and the containers it runs. Beszel-style, for Kubernetes nodes and Docker hosts alike.',
    detail: [
      'One agent binary, paired with a token, connecting outbound to Mjolnir over your tailnet (Tailscale) or any reachable address; nothing listens on the host',
      'CPU, load, memory, swap, disk usage and I/O, network throughput, temperatures, GPU where present, at one-second resolution with an hour kept and a day summarised',
      'Docker on the host: per-container CPU, memory and network, restarts, and the same start, stop, logs and shell as the Containers module',
      'Kubernetes nodes get the agent too, so node metrics do not depend on metrics-server and cover disk, network and temperatures it never reports',
      'Alerts on any of it, through the Alerts module',
    ],
    today: [{ label: 'Load and memory on a host', command: 'ssh <host> "uptime; free -h; df -h /"' }],
    sections: ['Hosts', 'Agents', 'Metrics', 'Containers on hosts', 'Pairing'],
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: Bell,
    tint: 'var(--status-warn)',
    area: 'workspace',
    summary: 'Rules across Kubernetes, containers, machines and certificates, delivered where you are, quiet when you sleep.',
    detail: [
      'Rules with a condition and a duration: CPU above 90% for 5 minutes, a pod in CrashLoopBackOff, a node NotReady, disk above 85%, a certificate under 14 days, a consumer group lagging, a forward that died',
      'Channels: email (SMTP or a provider API), webhooks (Slack, Discord, Teams, PagerDuty, generic JSON), push (ntfy, Pushover, Gotify, macOS notifications)',
      'Quiet hours per channel and per rule, with a severity that can break through; escalation after N minutes unacknowledged',
      'Every alert that fired, when it resolved, and who acknowledged it, with a link to the object as it was then (Time travel)',
      'Rules are YAML you can commit; the app renders them as a form',
    ],
    today: [{ label: 'Pods not running, right now', command: 'kubectl get pods -A --field-selector=status.phase!=Running' }],
    sections: ['Rules', 'Channels', 'Quiet hours', 'History', 'Silences'],
  },
  {
    id: 'database',
    label: 'Database browser',
    icon: Database,
    tint: 'var(--series-1)',
    area: 'workspace',
    summary: 'Postgres, MySQL, Redis and Mongo, in the cluster or anywhere else: pods, hosts, and cloud databases with IAM auth.',
    detail: [
      'Connections from three places: a pod (the app opens the port-forward), a host and port you type, or AWS RDS and Aurora with an IAM auth token minted from a Cloud access session',
      'Pods detected from the image and port; the pod overview shows the connection string and where the password lives',
      'Tables, rows and a query editor over a port-forward the app opens; Redis keys by pattern; Mongo collections',
      'Read-only by default; writes need a switch you flip per session',
    ],
    today: [{ label: 'Connect through a forward', command: 'kubectl -n <namespace> port-forward svc/<db> 5432:5432' }],
    sections: ['Connections', 'Query', 'Tables', 'Redis keys', 'Mongo collections', 'IAM access'],
  },
  {
    id: 'kafka',
    label: 'Kafka consumer lag',
    icon: Radio,
    tint: 'var(--series-2)',
    area: 'workspace',
    summary: 'Topics, partitions, consumer groups and their lag, from brokers in the cluster, on a host, or in AWS MSK with IAM auth.',
    detail: [
      'Connect to brokers in a pod (port-forward), at a host and port, or to MSK with SASL/IAM using a Cloud access session',
      'Consumer groups with lag per partition and a trend, so a stuck consumer is visible before an alert fires',
      'Topics with partition count, retention and message rate; peek at recent messages',
      'Jump from a lagging group to the pods that make it up',
    ],
    today: [{ label: 'Group lag', command: 'kafka-consumer-groups.sh --bootstrap-server <broker> --describe --group <group>' }],
    sections: ['Connections', 'Topics', 'Consumer groups', 'Messages', 'IAM access'],
  },
  {
    id: 'drift',
    label: 'Diff & drift',
    icon: GitCompare,
    tint: 'var(--series-3)',
    area: 'tools',
    summary: 'What differs between the cluster and Git, between two clusters, or between an object now and an hour ago.',
    detail: [
      'Live object against its source manifest, Helm values or Argo desired state, a real diff, not two YAMLs',
      'The same kind across two clusters: what staging has that production does not',
      'Drift alerts on objects that changed outside the pipeline, with who and when from the audit log',
    ],
    today: [{ label: 'Diff a manifest', command: 'kubectl diff -f manifest.yaml' }],
  },
  {
    id: 'timetravel',
    label: 'Time travel',
    icon: History,
    tint: 'var(--series-4)',
    area: 'tools',
    summary: 'The watch streams already carry every change; keep a window of them and scrub backwards.',
    detail: [
      'A slider over the last hours: the pod list, the overview and any object as they were at that moment',
      'Every change to an object as a diff on a timeline, image, replicas, labels, conditions',
      'Pairs with What broke?: pick the moment a warning fired and see the cluster then',
    ],
    today: [{ label: 'Watch changes as they happen', command: 'kubectl get pods -A --watch --output-watch-events' }],
  },
  {
    id: 'cost',
    label: 'Cost per workload',
    icon: Coins,
    tint: 'var(--status-warn)',
    area: 'tools',
    summary: 'What each namespace, workload and pod costs, from node prices and what it actually requests and uses.',
    detail: [
      'Node prices from the cloud provider (EKS, AKS, GKE) or a price you set for on-prem',
      'Cost by namespace, workload and label; idle cost from requests that are never used',
      'Rightsizing suggestions with the exact request change, applied from the drawer',
    ],
    today: [{ label: 'Requests by namespace', command: 'kubectl describe nodes | grep -A5 "Allocated resources"' }],
  },
  {
    id: 'netpath',
    label: 'Network path',
    icon: Route,
    tint: 'var(--series-1)',
    area: 'tools',
    summary: 'Can this pod reach that service? Which policy, port or DNS name is in the way?',
    detail: [
      'Pick a source pod and a destination (pod, service, ingress, external host) and get the answer with the reason',
      'Evaluates NetworkPolicies, service selectors, ports and DNS; runs a real probe from an ephemeral container to confirm',
      'The blocking policy is one click away, and editable',
    ],
    today: [{ label: 'Probe from a pod', command: 'kubectl -n <namespace> exec <pod> -- nc -zv <service> <port>' }],
  },
  {
    id: 'traffic',
    label: 'Traffic graph',
    icon: Waypoints,
    tint: 'var(--series-2)',
    area: 'tools',
    summary: 'Who talks to whom, as a graph: services, their callers, and the rates and errors between them.',
    detail: [
      'From the service mesh (Istio, Linkerd), Cilium Hubble or eBPF where none is installed',
      'Request rate, error rate and latency on every edge; a red edge is the incident',
      'Click an edge for the pods behind it, their logs and the network path check',
    ],
    today: [{ label: 'Observe flows with Hubble', command: 'hubble observe --namespace <namespace>' }],
  },
];

export function toolById(id: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.id === id);
}
