import { normalise } from './hash.ts';

/**
 * Just enough Unleash to be an Unleash client.
 *
 * The official SDK is a fine thing and the wrong shape here: it assumes a
 * server process, keeps its own metrics loop, and pulls a dependency tree into
 * a signed desktop bundle. Mjolnir needs one thing from Unleash, the toggle
 * list for this environment, so it fetches the client API and evaluates the
 * strategies that make sense for a desktop app. Anything it cannot evaluate it
 * reports as unknown rather than guessing, and the local default wins.
 */

export interface UnleashConstraint {
  readonly contextName: string;
  readonly operator: string;
  readonly values?: readonly string[];
  readonly value?: string;
  readonly inverted?: boolean;
  readonly caseInsensitive?: boolean;
}

export interface UnleashStrategy {
  readonly name: string;
  readonly parameters?: Readonly<Record<string, string>>;
  readonly constraints?: readonly UnleashConstraint[];
}

export interface UnleashFeature {
  readonly name: string;
  readonly enabled: boolean;
  readonly strategies?: readonly UnleashStrategy[];
}

export interface UnleashContext {
  /** The installation, so a rollout picks the same machines every time. */
  readonly userId: string;
  readonly sessionId: string;
  readonly environment: string;
  readonly appName: string;
  readonly properties: Readonly<Record<string, string>>;
}

export interface UnleashConfig {
  /** The Unleash server, for example https://unleash.example.com */
  readonly url: string;
  /** A client token. Front-end tokens work against an Unleash Edge or proxy URL. */
  readonly token: string;
  readonly appName: string;
  readonly environment: string;
  readonly instanceId: string;
}

const lower = (value: string): string => value.toLowerCase();

function contextValue(context: UnleashContext, name: string): string | undefined {
  if (name === 'userId') return context.userId;
  if (name === 'sessionId') return context.sessionId;
  if (name === 'environment') return context.environment;
  if (name === 'appName') return context.appName;
  return context.properties[name];
}

/** A dotted version compared part by part; anything unparsable sorts as 0. */
function compareSemver(a: string, b: string): number {
  const parse = (value: string): number[] => value.replace(/^v/, '').split(/[.+-]/).map((part) => Number(part) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function constraintHolds(constraint: UnleashConstraint, context: UnleashContext): boolean {
  const actual = contextValue(context, constraint.contextName);
  const values = constraint.values ?? (constraint.value === undefined ? [] : [constraint.value]);
  const fold = (value: string): string => (constraint.caseInsensitive ? lower(value) : value);
  const single = constraint.value ?? values[0] ?? '';

  let result: boolean;
  if (actual === undefined) {
    result = false;
  } else {
    switch (constraint.operator) {
      case 'IN':
        result = values.map(fold).includes(fold(actual));
        break;
      case 'NOT_IN':
        result = !values.map(fold).includes(fold(actual));
        break;
      case 'STR_CONTAINS':
        result = values.some((value) => fold(actual).includes(fold(value)));
        break;
      case 'STR_STARTS_WITH':
        result = values.some((value) => fold(actual).startsWith(fold(value)));
        break;
      case 'STR_ENDS_WITH':
        result = values.some((value) => fold(actual).endsWith(fold(value)));
        break;
      case 'NUM_EQ':
        result = Number(actual) === Number(single);
        break;
      case 'NUM_GT':
        result = Number(actual) > Number(single);
        break;
      case 'NUM_GTE':
        result = Number(actual) >= Number(single);
        break;
      case 'NUM_LT':
        result = Number(actual) < Number(single);
        break;
      case 'NUM_LTE':
        result = Number(actual) <= Number(single);
        break;
      case 'SEMVER_EQ':
        result = compareSemver(actual, single) === 0;
        break;
      case 'SEMVER_GT':
        result = compareSemver(actual, single) > 0;
        break;
      case 'SEMVER_LT':
        result = compareSemver(actual, single) < 0;
        break;
      case 'DATE_AFTER':
        result = new Date(actual).getTime() > new Date(single).getTime();
        break;
      case 'DATE_BEFORE':
        result = new Date(actual).getTime() < new Date(single).getTime();
        break;
      default:
        result = false;
    }
  }
  return constraint.inverted ? !result : result;
}

function stickyId(stickiness: string, context: UnleashContext): string {
  if (stickiness === 'userId') return context.userId;
  if (stickiness === 'sessionId') return context.sessionId;
  if (stickiness === 'random') return String(Math.floor(Math.random() * 100000));
  return context.userId || context.sessionId;
}

function strategyHolds(strategy: UnleashStrategy, context: UnleashContext, featureName: string): boolean {
  for (const constraint of strategy.constraints ?? []) {
    if (!constraintHolds(constraint, context)) return false;
  }
  const parameters = strategy.parameters ?? {};
  switch (strategy.name) {
    case 'default':
      return true;
    case 'flexibleRollout': {
      const rollout = Number(parameters['rollout'] ?? '100');
      if (rollout >= 100) return true;
      if (rollout <= 0) return false;
      const groupId = parameters['groupId'] ?? featureName;
      return normalise(stickyId(parameters['stickiness'] ?? 'default', context), groupId) <= rollout;
    }
    case 'gradualRolloutUserId':
    case 'gradualRolloutSessionId':
    case 'gradualRolloutRandom': {
      const percentage = Number(parameters['percentage'] ?? '0');
      if (percentage >= 100) return true;
      if (percentage <= 0) return false;
      return normalise(context.userId, parameters['groupId'] ?? featureName) <= percentage;
    }
    case 'userWithId': {
      const ids = (parameters['userIds'] ?? '').split(',').map((id) => id.trim()).filter(Boolean);
      return ids.includes(context.userId);
    }
    default:
      // An unknown strategy is not a false: it is a strategy this client cannot
      // judge, and pretending otherwise silently changes the answer.
      return false;
  }
}

export function evaluateFeature(feature: UnleashFeature, context: UnleashContext): boolean {
  if (!feature.enabled) return false;
  const strategies = feature.strategies ?? [];
  if (strategies.length === 0) return true;
  return strategies.some((strategy) => strategyHolds(strategy, context, feature.name));
}

/** Fetch the toggle list. Throws with a readable message so a settings page can show it. */
export async function fetchFeatures(config: UnleashConfig, signal?: AbortSignal): Promise<UnleashFeature[]> {
  const base = config.url.replace(/\/+$/, '');
  const url = base.endsWith('/api/client/features') ? base : `${base}/api/client/features`;
  const response = await fetch(url, {
    headers: {
      Authorization: config.token,
      'UNLEASH-APPNAME': config.appName,
      'UNLEASH-INSTANCEID': config.instanceId,
      'Content-Type': 'application/json',
      ...(config.environment ? { 'x-unleash-environment': config.environment } : {}),
    },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Unleash answered ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
  }
  const payload = (await response.json()) as { features?: UnleashFeature[] };
  return payload.features ?? [];
}

/** Every strategy this client can actually evaluate, as Unleash wants it declared. */
export const SUPPORTED_STRATEGIES = [
  'default',
  'flexibleRollout',
  'gradualRolloutUserId',
  'gradualRolloutSessionId',
  'gradualRolloutRandom',
  'userWithId',
] as const;

/**
 * Says hello.
 *
 * Without this, Unleash has toggles being read and no idea by what: the
 * project page shows "Connect SDK — Pending" forever and the Applications
 * view is empty, even though every client is fetching happily. Registration
 * is what fills in which builds, which platforms and which versions are out
 * there, which for a desktop app shipped to other people's laptops is the
 * only way to know whether a flag is safe to retire.
 *
 * It is advisory: a failure here never stops flags from working.
 */
export async function registerClient(
  config: UnleashConfig,
  details: { readonly sdkVersion: string; readonly intervalSeconds: number; readonly started?: Date },
  signal?: AbortSignal,
): Promise<void> {
  await post(config, 'register', {
    appName: config.appName,
    instanceId: config.instanceId,
    connectionId: config.instanceId,
    sdkVersion: details.sdkVersion,
    environment: config.environment || 'production',
    strategies: [...SUPPORTED_STRATEGIES],
    started: (details.started ?? new Date()).toISOString(),
    interval: details.intervalSeconds * 1000,
  }, signal);
}

/**
 * How often each toggle came back on or off since the last report.
 *
 * Counts only, never who or what: it answers "is anyone still on the old
 * path" and nothing else, which is the question that lets a flag be deleted.
 */
export async function sendMetrics(
  config: UnleashConfig,
  bucket: { readonly start: Date; readonly stop: Date; readonly toggles: Readonly<Record<string, { yes: number; no: number }>> },
  signal?: AbortSignal,
): Promise<void> {
  if (Object.keys(bucket.toggles).length === 0) return;
  await post(config, 'metrics', {
    appName: config.appName,
    instanceId: config.instanceId,
    connectionId: config.instanceId,
    environment: config.environment || 'production',
    bucket: {
      start: bucket.start.toISOString(),
      stop: bucket.stop.toISOString(),
      toggles: bucket.toggles,
    },
  }, signal);
}

async function post(config: UnleashConfig, path: 'register' | 'metrics', body: unknown, signal?: AbortSignal): Promise<void> {
  const base = config.url.replace(/\/+$/, '').replace(/\/api\/client\/features$/, '');
  const response = await fetch(`${base}/api/client/${path}`, {
    method: 'POST',
    headers: {
      Authorization: config.token,
      'UNLEASH-APPNAME': config.appName,
      'UNLEASH-INSTANCEID': config.instanceId,
      'Content-Type': 'application/json',
      ...(config.environment ? { 'x-unleash-environment': config.environment } : {}),
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Unleash ${path} answered ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
  }
}

/**
 * One line on why the server's answer came out that way.
 *
 * Unleash draws a toggle as "on" whenever the environment is enabled, whatever
 * its strategies then do, so a flag at 0% rollout looks on in the dashboard
 * and is off in every client. That gap is the single most common "the flags
 * are broken" and it is not a bug in either place, so the app says it out
 * loud instead of leaving two screens to contradict each other.
 */
export function explainFeature(feature: UnleashFeature, context: UnleashContext): string | undefined {
  if (!feature.enabled) return 'switched off for this environment';
  const strategies = feature.strategies ?? [];
  if (strategies.length === 0) return undefined;
  if (strategies.some((strategy) => strategyHolds(strategy, context, feature.name))) return undefined;

  const reasons = strategies.map((strategy) => {
    const parameters = strategy.parameters ?? {};
    const failing = (strategy.constraints ?? []).find((constraint) => !constraintHolds(constraint, context));
    if (failing) return `a constraint on ${failing.contextName} does not match this install`;
    if (strategy.name === 'flexibleRollout') {
      const rollout = Number(parameters['rollout'] ?? '100');
      return rollout <= 0 ? 'switched on, but rolled out to 0%' : `rolled out to ${rollout}%, and this install is not in it`;
    }
    if (strategy.name.startsWith('gradualRollout')) {
      const percentage = Number(parameters['percentage'] ?? '0');
      return percentage <= 0 ? 'switched on, but rolled out to 0%' : `rolled out to ${percentage}%, and this install is not in it`;
    }
    if (strategy.name === 'userWithId') return 'limited to named installs, and this is not one';
    return `strategy "${strategy.name}" is one this build cannot evaluate, so it counts as off`;
  });
  return reasons[0];
}
