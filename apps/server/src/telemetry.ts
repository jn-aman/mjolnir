import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { ENDPOINTS } from '@mjolnir/endpoints';
import { logger } from '@mjolnir/logger';
import type { SettingsStore } from './settings.ts';

const log = logger.child('telemetry');

/**
 * What Mjolnir may say about itself, and nothing else.
 *
 * This app holds credentials for every cluster you own and reads Secrets out
 * of production. The only defensible telemetry design is one where the set of
 * things that can be sent is written down in advance, in this file, and
 * anything not on the list cannot leave even by accident. So an event is a
 * name from the list below plus counters, and every string value has to match
 * one of the values the event declares. A namespace, a pod name, a cluster
 * name, a bucket, a file path or a hostname has nowhere to fit.
 *
 * The person can read the exact queue before it is sent, and nothing is sent
 * until they have answered the question.
 */

const MODULES = ['kubernetes', 'cloud', 'docker', 'storage', 'machines', 'alerts', 'db', 'kafka', 'settings'] as const;
const SURFACES = ['overview', 'list', 'detail', 'dock', 'palette', 'assistant', 'settings', 'welcome'] as const;
const OUTCOMES = ['ok', 'denied', 'error', 'cancelled'] as const;

interface EventShape {
  /** Which string props the event may carry, and the only values each may take. */
  readonly strings?: Readonly<Record<string, readonly string[]>>;
  /** Which numeric props it may carry. */
  readonly numbers?: readonly string[];
}

export const EVENTS: Readonly<Record<string, EventShape>> = {
  'app.launch': { strings: { channel: ['stable', 'beta'] }, numbers: ['startupMs'] },
  'app.session': { numbers: ['minutes', 'modulesUsed'] },
  'module.open': { strings: { module: MODULES } },
  'surface.open': { strings: { surface: SURFACES, module: MODULES } },
  'resource.action': { strings: { outcome: OUTCOMES }, numbers: ['count'] },
  'assistant.turn': { strings: { provider: ['anthropic', 'openai'], outcome: OUTCOMES }, numbers: ['tools'] },
  'shell.open': { strings: { outcome: OUTCOMES } },
  'scan.run': { strings: { outcome: OUTCOMES }, numbers: ['findings'] },
  'update.check': { strings: { outcome: OUTCOMES } },
  'update.install': { strings: { channel: ['stable', 'beta'] } },
  'welcome.step': { strings: { step: ['intro', 'clusters', 'containers', 'assistant', 'privacy', 'ready'], outcome: OUTCOMES } },
  'error.api': { strings: { code: ['bad-request', 'auth', 'not-found', 'upstream', 'internal'] }, numbers: ['status'] },
} as const;

export interface TelemetryEvent {
  readonly name: string;
  readonly at: string;
  readonly props: Readonly<Record<string, string | number | boolean>>;
}

/** A crash, with every path reduced to a file name and the home directory gone. */
export interface CrashReport {
  readonly at: string;
  readonly kind: 'renderer' | 'main' | 'server';
  readonly message: string;
  readonly stack: readonly string[];
}

const HOME = homedir();

export function scrubText(text: string): string {
  return text
    .split(HOME)
    .join('~')
    // A stack frame is useful as file:line; the directories above it are not.
    .replace(/(?:file:\/\/)?(?:\/[\w.@+-]+)+\/([\w.@+-]+\.(?:t|j)sx?)/g, '$1')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, 'redacted@redacted')
    .slice(0, 400);
}

/** Keeps only what the event declared. Anything else is dropped, not truncated. */
export function sanitiseEvent(name: string, props: Record<string, unknown>): TelemetryEvent | null {
  const shape = EVENTS[name];
  if (!shape) return null;
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'boolean') {
      clean[key] = value;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (shape.numbers?.includes(key)) clean[key] = Math.round(value);
      continue;
    }
    if (typeof value === 'string') {
      const allowed = shape.strings?.[key];
      if (allowed?.includes(value)) clean[key] = value;
    }
  }
  return { name, at: new Date().toISOString(), props: clean };
}

export function sanitiseCrash(kind: CrashReport['kind'], message: string, stack: string): CrashReport {
  return {
    at: new Date().toISOString(),
    kind,
    message: scrubText(message),
    stack: stack.split('\n').slice(0, 24).map((line) => scrubText(line.trim())),
  };
}

const MAX_QUEUE = 500;

export class Telemetry {
  readonly #settings: SettingsStore;
  readonly #path: string;
  readonly #version: string;
  #queue: Array<TelemetryEvent | { crash: CrashReport }> = [];
  #timer: NodeJS.Timeout | undefined;
  #lastSend: string | undefined;
  #lastError: string | undefined;

  constructor(settings: SettingsStore, version: string, dir = join(homedir(), '.mjolnir')) {
    this.#settings = settings;
    this.#version = version;
    this.#path = join(dir, 'telemetry.jsonl');
    this.#queue = this.#read();
  }

  /** Record an event. Dropped on the floor when the shape does not match, or consent is absent. */
  record(name: string, props: Record<string, unknown> = {}): void {
    if (!this.#settings.get().telemetry.usage) return;
    const event = sanitiseEvent(name, props);
    if (!event) return;
    this.#push(event);
  }

  crash(kind: CrashReport['kind'], message: string, stack: string): void {
    if (!this.#settings.get().telemetry.crashes) return;
    this.#push({ crash: sanitiseCrash(kind, message, stack) });
  }

  /** Exactly what would be sent, for the settings page to show before it goes. */
  pending(): { queue: ReadonlyArray<unknown>; envelope: Record<string, unknown>; lastSend?: string | undefined; lastError?: string | undefined } {
    return { queue: this.#queue, envelope: this.#envelope([]), lastSend: this.#lastSend, lastError: this.#lastError };
  }

  clear(): void {
    this.#queue = [];
    this.#write();
  }

  async flush(): Promise<{ sent: number; error?: string }> {
    const telemetry = this.#settings.get().telemetry;
    if (!telemetry.usage && !telemetry.crashes) return { sent: 0 };
    if (this.#queue.length === 0) return { sent: 0 };
    const batch = this.#queue.slice(0, 200);
    try {
      const response = await fetch(`${ENDPOINTS.telemetry}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.#envelope(batch)),
      });
      if (!response.ok) throw new Error(`ingest answered ${response.status}`);
      this.#queue = this.#queue.slice(batch.length);
      this.#write();
      this.#lastSend = new Date().toISOString();
      this.#lastError = undefined;
      return { sent: batch.length };
    } catch (error) {
      // Keep the queue. Telemetry that loses itself on a flaky network is worse
      // than useless, and telemetry that retries forever is a battery drain,
      // so it waits for the next interval with a bounded queue behind it.
      this.#lastError = error instanceof Error ? error.message : String(error);
      log.debug('telemetry not sent', { error: this.#lastError });
      return { sent: 0, error: this.#lastError };
    }
  }

  start(): void {
    this.stop();
    this.#timer = setInterval(() => void this.flush(), 15 * 60 * 1000);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  #envelope(batch: ReadonlyArray<unknown>): Record<string, unknown> {
    return {
      install: this.#settings.installId(),
      version: this.#version,
      channel: this.#settings.get().updates.channel,
      platform: platform(),
      arch: arch(),
      osRelease: release(),
      events: batch,
    };
  }

  #push(entry: TelemetryEvent | { crash: CrashReport }): void {
    this.#queue.push(entry);
    if (this.#queue.length > MAX_QUEUE) this.#queue = this.#queue.slice(-MAX_QUEUE);
    try {
      mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
      appendFileSync(this.#path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch {
      // A queue that cannot be written is a queue that lives in memory.
    }
  }

  #read(): Array<TelemetryEvent | { crash: CrashReport }> {
    try {
      return readFileSync(this.#path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-MAX_QUEUE)
        .map((line) => JSON.parse(line) as TelemetryEvent);
    } catch {
      return [];
    }
  }

  #write(): void {
    try {
      writeFileSync(this.#path, this.#queue.map((entry) => JSON.stringify(entry)).join('\n') + (this.#queue.length ? '\n' : ''), { mode: 0o600 });
    } catch {
      // as above
    }
  }
}
