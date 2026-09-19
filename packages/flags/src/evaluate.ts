import { FLAGS, type FlagDefinition } from './registry.ts';
import { evaluateFeature, explainFeature, type UnleashContext, type UnleashFeature } from './unleash.ts';

/**
 * Where a value came from, which is the part people actually argue about.
 *
 * `override` is a switch someone moved in settings and it always wins: a
 * remote server may suggest what a build does, it may not take a switch out of
 * the hands of the person at the keyboard. `remote` is Unleash agreeing to
 * have an opinion about a flag we declared. `default` is the build's own
 * answer, and is what you get on a train.
 */
export type FlagSource = 'override' | 'remote' | 'default';

export interface FlagState {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly stage: FlagDefinition['stage'];
  readonly module: string;
  readonly warning?: string | undefined;
  readonly value: boolean;
  readonly source: FlagSource;
  /** What the build says, shown next to an override so the difference is visible. */
  readonly fallback: boolean;
  /** What the remote said, when it said anything. */
  readonly remote?: boolean | undefined;
  /**
   * Why the remote's answer is what it is, when the toggle alone does not
   * explain it. An Unleash toggle switched on with a 0% rollout is off for
   * everyone, and its own UI still draws it as on, so without this the app
   * and the server look like they disagree when they do not.
   */
  readonly remoteReason?: string | undefined;
}

export interface EvaluateInput {
  /** Explicit switches from settings: id to on/off. */
  readonly overrides: Readonly<Record<string, boolean>>;
  /** Toggles fetched from Unleash, keyed by flag id. */
  readonly features: Readonly<Record<string, UnleashFeature>>;
  readonly context: UnleashContext;
  readonly definitions?: readonly FlagDefinition[];
}

export function evaluateAll(input: EvaluateInput): FlagState[] {
  return (input.definitions ?? FLAGS).map((definition) => {
    const feature = input.features[definition.id];
    const remote = feature ? evaluateFeature(feature, input.context) : undefined;
    const override = input.overrides[definition.id];
    const value = override ?? remote ?? definition.fallback;
    const source: FlagSource = override !== undefined ? 'override' : remote !== undefined ? 'remote' : 'default';
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      stage: definition.stage,
      module: definition.module,
      warning: definition.warning,
      value,
      source,
      fallback: definition.fallback,
      remote,
      ...(feature ? { remoteReason: explainFeature(feature, input.context) } : {}),
    };
  });
}

export function valuesOf(states: readonly FlagState[]): Record<string, boolean> {
  return Object.fromEntries(states.map((state) => [state.id, state.value]));
}
