import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  Cloud,
  Copy,
  Download,
  EyeOff,
  Flag,
  FolderOpen,
  Info,
  Keyboard,
  Plug,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type AppSettings, type ClustersResponse, type LicenceStatus } from '../lib/api.ts';
import type { ThemeChoice } from '../lib/theme.ts';
import { offsetLabel, timezoneOptions, useTimezone } from '../lib/time.ts';
import { Card } from './ui/Card.tsx';
import { Button } from './ui/Button.tsx';
import { Select } from './ui/Select.tsx';
import { Field } from './ui/Field.tsx';
import { Switch } from './ui/Switch.tsx';
import { ConfirmDialog } from './ui/Modal.tsx';
import { copyText } from './ui/ContextMenu.tsx';
import { AskSave } from './ui/AskSave.tsx';
import { AccountSection } from './settings/AccountSection.tsx';
import { FlagsSection } from './settings/FlagsSection.tsx';
import { PrivacySection } from './settings/PrivacySection.tsx';
import { UpdatesSection } from './settings/UpdatesSection.tsx';
import { filePath, licenceKey, modelName, namespaceName, optionalUrl } from '../lib/validate.ts';
import { MarkTile } from './ui/Mark.tsx';
import { useFlags } from '../lib/flags.tsx';

/**
 * Settings, in two scopes.
 *
 * Mjolnir is the product; Kubernetes is one of its modules. So the app has
 * its own settings (look, time, the assistant, the MCP server, the licence)
 * and the Kubernetes module has its own (kubeconfig, clusters, namespaces,
 * the tools that plug into it). Neither assumes the other. Sections that are
 * not built yet still have their place, so the layout does not move when
 * they arrive.
 */

export type SettingsScope = 'app' | 'kubernetes';

interface SettingsPanelProps {
  readonly scope: SettingsScope;
  readonly clusters: ClustersResponse | null;
  readonly theme: ThemeChoice;
  readonly onTheme: (choice: ThemeChoice) => void;
  readonly onReload: () => Promise<void>;
  readonly onClustersChanged: () => Promise<void>;
  /** Open on this section, e.g. "kubeconfig" from the + on the cluster strip. */
  readonly initialSection?: string | undefined;
  readonly onSectionShown?: (() => void) | undefined;
  /** Opens the first-run welcome again from the privacy section. */
  readonly onReplayWelcome?: (() => void) | undefined;
}

interface Section {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly planned?: string;
  /** Present only when this flag is on. Settings for a module nobody has is noise. */
  readonly flag?: string;
  /**
   * Ours, not theirs.
   *
   * Some of what this app can do is decided by a flag server, and that is our
   * problem to run rather than a thing to hand somebody a switchboard for. A
   * person using Mjolnir should be oblivious to the existence of feature
   * flags: a page of thirty-five toggles, half of them naming features that
   * do not exist yet, is an invitation to break the app and then report the
   * break.
   *
   * It stays reachable in development, because turning a flag off by hand is
   * how the combinations get tested.
   */
  readonly internal?: boolean;
}

const APP_SECTIONS: readonly Section[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'ai', label: 'AI assistant', icon: Bot },
  { id: 'mcp', label: 'MCP server', icon: Plug },
  { id: 'account', label: 'Account', icon: UserRound, flag: 'account.sign-in' },
  { id: 'licence', label: 'Licence', icon: BadgeCheck },
  { id: 'flags', label: 'Feature flags', icon: Flag, internal: true },
  { id: 'updates', label: 'Updates', icon: Download },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'cloud', label: 'Cloud access', icon: Cloud, flag: 'module.cloud', planned: 'Identities, sessions and where credentials are kept arrive with the Cloud access workspace.' },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { id: 'advanced', label: 'Advanced', icon: SlidersHorizontal, planned: 'Log level, data directory, local API port and the reset button.' },
  { id: 'about', label: 'About', icon: Info },
];

const K8S_SECTIONS: readonly Section[] = [
  { id: 'kubeconfig', label: 'Kubeconfig', icon: FolderOpen },
  { id: 'clusters', label: 'Clusters', icon: Server },
  { id: 'namespaces', label: 'Namespaces', icon: Settings2 },
  { id: 'integrations', label: 'Integrations', icon: Wrench, planned: 'Paths and endpoints for Helm, Argo CD, Trivy and the metrics server, with a check button for each.' },
];

const SECTION_BLURB: Record<string, string> = {
  general: 'How the app looks and behaves.',
  ai: 'The assistant: who answers, with what permissions.',
  mcp: 'Let other agents use your clusters through Mjolnir.',
  licence: 'Your plan, and the key that unlocks it.',
  shortcuts: 'Every key the app listens for.',
  cloud: 'Identities and sessions, when the Cloud access module lands.',
  privacy: 'What leaves this machine. Nothing, unless you ask.',
  advanced: 'Ports, logs, data and the reset button.',
  about: 'This build, and who made it.',
  kubeconfig: 'Where the clusters come from.',
  clusters: 'Every context Mjolnir knows, and how it shows them.',
  namespaces: 'What you see by default in a cluster.',
  integrations: 'Helm, Argo CD, Trivy and the metrics server.',
};

const AI_PRESETS: ReadonlyArray<{ id: string; label: string; provider: 'anthropic' | 'openai'; baseUrl: string; model: string; needsKey: boolean }> = [
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', baseUrl: '', model: 'claude-sonnet-5', needsKey: true },
  { id: 'openai', label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', needsKey: true },
  { id: 'azure', label: 'Azure OpenAI', provider: 'openai', baseUrl: 'https://<resource>.openai.azure.com/openai/v1', model: '<deployment>', needsKey: true },
  { id: 'gemini', label: 'Google Gemini', provider: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-pro', needsKey: true },
  { id: 'ollama', label: 'Ollama (local)', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', needsKey: false },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4', needsKey: true },
  { id: 'groq', label: 'Groq', provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', needsKey: true },
  { id: 'mistral', label: 'Mistral', provider: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', needsKey: true },
  { id: 'xai', label: 'xAI', provider: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-4', needsKey: true },
  { id: 'mimo', label: 'Xiaomi MiMo', provider: 'openai', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2-flash', needsKey: true },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', provider: 'openai', baseUrl: '', model: '', needsKey: false },
];

export function SettingsPanel({ scope, clusters, theme, onTheme, onReload, onClustersChanged, initialSection, onSectionShown, onReplayWelcome }: SettingsPanelProps) {
  const { values: flagValues } = useFlags();
  // Memoised on what it is actually made of. Built inline it was a new array
  // every render, the effect below depends on it, and so every click reset the
  // section back to the first one: the nav looked dead because it was.
  const flagSignature = Object.entries(flagValues)
    .map(([id, value]) => `${id}=${value}`)
    .sort()
    .join(',');
  const sections = useMemo(
    () =>
      (scope === 'app' ? APP_SECTIONS : K8S_SECTIONS)
        .filter((entry) => !entry.flag || flagValues[entry.flag] === true)
        // `import.meta.env.DEV` is false in every packaged build, so an
        // internal page cannot ship by being forgotten about.
        .filter((entry) => !entry.internal || import.meta.env.DEV),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, flagSignature],
  );
  const [section, setSection] = useState(sections[0]?.id ?? 'general');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [meta, setMeta] = useState<{ path: string; mcpCommand?: string } | null>(null);

  // Only when the panel is asked to show a particular section, or the scope
  // changes underneath it. Never merely because it re-rendered.
  useEffect(() => {
    setSection((current) => {
      if (initialSection && sections.some((entry) => entry.id === initialSection)) return initialSection;
      if (sections.some((entry) => entry.id === current)) return current;
      return sections[0]?.id ?? 'general';
    });
    if (initialSection) onSectionShown?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, flagSignature, initialSection]);

  const refresh = async () => {
    const response = await api.settings.get();
    setSettings(response.settings);
    setMeta({ path: response.path, ...(response.mcpCommand ? { mcpCommand: response.mcpCommand } : {}) });
  };
  useEffect(() => {
    void refresh();
  }, []);

  const save = async (patch: unknown, said = 'Saved') => {
    try {
      const response = await api.settings.update(patch);
      setSettings(response.settings);
      toast.success(said, { duration: 1200 });
    } catch (error) {
      toast.error(`Could not save: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const current = sections.find((entry) => entry.id === section) ?? sections[0];

  return (
    <div data-testid={`settings-${scope}`} className="flex min-h-0 flex-1">
      <nav className="w-[224px] shrink-0 border-r border-line bg-raised py-3" aria-label="Settings sections">
        <div className="mx-3 mb-2 flex items-center gap-2.5 rounded-lg px-2 py-2" style={{ background: `color-mix(in oklab, ${scope === 'app' ? 'var(--accent-base)' : 'var(--series-1)'} 10%, transparent)` }}>
          <span className="icon-chip" style={{ ['--chip-tint' as string]: scope === 'app' ? 'var(--accent-base)' : 'var(--series-1)' }} aria-hidden>
            <Settings2 size={14} strokeWidth={1.9} />
          </span>
          <div>
            <div className="text-[13px] font-semibold text-primary">{scope === 'app' ? 'Mjolnir settings' : 'Kubernetes settings'}</div>
          </div>
        </div>
        {sections.map((entry) => {
          const Icon = entry.icon;
          const active = entry.id === section;
          return (
            <button
              key={entry.id}
              type="button"
              data-testid={`settings-nav-${entry.id}`}
              onClick={() => setSection(entry.id)}
              className={`relative mx-2 flex w-[calc(100%-16px)] items-center gap-2.5 rounded-md py-[6px] pl-2 pr-2.5 text-left text-[13px] transition-colors duration-100 ${active ? 'text-primary' : 'text-secondary hover:bg-hover hover:text-primary'}`}
            >
              {active ? <motion.span layoutId="settings-active" aria-hidden className="row-selected absolute inset-0 rounded-md border-l-2 border-accent" transition={{ type: 'spring', stiffness: 480, damping: 38 }} /> : null}
              <span className="icon-chip relative !h-[22px] !w-[22px] !rounded-[6px]" style={{ ['--chip-tint' as string]: active ? 'var(--accent-base)' : 'var(--text-tertiary)' }} aria-hidden>
                <Icon size={12} strokeWidth={2} />
              </span>
              <span className="relative flex-1">{entry.label}</span>
              {entry.planned ? <span className="relative text-[9.5px] font-semibold uppercase tracking-wide text-tertiary">soon</span> : null}
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={section} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }} className="mx-auto max-w-[820px] space-y-3.5">
            {current ? (
              <div className="mb-1 flex items-center gap-3">
                <span className="icon-chip icon-chip-lg" style={{ ['--chip-tint' as string]: current.planned ? 'var(--text-tertiary)' : 'var(--accent-base)' }} aria-hidden>
                  <current.icon size={19} strokeWidth={1.9} />
                </span>
                <div>
                  <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-primary">{current.label}</h1>
                  <p className="text-[12px] text-tertiary">{SECTION_BLURB[current.id] ?? ''}</p>
                </div>
              </div>
            ) : null}
            {current?.planned ? (
              <Card title={current.label} subtitle="Planned">
                <p className="text-[12.5px] text-secondary">{current.planned}</p>
              </Card>
            ) : null}

            {section === 'general' ? <General theme={theme} onTheme={onTheme} settings={settings} /> : null}
            {section === 'ai' ? <Ai settings={settings} onSave={save} /> : null}
            {section === 'mcp' ? <Mcp settings={settings} meta={meta} onSave={save} onRefresh={refresh} /> : null}
            {section === 'account' ? <AccountSection /> : null}
            {section === 'licence' ? <Licence /> : null}
            {section === 'flags' ? <FlagsSection settings={settings} onSave={save} /> : null}
            {section === 'updates' ? <UpdatesSection /> : null}
            {section === 'privacy' ? <PrivacySection onReplayWelcome={() => void onReplayWelcome?.()} /> : null}
            {section === 'shortcuts' ? <Shortcuts /> : null}
            {section === 'about' ? <About path={meta?.path} /> : null}

            {section === 'kubeconfig' ? <Kubeconfig clusters={clusters} settings={settings} onReload={onReload} onChanged={async () => { await onClustersChanged(); await refresh(); }} /> : null}
            {section === 'clusters' ? <Clusters clusters={clusters} settings={settings} onChanged={onClustersChanged} /> : null}
            {section === 'namespaces' ? <Namespaces settings={settings} onSave={save} /> : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------ app scope ------------------------------ */

function General({ theme, onTheme, settings }: { theme: ThemeChoice; onTheme: (c: ThemeChoice) => void; settings: AppSettings | null }) {
  const timezone = useTimezone();
  return (
    <>
      <Card title="Appearance">
        <Row label="Theme" hint="System follows your operating system setting." control={<Select label="Theme" value={theme} onChange={(value) => onTheme(value as ThemeChoice)} testId="theme-select" align="end" options={[{ value: 'system', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />} />
        <Divider />
        <Row
          label="Timezone"
          hint={`Every timestamp in the app is shown in this zone. Now ${offsetLabel(timezone.zone)}.`}
          control={<Select label="Timezone" value={timezone.choice} onChange={timezone.set} testId="timezone-select" align="end" mono width={220} options={timezoneOptions()} />}
        />
      </Card>
      <Card title="Behaviour">
        <Row label="Confirm destructive actions" hint="Delete, drain and scale-to-zero always ask. This cannot be turned off." control={<Switch checked disabled onChange={() => undefined} label="Confirm destructive actions" />} />
        <Divider />
        <Row label="Remember where I was" hint="Cluster, page, namespace, filter and the open object come back after a reload." control={<Switch checked disabled onChange={() => undefined} label="Remember navigation" />} />
        {settings ? null : <p className="mt-2 text-[11.5px] text-tertiary">Loading…</p>}
      </Card>
    </>
  );
}

function Ai({ settings, onSave }: { settings: AppSettings | null; onSave: (patch: unknown, said?: string) => Promise<void> }) {
  const ai = settings?.ai;
  const [apiKey, setApiKey] = useState('');
  const [instructions, setInstructions] = useState('');
  const [askInstructions, setAskInstructions] = useState(false);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    if (ai) setInstructions(ai.instructions);
  }, [ai]);
  if (!ai) return <Card title="AI assistant"><p className="text-[12.5px] text-tertiary">Loading…</p></Card>;
  const preset = AI_PRESETS.find((p) => p.id === ai.preset) ?? AI_PRESETS[0]!;

  const choosePreset = (id: string) => {
    const next = AI_PRESETS.find((p) => p.id === id);
    if (!next) return;
    void onSave({ ai: { preset: next.id, provider: next.provider, baseUrl: next.baseUrl, model: next.model } }, `Using ${next.label}`);
  };

  const test = async () => {
    setTesting(true);
    try {
      const response = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: null, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }) });
      if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message ?? response.statusText);
      const text = await response.text();
      const error = text.split('\n').find((l) => l.includes('"type":"error"'));
      if (error) throw new Error((JSON.parse(error.slice(6)) as { message: string }).message);
      toast.success('The model answered. The assistant is ready.');
    } catch (error) {
      toast.error(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Card title="Provider" subtitle="Anthropic natively, and anything that speaks the OpenAI chat API. The key stays on this machine.">
        <Row label="Provider" control={<Select label="Provider" value={preset.id} onChange={choosePreset} testId="ai-preset" align="end" width={220} options={AI_PRESETS.map((p) => ({ value: p.id, label: p.label }))} />} />
        <Divider />
        <Row
          label="API key"
          hint={ai.apiKey ? 'A key is stored. Paste a new one to replace it.' : preset.needsKey ? 'Required for this provider.' : 'Optional for this provider.'}
          control={
            <div className="flex items-center gap-1.5">
              <Field id="ai-key" label="API key" hideLabel type="password" mono placeholder={ai.apiKey ? '••••••••' : 'sk-…'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-[260px]" data-testid="ai-key" />
              <Button disabled={!apiKey} onClick={() => void onSave({ ai: { apiKey } }, 'Key saved').then(() => setApiKey(''))}>Save</Button>
            </div>
          }
        />
        <Divider />
        <Row label="Model" hint="Enter saves." control={<SaveField id="ai-model" label="Model" value={ai.model} testId="ai-model" validate={modelName} onSave={(next) => onSave({ ai: { model: next } })} />} />
        {ai.provider === 'openai' ? (
          <>
            <Divider />
            <Row label="Base URL" hint="The /v1 root; /chat/completions is added. Enter saves." control={<SaveField id="ai-base" label="Base URL" value={ai.baseUrl} validate={optionalUrl} onSave={(next) => onSave({ ai: { baseUrl: next } })} />} />
          </>
        ) : null}
        <Divider />
        <Row label="Test" hint="Sends one short message with your settings." control={<Button onClick={() => void test()} disabled={testing}>{testing ? 'Testing…' : 'Test connection'}</Button>} />
      </Card>
      <Card title="Permissions">
        <Row label="Allow writes" hint="Off: the assistant can only read and will give you the command instead. On: it can apply, scale, restart, delete and forward, and says so before it does." control={<Switch checked={ai.allowWrites} onChange={(next) => void onSave({ ai: { allowWrites: next } }, next ? 'The assistant may change clusters' : 'The assistant is read-only')} label="Allow writes" testId="ai-writes" />} />
      </Card>
      <Card title="Instructions" subtitle="Added to every conversation. Team conventions, what not to touch, how you like answers.">
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} onBlur={() => { if (instructions !== ai.instructions) setAskInstructions(true); }} rows={4} aria-label="Instructions" className="w-full resize-y rounded-md border border-line bg-sunken px-3 py-2 text-[12.5px] text-primary outline-none focus:border-focus" placeholder="e.g. Production is context prod-eu. Never scale anything in it without asking." />
        <div className="mt-2 flex justify-end gap-2">
          {askInstructions && instructions !== ai.instructions ? <AskSave what="instructions" onSave={() => void onSave({ ai: { instructions } }).then(() => setAskInstructions(false))} onDiscard={() => { setInstructions(ai.instructions); setAskInstructions(false); }} /> : null}
          <Button disabled={instructions === ai.instructions} onClick={() => void onSave({ ai: { instructions } }).then(() => setAskInstructions(false))}>Save</Button>
        </div>
      </Card>
    </>
  );
}

function Mcp({ settings, meta, onSave, onRefresh }: { settings: AppSettings | null; meta: { mcpCommand?: string } | null; onSave: (patch: unknown, said?: string) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [tools, setTools] = useState<Array<{ name: string; description: string; kind: 'read' | 'write' }>>([]);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    void api.ai.tools().then((r) => setTools(r.tools));
  }, []);
  if (!settings) return null;
  const mcp = settings.mcp;
  const command = meta?.mcpCommand ?? '';
  const config = JSON.stringify({ mcpServers: { mjolnir: { command: command.split(' ')[0], args: command.split(' ').slice(1) } } }, null, 2);
  return (
    <>
      <Card title="Over stdio" subtitle="For Claude Code, Cursor, Zed and any client that launches a command. Always available; nothing to turn on.">
        <div className="rounded-md border border-line bg-sunken p-3 font-mono text-[11.5px] text-secondary">
          <div className="mb-1 text-tertiary">Command</div>
          <code className="block break-words [overflow-wrap:anywhere] text-primary" title={command}>{command}</code>
        </div>
        <div className="mt-2 flex gap-1.5">
          <Button onClick={() => copyText(command, 'Command copied')} icon={<Copy size={12} strokeWidth={1.9} />}>Copy command</Button>
          <Button variant="ghost" onClick={() => copyText(config, 'Config copied')} icon={<Copy size={12} strokeWidth={1.9} />}>Copy mcpServers JSON</Button>
          <Button variant="ghost" onClick={() => copyText(`claude mcp add mjolnir -- ${command}`, 'Copied')}>Copy `claude mcp add`</Button>
        </div>
      </Card>
      <Card title="Over HTTP" subtitle="Streamable HTTP at /mcp on the local API, for agents on this machine. Needs the token.">
        <Row label="Serve MCP over HTTP" control={<Switch checked={mcp.http} onChange={(next) => void onSave({ mcp: { http: next } }).then(onRefresh)} label="Serve MCP over HTTP" testId="mcp-http" />} />
        {mcp.http ? (
          <>
            <Divider />
            <Row label="Endpoint" control={<code className="font-mono text-[12px] text-primary">{window.location.origin}/mcp</code>} />
            <Divider />
            <Row
              label="Token"
              hint="Sent as Authorization: Bearer. Shown once when made."
              control={
                <div className="flex items-center gap-1.5">
                  {token ? <code className="max-w-[240px] break-words [overflow-wrap:anywhere] font-mono text-[11.5px] text-primary">{token}</code> : <span className="text-[12px] text-tertiary">{mcp.token ? 'set' : 'none'}</span>}
                  <Button onClick={() => void api.settings.mcpToken().then((r) => { setToken(r.token); copyText(r.token, 'Token copied'); })}>{mcp.token ? 'Rotate' : 'Create'}</Button>
                </div>
              }
            />
          </>
        ) : null}
      </Card>
      <Card title="Permissions">
        <Row label="Allow writes" hint="External agents may apply, scale, restart, delete and forward. Off means read-only tools only." control={<Switch checked={mcp.allowWrites} onChange={(next) => void onSave({ mcp: { allowWrites: next } })} label="Allow writes for MCP" testId="mcp-writes" />} />
      </Card>
      <Card title={`Tools (${tools.length})`} subtitle="The same list the assistant uses.">
        <ul className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
          {tools.map((tool) => (
            <li key={tool.name} className="flex items-baseline gap-2 text-[12px]">
              <code className="shrink-0 font-mono text-primary">{tool.name}</code>
              <span className={`shrink-0 text-[9.5px] font-semibold uppercase tracking-wide ${tool.kind === 'write' ? 'text-warn' : 'text-tertiary'}`}>{tool.kind}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Licence() {
  const [status, setStatus] = useState<LicenceStatus | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => api.licence.get().then(setStatus).catch(() => setStatus({ kind: 'unconfigured', tier: 'free' }));
  useEffect(() => {
    void refresh();
  }, []);
  const keyProblem = key.trim() ? licenceKey(key) : null;
  const activate = async () => {
    if (keyProblem) return;
    setBusy(true);
    try {
      setStatus(await api.licence.activate(key.trim()));
      setKey('');
      toast.success('Licence activated. Everything is unlocked.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const pro = status?.tier === 'pro';
  return (
    <>
      <Card title="Plan">
        <div className="flex items-center gap-3">
          <span className={`rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${pro ? 'bg-accent-subtle text-accent' : 'border border-line bg-raised text-secondary'}`} data-testid="licence-tier">{pro ? 'Pro' : 'Free'}</span>
          <div className="text-[12.5px] text-secondary">
            {status?.kind === 'valid' || status?.kind === 'grace' ? (
              <>Licensed to <span className="font-mono text-primary">{status.email}</span>, {status.plan}{status.expiresAt ? `, until ${new Date(status.expiresAt).toLocaleDateString()}` : ''}.{status.kind === 'grace' ? ' Past its end date, inside the grace period.' : ''}</>
            ) : status?.kind === 'expired' ? (
              <>The licence for {status.email} has expired.</>
            ) : status?.kind === 'unconfigured' ? (
              <>This build has no licence public key, so keys cannot be checked yet. Free tier applies.</>
            ) : (
              <>Free tier. Every cluster feature works; Pro adds the toolbox workspaces, the assistant with writes, and team features.</>
            )}
          </div>
        </div>
        {pro ? (
          <div className="mt-3"><Button variant="ghost" onClick={() => void api.licence.deactivate().then(setStatus)}>Deactivate on this machine</Button></div>
        ) : null}
      </Card>
      <Card title="Activate" subtitle="Paste the key from your email or from mjolnir.sh/account.">
        <div className="flex items-start gap-1.5">
          <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={3} aria-label="Licence key" data-testid="licence-key" placeholder="eyJqdGkiOi…" className={`flex-1 resize-none rounded-md border bg-sunken px-3 py-2 font-mono text-[11.5px] text-primary outline-none focus:border-focus ${keyProblem ? 'border-[var(--status-error)]' : 'border-line'}`} />
          <Button variant="primary" disabled={!key.trim() || keyProblem !== null || busy} onClick={() => void activate()} data-testid="licence-activate">{busy ? 'Checking…' : 'Activate'}</Button>
        </div>
        {keyProblem ? <p className="mt-1.5 text-[11.5px] text-error">{keyProblem}</p> : null}
      </Card>
    </>
  );
}

function Shortcuts() {
  const rows: Array<[string, string]> = [
    ['⌘K', 'Search everything: kinds, tools, clusters, namespaces, objects'],
    ['Esc', 'Close the panel, menu or dialog on top'],
    ['↵ on a row', 'Open its details'],
    ['Right-click', 'Every named thing has a menu'],
    ['Double-click a divider', 'Reset that width'],
  ];
  return (
    <Card title="Keyboard">
      <dl className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-2 text-[12.5px]">
        {rows.map(([keys, what]) => (
          <div key={keys} className="contents">
            <dt><kbd className="rounded-xs border border-line bg-raised px-1.5 py-[1px] font-sans text-[11px] text-secondary">{keys}</kbd></dt>
            <dd className="m-0 text-secondary">{what}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function About({ path }: { path: string | undefined }) {
  return (
    <>
      <Card title="Mjolnir" subtitle="Kubernetes, containers, storage, cloud access and more, in one desktop app.">
        <div className="flex items-center gap-4">
          <MarkTile size={52} />
          <div>
            <div className="text-[16px] font-semibold text-primary">Mjolnir <span className="font-mono text-[13px] text-tertiary">0.1.0</span></div>
            <div className="text-[12.5px] text-secondary">mjolnir.sh · Elastic License 2.0</div>
          </div>
        </div>
      </Card>
      <Card title="Author">
        <div className="flex items-center gap-4">
          <span className="flex h-[44px] w-[44px] items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: 'linear-gradient(145deg, var(--series-3), color-mix(in oklab, var(--series-3) 100%, black 30%))', boxShadow: '0 1px 0 rgb(255 255 255 / 0.25) inset, 0 8px 20px color-mix(in oklab, var(--series-3) 40%, transparent)' }} aria-hidden>
            AJ
          </span>
          <div>
            <div className="text-[14px] font-semibold text-primary" data-testid="about-author">Aman Jain</div>
            <div className="text-[12.5px] text-secondary">
              <a href="mailto:jain.aman1497@gmail.com" className="text-accent hover:underline">jain.aman1497@gmail.com</a>
              <span className="text-tertiary"> · </span>
              <a href="https://github.com/jn-aman/mjolnir" target="_blank" rel="noreferrer" className="text-accent hover:underline">github.com/jn-aman/mjolnir</a>
            </div>
          </div>
        </div>
      </Card>
      <Card title="This build">
        <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2 text-[12.5px]">
          <dt className="text-tertiary">Version</dt><dd className="m-0 font-mono text-primary">0.1.0</dd>
          <dt className="text-tertiary">Local API</dt><dd className="m-0 font-mono text-primary">127.0.0.1 only</dd>
          <dt className="text-tertiary">Settings file</dt><dd className="m-0 font-mono text-primary break-words [overflow-wrap:anywhere]">{path ?? '…'}</dd>
          <dt className="text-tertiary">Licence</dt><dd className="m-0 text-primary">Elastic License 2.0</dd>
        </dl>
      </Card>
    </>
  );
}

/* --------------------------- kubernetes scope --------------------------- */

function Kubeconfig({ clusters, settings, onReload, onChanged }: { clusters: ClustersResponse | null; settings: AppSettings | null; onReload: () => Promise<void>; onChanged: () => Promise<void> }) {
  const failures = clusters?.failures ?? [];
  const extra = settings?.clusters.kubeconfigs ?? [];
  const files = [...new Set((clusters?.contexts ?? []).map((c) => c.source).filter((s) => s && s !== '(built in)'))];
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (body: { path?: string; name?: string; content?: string }) => {
    setBusy(true);
    try {
      await api.kubeconfigs.add(body);
      toast.success('Kubeconfig added');
      setPath('');
      setName('');
      setContent('');
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card title="Kubeconfig files" subtitle="KUBECONFIG, or ~/.kube/config when it is not set, plus any you add here. All are merged." actions={<Button onClick={() => void onReload()} icon={<RefreshCw size={13} strokeWidth={2} />}>Reload</Button>}>
        {failures.length > 0 ? (
          <div className="mb-3 rounded-md border border-[var(--status-warn)] bg-warn-bg p-3">
            <div className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-warn"><AlertTriangle size={14} strokeWidth={2} aria-hidden />{failures.length === 1 ? 'A kubeconfig could not be read' : `${failures.length} kubeconfigs could not be read`}</div>
            {failures.map((f) => <div key={f.path} className="font-mono text-[11.5px] text-secondary">{f.path}: {f.error}</div>)}
          </div>
        ) : null}
        <ul className="space-y-1" data-testid="kubeconfig-files">
          {[...new Set([...files, ...extra])].map((f) => (
            <li key={f} className="flex items-center gap-2 text-[12px]">
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] font-mono text-primary">{f}</span>
              <span className="text-[11px] text-tertiary">{extra.includes(f) ? 'added here' : 'from environment'}</span>
              {extra.includes(f) ? <Button variant="ghost" aria-label={`Remove ${f}`} onClick={() => void api.kubeconfigs.remove(f).then(onChanged)} icon={<Trash2 size={12} strokeWidth={1.9} />}>Remove</Button> : null}
            </li>
          ))}
          {files.length + extra.length === 0 ? <li className="text-[12.5px] text-tertiary">No kubeconfig files yet. Add one below.</li> : null}
        </ul>
      </Card>
      <Card title="Add a file" subtitle="A kubeconfig already on this machine.">
        <div className="flex items-end gap-2">
          <Field id="kubeconfig-path" label="Path" mono value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/.kube/prod-config" className="flex-1" data-testid="kubeconfig-path" validate={(v) => (v ? filePath(v) : null)} onKeyDown={(e) => { if (e.key === 'Enter' && path.trim()) void add({ path: path.trim() }); }} />
          <Button variant="primary" disabled={!path.trim() || filePath(path) !== null || busy} onClick={() => void add({ path: path.trim() })} data-testid="kubeconfig-add-path">Add</Button>
        </div>
      </Card>
      <Card title="Paste a kubeconfig" subtitle="Saved under ~/.mjolnir/kubeconfigs with owner-only permissions.">
        <div className="space-y-2">
          <Field id="kubeconfig-name" label="Name" mono value={name} onChange={(e) => setName(e.target.value)} placeholder="staging" className="w-[260px]" data-testid="kubeconfig-name" validate={(v) => (v && !/^[A-Za-z0-9_.-]+$/.test(v) ? 'Letters, digits, dashes, dots and underscores.' : null)} />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} aria-label="Kubeconfig content" data-testid="kubeconfig-content" placeholder={'apiVersion: v1\nkind: Config\nclusters:\n  - name: …'} className="w-full resize-y rounded-md border border-line bg-sunken px-3 py-2 font-mono text-[11.5px] text-primary outline-none focus:border-focus" />
          <div className="flex justify-end"><Button variant="primary" disabled={!name.trim() || !/^[A-Za-z0-9_.-]+$/.test(name.trim()) || !/apiVersion|contexts:/.test(content) || busy} onClick={() => void add({ name: name.trim(), content })} data-testid="kubeconfig-add-paste">Save and load</Button></div>
        </div>
      </Card>
    </>
  );
}

function Clusters({ clusters, settings, onChanged }: { clusters: ClustersResponse | null; settings: AppSettings | null; onChanged: () => Promise<void> }) {
  const [removing, setRemoving] = useState<{ name: string; scope: 'hide' | 'kubeconfig' } | null>(null);
  const [busy, setBusy] = useState(false);
  const hidden = clusters?.hidden ?? [];
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      const result = (await api.removeCluster(removing.name, removing.scope)) as { backup?: string };
      toast.success(removing.scope === 'kubeconfig' ? `Removed ${removing.name} from its kubeconfig. Backup: ${result.backup ?? ''}` : `${removing.name} hidden`);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };
  return (
    <>
      <Card title="Clusters" subtitle="Every context Mjolnir knows, with the namespaces chosen for it in the toolbar picker. Hide one to keep it out of the strip; remove one to take it out of its kubeconfig file.">
        <ul className="divide-y divide-[var(--border-subtle)]">
          {(clusters?.contexts ?? []).map((c) => {
            const per = settings?.clusters.perContext[c.name] ?? {};
            return (
              <li key={c.name} className="flex items-center gap-3 py-2" data-testid={`settings-cluster-${c.name}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[12.5px] text-primary">{c.name}</div>
                  <div className="break-words [overflow-wrap:anywhere] text-[11px] text-tertiary">{c.server ?? ''}{c.source && c.source !== '(built in)' ? ` · ${c.source}` : ' · built in'}</div>
                </div>
                <span className="max-w-[260px] break-words [overflow-wrap:anywhere] font-mono text-[11.5px] text-tertiary" title={(per.namespaces ?? []).join(', ')}>{per.namespaces?.length ? per.namespaces.join(', ') : 'all namespaces'}</span>
                {c.name !== 'demo' ? (
                  <>
                    <Button variant="ghost" aria-label={`Hide ${c.name}`} onClick={() => setRemoving({ name: c.name, scope: 'hide' })} icon={<EyeOff size={12} strokeWidth={1.9} />}>Hide</Button>
                    <Button variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => setRemoving({ name: c.name, scope: 'kubeconfig' })} icon={<Trash2 size={12} strokeWidth={1.9} />}>Remove…</Button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
      {hidden.length ? (
        <Card title="Hidden">
          <ul className="space-y-1">
            {hidden.map((name) => (
              <li key={name} className="flex items-center gap-3 text-[12.5px]"><span className="font-mono text-secondary">{name}</span><Button variant="ghost" onClick={() => void api.unhideCluster(name).then(onChanged)}>Show again</Button></li>
            ))}
          </ul>
        </Card>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        title={removing?.scope === 'kubeconfig' ? `Remove ${removing.name} from its kubeconfig?` : `Hide ${removing?.name ?? ''}?`}
        body={removing?.scope === 'kubeconfig' ? 'The context, and its cluster and user entries if nothing else uses them, are deleted from the file. A backup is written beside it first.' : 'It leaves the rail and the palette. Show it again from this page any time.'}
        confirmLabel={removing?.scope === 'kubeconfig' ? 'Remove from file' : 'Hide'}
        danger={removing?.scope === 'kubeconfig'}
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setRemoving(null)}
        testId="remove-cluster-dialog"
      />
    </>
  );
}

function Namespaces({ settings, onSave }: { settings: AppSettings | null; onSave: (patch: unknown, said?: string) => Promise<void> }) {
  if (!settings) return null;
  return (
    <Card title="Namespaces">
      <Row label="Show system namespaces" hint="kube-system and friends, in lists and the namespace picker." control={<Switch checked={settings.general.showSystemNamespaces} onChange={(next) => void onSave({ general: { showSystemNamespaces: next } })} label="Show system namespaces" />} />
      <Divider />
      <Row label="Default namespace" hint="Applied when a cluster does not name one. Enter saves." control={<SaveField id="default-namespace" label="Default namespace" placeholder="default" value={settings.general.defaultNamespace} validate={(v) => (v ? namespaceName(v) : null)} onSave={(next) => onSave({ general: { defaultNamespace: next } })} />} />
    </Card>
  );
}

/**
 * A settings field with the one rule: Enter saves, leaving it unchanged does
 * nothing, leaving it changed asks.
 */
function SaveField({ id, label, value, onSave, mono = true, placeholder, className = 'w-[260px]', type, testId, validate }: { id: string; label: string; value: string; onSave: (next: string) => Promise<void>; mono?: boolean; placeholder?: string; className?: string; type?: string; testId?: string; validate?: ((v: string) => string | null) | undefined }) {
  const [draft, setDraft] = useState(value);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    setDraft(value);
    setAsking(false);
  }, [value]);
  const changed = draft !== value;
  const problem = changed && validate ? validate(draft) : null;
  const save = () => {
    if (problem) return;
    void onSave(draft).then(() => setAsking(false));
  };
  return (
    <span className="relative inline-flex">
      <Field
        id={id}
        label={label}
        hideLabel
        mono={mono}
        {...(type ? { type } : {})}
        {...(placeholder ? { placeholder } : {})}
        {...(testId ? { 'data-testid': testId } : {})}
        validate={validate}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (changed) setAsking(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && changed) save();
          if (e.key === 'Escape') { setDraft(value); setAsking(false); }
        }}
        className={className}
      />
      {asking && changed && !problem ? (
        <span className="absolute right-0 top-full z-20 mt-1.5"><AskSave what={label.toLowerCase()} onSave={save} onDiscard={() => { setDraft(value); setAsking(false); }} /></span>
      ) : null}
    </span>
  );
}

/* ------------------------------ primitives ------------------------------ */

function Row({ label, hint, control }: { label: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center gap-6 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-primary">{label}</div>
        {hint ? <div className="mt-0.5 text-[11.5px] leading-[16px] text-tertiary">{hint}</div> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-[var(--border-subtle)]" />;
}
