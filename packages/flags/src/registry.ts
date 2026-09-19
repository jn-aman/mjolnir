/**
 * Every flag Mjolnir knows about, declared in one place.
 *
 * A flag that only exists on a remote server is a flag nobody can find, and a
 * desktop app that needs a network round trip before it can decide whether a
 * menu item exists is a desktop app that hangs on aeroplanes. So the catalogue
 * is local and typed: the default here is the answer when nothing else has an
 * opinion, and a remote provider can only change a value that is already named.
 */

export type FlagStage = 'internal' | 'experimental' | 'beta' | 'stable';

export interface FlagDefinition {
  readonly id: string;
  readonly label: string;
  /** One sentence, written for the person reading the settings page. */
  readonly description: string;
  /** What the app does when nothing overrides it. */
  readonly fallback: boolean;
  readonly stage: FlagStage;
  /** Which module it belongs to, for grouping. */
  readonly module: string;
  /** Turning it on has consequences worth naming before the switch moves. */
  readonly warning?: string;
}

/**
 * Module flags come first because they decide what the app looks like.
 *
 * A rail full of tiles marked "planned" is a promise made to someone who only
 * wanted to look at their cluster. Shipping means the rail holds what works;
 * everything else is behind a flag that is off, so the same build can show a
 * whole module to the people testing it and nothing at all to everyone else.
 */
export const FLAGS: readonly FlagDefinition[] = [
  {
    id: 'module.cloud',
    label: 'Cloud access module',
    description: 'AWS, Azure and Google identities with sessions that obtain and rotate credentials.',
    fallback: false,
    stage: 'internal',
    module: 'mjolnir',
  },
  {
    id: 'module.machines',
    label: 'Machines module',
    description: 'Paired hosts with CPU, memory, disk and container metrics from a small agent.',
    fallback: false,
    stage: 'internal',
    module: 'mjolnir',
  },
  {
    id: 'module.alerts',
    label: 'Alerts module',
    description: 'Rules, channels, quiet hours and silences.',
    fallback: false,
    stage: 'internal',
    module: 'mjolnir',
  },
  {
    id: 'module.database',
    label: 'Database browser module',
    description: 'Query databases in the cluster and outside it, through a forward or an IAM role.',
    fallback: false,
    stage: 'internal',
    module: 'mjolnir',
  },
  {
    id: 'module.kafka',
    label: 'Kafka module',
    description: 'Topics, consumer groups, lag and messages.',
    fallback: false,
    stage: 'internal',
    module: 'mjolnir',
  },
  {
    id: 'assistant.tool-calls',
    label: 'Assistant runs tools',
    description: 'The assistant may call read tools itself instead of only describing what it would run.',
    fallback: true,
    stage: 'stable',
    module: 'assistant',
  },
  {
    id: 'assistant.writes',
    label: 'Assistant may write',
    description: 'Lets the assistant apply, scale, restart and delete, subject to the per-provider write switch.',
    fallback: false,
    stage: 'beta',
    module: 'assistant',
    warning: 'The assistant can change your cluster when this is on.',
  },
  {
    id: 'mcp.http',
    label: 'MCP over HTTP',
    description: 'Serve the Model Context Protocol at /mcp so other agents on this machine can use Mjolnir.',
    fallback: false,
    stage: 'beta',
    module: 'mjolnir',
    warning: 'This opens a port on this machine that an agent can drive Mjolnir through. It is bound to 127.0.0.1 and needs the token, and it is still a way into your clusters.',
  },
  {
    id: 'kubernetes.time-travel',
    label: 'Time travel',
    description: 'Keep a rolling history of resource versions so you can scrub back to what the cluster looked like.',
    fallback: false,
    stage: 'experimental',
    module: 'kubernetes',
  },
  {
    id: 'kubernetes.traffic-graph',
    label: 'Traffic graph',
    description: 'Draw the live service-to-service graph from endpoints and network policy.',
    fallback: false,
    stage: 'experimental',
    module: 'kubernetes',
  },
  {
    id: 'kubernetes.node-shell',
    label: 'Node shell',
    description: 'Open a root shell on a node through a privileged ephemeral pod.',
    fallback: false,
    stage: 'experimental',
    module: 'kubernetes',
    warning: 'This schedules a privileged pod on the node you pick.',
  },
  {
    id: 'docker.build',
    label: 'Image builds',
    description: 'Build images from a Dockerfile through the local engine, with BuildKit output in the dock.',
    fallback: false,
    stage: 'experimental',
    module: 'docker',
  },
  {
    id: 'storage.transfers',
    label: 'Background transfers',
    description: 'Queue uploads and downloads so large objects keep moving while you work elsewhere.',
    fallback: true,
    stage: 'beta',
    module: 'storage',
  },
  {
    id: 'machines.agent',
    label: 'Machine agent',
    description: 'Pair a small agent on a host and read its CPU, memory, disk and container metrics.',
    fallback: false,
    stage: 'internal',
    module: 'machines',
  },
  {
    id: 'alerts.rules',
    label: 'Alert rules',
    description: 'Evaluate alert rules locally and deliver to email, webhooks and push, with quiet hours.',
    fallback: false,
    stage: 'internal',
    module: 'alerts',
  },
  {
    id: 'ui.onboarding',
    label: 'Welcome tour',
    description: 'Show the first-run welcome, and offer it again from settings.',
    fallback: true,
    stage: 'stable',
    module: 'mjolnir',
  },

  /*
   * Surfaces, not modules.
   *
   * Everything below is shipped and on. They are flagged so that a build in
   * front of a customer can be narrowed without cutting one, and so that when
   * a surface breaks in the field it can be turned off from the server instead
   * of waiting on a release. A flag that defaults to off would be hiding
   * finished work, which is a different thing and not what these are for.
   */
  {
    id: 'ui.command-palette',
    label: 'Command palette',
    description: 'Cmd K: jump to any kind, cluster, namespace or object, and run verbs on what you find.',
    fallback: true,
    stage: 'stable',
    module: 'mjolnir',
  },
  {
    id: 'ui.deep-search',
    label: 'Search inside objects',
    description: 'The filter box reads every field of every object, not only the columns on screen, so an image tag or an env value finds its row.',
    fallback: true,
    stage: 'stable',
    module: 'mjolnir',
  },
  {
    id: 'ui.filters',
    label: 'Status and namespace filters',
    description: 'Narrow a list by health and by namespace from the toolbar.',
    fallback: true,
    stage: 'stable',
    module: 'mjolnir',
  },
  {
    id: 'ui.columns',
    label: 'Column layout',
    description: 'Resize, reorder and hide columns, remembered per kind.',
    fallback: true,
    stage: 'stable',
    module: 'mjolnir',
  },
  {
    id: 'ui.bulk-actions',
    label: 'Act on several rows',
    description: 'Tick rows and run one verb across all of them.',
    fallback: true,
    stage: 'stable',
    module: 'mjolnir',
    warning: 'A bulk delete asks once for the whole selection, not once per object.',
  },
  {
    id: 'ui.dock',
    label: 'Bottom dock',
    description: 'Keep logs, shells, the assistant and pinned objects open along the bottom while you navigate elsewhere.',
    fallback: true,
    stage: 'stable',
    module: 'mjolnir',
  },
  {
    id: 'kubernetes.logs',
    label: 'Pod logs',
    description: 'Follow, search and download container logs, including previous containers after a crash.',
    fallback: true,
    stage: 'stable',
    module: 'kubernetes',
  },
  {
    id: 'kubernetes.exec',
    label: 'Shell into a container',
    description: 'Open an interactive terminal in a running container.',
    fallback: true,
    stage: 'stable',
    module: 'kubernetes',
    warning: 'A shell in a container is a shell in your cluster, with whatever that container can reach.',
  },
  {
    id: 'kubernetes.port-forward',
    label: 'Port forwarding',
    description: 'Forward a pod or service port to this machine and keep it open in the background.',
    fallback: true,
    stage: 'stable',
    module: 'kubernetes',
  },
  {
    id: 'kubernetes.edit',
    label: 'Edit and apply YAML',
    description: 'Change an object in the editor and apply it, plus scale, restart, cordon, drain and delete.',
    fallback: true,
    stage: 'stable',
    module: 'kubernetes',
    warning: 'These write to the live cluster. Turning this off leaves every read intact.',
  },
  {
    id: 'kubernetes.helm',
    label: 'Helm releases',
    description: 'List releases, read their values and manifests, and see their history.',
    fallback: true,
    stage: 'stable',
    module: 'kubernetes',
  },
  {
    id: 'kubernetes.metrics',
    label: 'CPU and memory',
    description: 'Read live usage from metrics-server and draw it on nodes, pods and workloads.',
    fallback: true,
    stage: 'stable',
    module: 'kubernetes',
  },
  {
    id: 'scan.images',
    label: 'Image scanning',
    description: 'Scan a container image with Trivy and read the findings, with search, filters and CSV export.',
    fallback: true,
    stage: 'beta',
    module: 'kubernetes',
    warning: 'Trivy downloads its vulnerability database on first run, which needs the network.',
  },
  {
    id: 'storage.presigned',
    label: 'Presigned links',
    description: 'Mint a time-limited URL for an object that anyone with the link can use.',
    fallback: true,
    stage: 'stable',
    module: 'storage',
    warning: 'A presigned link works without any credentials until it expires.',
  },
  {
    id: 'storage.write',
    label: 'Upload and delete objects',
    description: 'Put objects into a bucket, create buckets and remove what is there.',
    fallback: true,
    stage: 'stable',
    module: 'storage',
  },
  {
    id: 'storage.archives',
    label: 'Open archives in place',
    description: 'Browse a zip, jar or wheel in the object viewer and open what is inside it without downloading.',
    fallback: true,
    stage: 'beta',
    module: 'storage',
  },
  {
    id: 'account.sign-in',
    label: 'Sign in to an account',
    description: 'Sign in with email, GitHub, Google or your organisation\u2019s Okta, so a subscription follows you between machines and a seat can be taken back.',
    fallback: false,
    stage: 'experimental',
    module: 'mjolnir',
    warning: 'The account service is not live yet, so signing in will not succeed.',
  },
  {
    id: 'account.sso',
    label: 'Enterprise sign-in',
    description: 'Okta, with sign-in enforced for a domain so everyone in an organisation arrives as the same identity.',
    fallback: false,
    stage: 'internal',
    module: 'mjolnir',
  },
  {
    id: 'docker.write',
    label: 'Container actions',
    description: 'Start, stop, restart and remove containers, images, volumes and networks through the local engine.',
    fallback: true,
    stage: 'stable',
    module: 'docker',
  },
];

const BY_ID = new Map(FLAGS.map((flag) => [flag.id, flag]));

export function flagById(id: string): FlagDefinition | undefined {
  return BY_ID.get(id);
}

/** The stages, worst-supported first, so a settings page can order them. */
export const STAGE_ORDER: readonly FlagStage[] = ['stable', 'beta', 'experimental', 'internal'];
