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
];

const BY_ID = new Map(FLAGS.map((flag) => [flag.id, flag]));

export function flagById(id: string): FlagDefinition | undefined {
  return BY_ID.get(id);
}

/** The stages, worst-supported first, so a settings page can order them. */
export const STAGE_ORDER: readonly FlagStage[] = ['stable', 'beta', 'experimental', 'internal'];
