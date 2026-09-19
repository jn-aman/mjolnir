import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logger } from '@mjolnir/logger';
import { BUILD, ENDPOINTS } from '@mjolnir/endpoints';

const log = logger.child('settings');

/**
 * Settings that outlive the window.
 *
 * One JSON file, `~/.mjolnir/settings.json`, mode 0600 because it holds API
 * keys. The web client never sees a key back: GET redacts it to "set", PUT
 * with a key replaces it. Everything else round-trips as is.
 */

export const AiSettings = z.object({
  /** `anthropic` speaks the Messages API; `openai` speaks any chat/completions endpoint. */
  provider: z.enum(['anthropic', 'openai']).default('anthropic'),
  /** A preset name for the UI: openai, azure, gemini, ollama, openrouter, groq, mistral, xai, custom. */
  preset: z.string().default('anthropic'),
  baseUrl: z.string().default(''),
  apiKey: z.string().default(''),
  model: z.string().default('claude-sonnet-5'),
  /** Writes (apply, delete, scale, restart, forward) are refused unless this is on. */
  allowWrites: z.boolean().default(false),
  /** Extra instructions prepended to the system prompt. */
  instructions: z.string().default(''),
});

/**
 * Flags: switches the person moved, and the Unleash behind unleash.mjolnir.sh.
 *
 * A release build carries its own read-only client token, so flags work on
 * first launch with nothing configured and nobody is ever asked for a key. It
 * starts enabled for the same reason. A source checkout has no token, so the
 * default is off there and the compiled fallbacks are what runs.
 */
export const FlagSettings = z.object({
  overrides: z.record(z.string(), z.boolean()).default({}),
  remote: z
    .object({
      enabled: z.boolean().default(BUILD.flagsToken !== ''),
      url: z.string().default(ENDPOINTS.flags),
      /** Empty means "use the token this build shipped with". */
      token: z.string().default(''),
      environment: z.string().default('production'),
      refreshSeconds: z.number().int().min(30).max(86_400).default(60),
    })
    .default({ enabled: BUILD.flagsToken !== '', url: ENDPOINTS.flags, token: '', environment: 'production', refreshSeconds: 60 }),
});

/**
 * What leaves the machine, and only after someone said yes.
 *
 * `decided` is not a third switch, it is the record that the question was
 * asked. Without it there is no way to tell "they said no" from "we never
 * asked", and the difference is whether asking again is a reminder or nagging.
 */
export const TelemetrySettings = z.object({
  usage: z.boolean().default(false),
  crashes: z.boolean().default(false),
  decided: z.boolean().default(false),
});

export const UpdateSettings = z.object({
  channel: z.enum(['stable', 'beta']).default('stable'),
  /** Download in the background and install on quit. Off means notify only. */
  automatic: z.boolean().default(true),
  checkOnLaunch: z.boolean().default(true),
  /** A version the person chose to stop being told about. */
  skipped: z.string().default(''),
});

export const Settings = z.object({
  general: z
    .object({
      showSystemNamespaces: z.boolean().default(true),
      defaultNamespace: z.string().default(''),
    })
    .default({ showSystemNamespaces: true, defaultNamespace: '' }),
  clusters: z
    .object({
      hidden: z.array(z.string()).default([]),
      /** Kubeconfig files beyond KUBECONFIG and ~/.kube/config. */
      kubeconfigs: z.array(z.string()).default([]),
      perContext: z
        .record(z.string(), z.object({ namespace: z.string().optional(), namespaces: z.array(z.string()).optional(), label: z.string().optional(), color: z.string().optional() }))
        .default({}),
    })
    .default({ hidden: [], kubeconfigs: [], perContext: {} }),
  ai: AiSettings.default(AiSettings.parse({})),
  mcp: z
    .object({
      /** Serve MCP over HTTP at /mcp on the app server, for agents on this machine. */
      http: z.boolean().default(false),
      /** Bearer token required on /mcp. Generated on first enable. */
      token: z.string().default(''),
      /** Tools an external agent may call. Empty means all read tools; writes need `allowWrites`. */
      allowWrites: z.boolean().default(false),
    })
    .default({ http: false, token: '', allowWrites: false }),
  licence: z.object({ key: z.string().default('') }).default({ key: '' }),
  /** This installation, not this person: a random id, generated once, used for rollouts. */
  install: z
    .object({ id: z.string().default(''), firstRun: z.string().default('') })
    .default({ id: '', firstRun: '' }),
  flags: FlagSettings.default(FlagSettings.parse({})),
  telemetry: TelemetrySettings.default(TelemetrySettings.parse({})),
  updates: UpdateSettings.default(UpdateSettings.parse({})),
  onboarding: z
    .object({ completed: z.boolean().default(false), step: z.string().default(''), version: z.number().default(0) })
    .default({ completed: false, step: '', version: 0 }),
  storage: z
    .object({
      connections: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            endpoint: z.string(),
            region: z.string().default('us-east-1'),
            accessKey: z.string().default(''),
            secretKey: z.string().default(''),
            pathStyle: z.boolean().default(true),
            /** When the store runs in a pod, the forward that reaches it. */
            source: z.object({ context: z.string(), namespace: z.string(), pod: z.string(), port: z.number() }).optional(),
          }),
        )
        .default([]),
    })
    .default({ connections: [] }),
});

export type SettingsShape = z.infer<typeof Settings>;

export class SettingsStore {
  readonly path: string;
  #value: SettingsShape;

  constructor(dir = join(homedir(), '.mjolnir')) {
    this.path = join(dir, 'settings.json');
    this.#value = this.#read(dir);
  }

  get(): SettingsShape {
    return this.#value;
  }

  /**
   * The installation id, minted on first read.
   *
   * It identifies a copy of the app, never a person: a random UUID with nothing
   * derived from the machine, so it cannot be correlated with anything outside
   * Mjolnir, and deleting settings.json genuinely starts a new one.
   */
  installId(): string {
    if (!this.#value.install.id) {
      this.#value = Settings.parse({ ...this.#value, install: { id: randomUUID(), firstRun: new Date().toISOString() } });
      this.#write();
    }
    return this.#value.install.id;
  }

  /** What the client may see: keys and tokens become "set" / "". */
  redacted(): unknown {
    const value = this.#value;
    return {
      ...value,
      ai: { ...value.ai, apiKey: value.ai.apiKey ? 'set' : '' },
      mcp: { ...value.mcp, token: value.mcp.token ? 'set' : '' },
      flags: { ...value.flags, remote: { ...value.flags.remote, token: value.flags.remote.token ? 'set' : '' } },
      licence: { key: value.licence.key ? 'set' : '' },
      storage: { connections: value.storage.connections.map((c) => ({ ...c, secretKey: c.secretKey ? 'set' : '' })) },
    };
  }

  /** Deep-merges a partial update. A key sent as "set" or omitted keeps the stored one. */
  update(patch: unknown): SettingsShape {
    const merged = merge(this.#value, patch) as Record<string, unknown>;
    const ai = merged['ai'] as Record<string, unknown> | undefined;
    if (ai && (ai['apiKey'] === 'set' || ai['apiKey'] === undefined)) ai['apiKey'] = this.#value.ai.apiKey;
    const mcp = merged['mcp'] as Record<string, unknown> | undefined;
    if (mcp && (mcp['token'] === 'set' || mcp['token'] === undefined)) mcp['token'] = this.#value.mcp.token;
    const flags = merged['flags'] as { remote?: Record<string, unknown> } | undefined;
    if (flags?.remote && (flags.remote['token'] === 'set' || flags.remote['token'] === undefined)) flags.remote['token'] = this.#value.flags.remote.token;
    const licence = merged['licence'] as Record<string, unknown> | undefined;
    if (licence && (licence['key'] === 'set' || licence['key'] === undefined)) licence['key'] = this.#value.licence.key;
    this.#value = Settings.parse(merged);
    this.#write();
    return this.#value;
  }

  #read(dir: string): SettingsShape {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const raw = readFileSync(this.path, 'utf8');
      return Settings.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') log.warn('settings unreadable, using defaults', { error: String(error) });
      return Settings.parse({});
    }
  }

  #write(): void {
    writeFileSync(this.path, JSON.stringify(this.#value, null, 2), { mode: 0o600 });
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // Windows has no mode bits; the file is still under the user's profile.
    }
  }
}

function merge(target: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out: Record<string, unknown> = target && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) out[key] = merge(out[key], value);
  return out;
}
