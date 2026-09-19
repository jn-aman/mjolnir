import { platform, release } from 'node:os';
import { evaluateAll, fetchFeatures, registerClient, sendMetrics, type FlagState, type UnleashContext, type UnleashFeature } from '@mjolnir/flags';
import { BUILD, FLAG_ENVIRONMENT, hostRefusal } from '@mjolnir/endpoints';
import { logger } from '@mjolnir/logger';
import type { SettingsStore } from './settings.ts';

const log = logger.child('flags');

/** Unleash's own SDKs default to a minute, and the UI is built around that. */
const METRICS_SECONDS = 60;

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
  #metricsTimer: NodeJS.Timeout | undefined;
  #fetchedAt: string | undefined;
  #error: string | undefined;
  #version: string;
  #registered = false;
  #account: (() => { tier: string; email?: string; accountId?: string; plan?: string } | undefined) | undefined;
  #bucketStart = new Date();
  readonly #started = new Date();
  #counts = new Map<string, { yes: number; no: number }>();

  constructor(settings: SettingsStore, version: string) {
    this.#settings = settings;
    this.#version = version;
  }

  /**
   * What Unleash is told about this install, so it can decide.
   *
   * `userId` is the person's email once they are signed in, because that is
   * what "turn this on for this customer" means and Unleash's own
   * `userWithId` strategy takes a list of them. Signed out, or with the
   * privacy switch off, it falls back to the install id, so a rollout still
   * has something stable to be sticky on.
   *
   * `sessionId` is always the install id, never the email. That keeps the
   * per-machine identity available as a stickiness option: a rollout keyed on
   * `sessionId` stays put when someone signs in or out, which is the property
   * a gradual rollout needs and the one a person-keyed rollout cannot have.
   *
   * The account also appears in the properties, where a constraint can match
   * the plan or the tier, so "this is a Pro feature" is a server decision
   * rather than a compiled-in one. That does mean the flag server learns the
   * email of signed-in users, which is a real thing to have decided, so it is
   * a switch on the privacy page.
   */
  context(): UnleashContext {
    const settings = this.#settings.get();
    const remote = settings.flags.remote;
    const account = remote.identify ? this.#account?.() : undefined;
    return {
      userId: account?.email || this.#settings.installId(),
      sessionId: this.#settings.installId(),
      environment: FLAG_ENVIRONMENT,
      appName: 'mjolnir',
      properties: {
        platform: platform(),
        osRelease: release(),
        version: this.#version,
        channel: settings.updates.channel,
        // Always present, so a constraint can be written against the free
        // tier without having to express "the property is missing".
        tier: account?.tier ?? 'free',
        ...(account?.email ? { email: account.email } : {}),
        ...(account?.accountId ? { accountId: account.accountId } : {}),
        ...(account?.plan ? { plan: account.plan } : {}),
      },
    };
  }

  /**
   * Where the account comes from.
   *
   * A function rather than a reference, because the flag store is built before
   * the account store and must not care whether one exists: a build with no
   * account at all evaluates flags exactly as it does now.
   */
  setAccountSource(source: () => { tier: string; email?: string; accountId?: string; plan?: string } | undefined): void {
    this.#account = source;
  }

  states(): FlagState[] {
    return evaluateAll({
      overrides: this.#settings.get().flags.overrides,
      features: this.#features,
      context: this.context(),
    });
  }

  value(id: string): boolean {
    const value = this.states().find((state) => state.id === id)?.value ?? false;
    this.#count(id, value);
    return value;
  }

  /**
   * One tally per toggle per reporting window.
   *
   * Unleash needs to know a flag is still being read to tell you it is safe to
   * delete, and it only learns that from these counts. Numbers only: no user,
   * no cluster, no context.
   */
  #count(id: string, value: boolean): void {
    const current = this.#counts.get(id) ?? { yes: 0, no: 0 };
    if (value) current.yes += 1;
    else current.no += 1;
    this.#counts.set(id, current);
  }

  /** Every flag's current answer, tallied. The client asks for all of them at once. */
  statesCounted(): FlagState[] {
    const states = this.states();
    for (const state of states) this.#count(state.id, state.value);
    return states;
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
    // `null` is the store's removal marker, so handing a flag back is one
    // write and not a clear-then-rewrite that merged straight back into place.
    this.#settings.update({ flags: { overrides: { [id]: value } } });
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
        // A token typed into settings wins; otherwise the one this build ships
        // with, so nobody has to paste anything for flags to work.
        token: remote.token || BUILD.flagsToken,
        appName: 'mjolnir',
        environment: FLAG_ENVIRONMENT,
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

  #config() {
    const remote = this.#settings.get().flags.remote;
    return {
      url: remote.url,
      token: remote.token || BUILD.flagsToken,
      appName: 'mjolnir',
      environment: FLAG_ENVIRONMENT,
      instanceId: this.#settings.installId(),
    };
  }

  /**
   * Says hello, once.
   *
   * Until this lands, Unleash shows every flag as "Connect SDK — Pending":
   * it has toggles being served and no record of anything serving them.
   */
  async #register(): Promise<void> {
    if (this.#registered) return;
    try {
      await registerClient(this.#config(), {
        sdkVersion: `mjolnir:${this.#version}`,
        intervalSeconds: METRICS_SECONDS,
        started: this.#started,
      });
      this.#registered = true;
      log.info('registered with unleash', { version: this.#version });
    } catch (error) {
      log.debug('unleash registration failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Reports how each toggle answered since the last report.
   *
   * On its own clock, not the feature poll's. Features are re-read every
   * fifteen minutes because a flag changing is rare; metrics go every minute
   * because until the first bucket arrives Unleash says "Waiting for flag
   * evaluations" and the flag looks unimplemented. The two intervals answer
   * different questions and tying them together got the second one wrong.
   */
  async #report(): Promise<void> {
    if (!this.#settings.get().flags.remote.enabled) return;
    await this.#register();
    const toggles = Object.fromEntries(this.#counts);
    if (Object.keys(toggles).length === 0) return;
    const stop = new Date();
    try {
      await sendMetrics(this.#config(), { start: this.#bucketStart, stop, toggles });
      this.#counts.clear();
      this.#bucketStart = stop;
      log.debug('flag metrics reported', { toggles: Object.keys(toggles).length });
    } catch (error) {
      // Keep the counts and try again next tick rather than losing the window.
      log.debug('unleash metrics failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Start polling, or stop and restart with the interval the settings now say. */
  start(): void {
    this.stop();
    const remote = this.#settings.get().flags.remote;
    if (!remote.enabled) return;
    void this.refresh();
    this.#timer = setInterval(() => void this.refresh(), remote.refreshSeconds * 1000);
    this.#timer.unref();

    // Register straight away; the first bucket goes a minute later, by which
    // point the app has asked for the flag list at least once.
    void this.#register();
    this.#metricsTimer = setInterval(() => void this.#report(), METRICS_SECONDS * 1000);
    this.#metricsTimer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    if (this.#metricsTimer) clearInterval(this.#metricsTimer);
    this.#metricsTimer = undefined;
  }

  /** Flushes the current bucket now, for shutdown and for the settings page. */
  async flush(): Promise<void> {
    await this.#report();
  }
}
