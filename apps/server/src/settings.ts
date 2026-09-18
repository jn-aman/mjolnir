import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { logger } from '@mjolnir/logger';

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
      perContext: z.record(z.string(), z.object({ namespace: z.string().optional(), label: z.string().optional(), color: z.string().optional() })).default({}),
    })
    .default({ hidden: [], perContext: {} }),
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

  /** What the client may see: keys and tokens become "set" / "". */
  redacted(): unknown {
    const value = this.#value;
    return {
      ...value,
      ai: { ...value.ai, apiKey: value.ai.apiKey ? 'set' : '' },
      mcp: { ...value.mcp, token: value.mcp.token ? 'set' : '' },
      licence: { key: value.licence.key ? 'set' : '' },
    };
  }

  /** Deep-merges a partial update. A key sent as "set" or omitted keeps the stored one. */
  update(patch: unknown): SettingsShape {
    const merged = merge(this.#value, patch) as Record<string, unknown>;
    const ai = merged['ai'] as Record<string, unknown> | undefined;
    if (ai && (ai['apiKey'] === 'set' || ai['apiKey'] === undefined)) ai['apiKey'] = this.#value.ai.apiKey;
    const mcp = merged['mcp'] as Record<string, unknown> | undefined;
    if (mcp && (mcp['token'] === 'set' || mcp['token'] === undefined)) mcp['token'] = this.#value.mcp.token;
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
