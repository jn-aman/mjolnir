import { platform, release } from 'node:os';
import { evaluateAll, fetchFeatures, type FlagState, type UnleashContext, type UnleashFeature } from '@mjolnir/flags';
import { hostRefusal } from '@mjolnir/endpoints';
import { logger } from '@mjolnir/logger';
import type { SettingsStore } from './settings.ts';

const log = logger.child('flags');

export interface RemoteStatus {
  readonly enabled: boolean;
  readonly url: string;
  readonly state: 'off' | 'never-fetched' | 'ok' | 'failed';
  readonly fetchedAt?: string | undefined;
  readonly error?: string | undefined;
  readonly count: number;
}

/**
 * Flags, resolved.
 *
 * The rule that matters is the order: a switch someone moved beats the remote,
 * the remote beats the build default, and the build default always exists. So
 * the app has an answer before the network does, keeps working when Unleash is
 * unreachable, and a person who turns something off stays with it off no
 * matter what the server later says.
 *
 * The poll is a plain fetch on an interval rather than a long-lived stream,
 * because a desktop app sleeps, wakes on a different network, and should not
 * hold a socket open to our infrastructure to find out whether a menu item
 * exists.
 */
export class FlagStore {
  readonly #settings: SettingsStore;
  #features: Record<string, UnleashFeature> = {};
  #timer: NodeJS.Timeout | undefined;
  #fetchedAt: string | undefined;
  #error: string | undefined;
  #version: string;

  constructor(settings: SettingsStore, version: string) {
    this.#settings = settings;
    this.#version = version;
  }

  context(): UnleashContext {
    const remote = this.#settings.get().flags.remote;
    return {
      userId: this.#settings.installId(),
      sessionId: this.#settings.installId(),
      environment: remote.environment || 'production',
      appName: 'mjolnir',
      properties: {
        platform: platform(),
        osRelease: release(),
        version: this.#version,
        channel: this.#settings.get().updates.channel,
      },
    };
  }

  states(): FlagState[] {
    return evaluateAll({
      overrides: this.#settings.get().flags.overrides,
      features: this.#features,
      context: this.context(),
    });
  }

  value(id: string): boolean {
    return this.states().find((state) => state.id === id)?.value ?? false;
  }

  status(): RemoteStatus {
    const remote = this.#settings.get().flags.remote;
    const state: RemoteStatus['state'] = !remote.enabled
      ? 'off'
      : this.#error
        ? 'failed'
        : this.#fetchedAt
          ? 'ok'
          : 'never-fetched';
    return {
      enabled: remote.enabled,
      url: remote.url,
      state,
      fetchedAt: this.#fetchedAt,
      error: this.#error,
      count: Object.keys(this.#features).length,
    };
  }

  /** Move a switch, or hand the flag back to whatever else has an opinion. */
  override(id: string, value: boolean | null): FlagState[] {
    const overrides = { ...this.#settings.get().flags.overrides };
    if (value === null) delete overrides[id];
    else overrides[id] = value;
    // The store deep-merges, so a removal has to replace the whole map.
    this.#settings.update({ flags: { overrides: {} } });
    this.#settings.update({ flags: { overrides } });
    return this.states();
  }

  async refresh(): Promise<RemoteStatus> {
    const remote = this.#settings.get().flags.remote;
    if (!remote.enabled) {
      this.#features = {};
      this.#error = undefined;
      return this.status();
    }
    const refusal = hostRefusal(remote.url);
    if (refusal) {
      this.#error = refusal;
      return this.status();
    }
    try {
      const features = await fetchFeatures({
        url: remote.url,
        token: remote.token,
        appName: 'mjolnir',
        environment: remote.environment,
        instanceId: this.#settings.installId(),
      });
      this.#features = Object.fromEntries(features.map((feature) => [feature.name, feature]));
      this.#fetchedAt = new Date().toISOString();
      this.#error = undefined;
      log.info('flags refreshed', { count: features.length });
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
      log.warn('flag refresh failed, keeping the last answer', { error: this.#error });
    }
    return this.status();
  }

  /** Start polling, or stop and restart with the interval the settings now say. */
  start(): void {
    this.stop();
    const remote = this.#settings.get().flags.remote;
    if (!remote.enabled) return;
    void this.refresh();
    this.#timer = setInterval(() => void this.refresh(), remote.refreshSeconds * 1000);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
