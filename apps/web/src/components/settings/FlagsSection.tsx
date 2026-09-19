import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Flag, RefreshCw, Rss } from 'lucide-react';
import { toast } from 'sonner';
import { api, type AppSettings, type FlagState, type RemoteFlagStatus } from '../../lib/api.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import { Select } from '../ui/Select.tsx';
import { Switch } from '../ui/Switch.tsx';
import { Menu, copyEntry } from '../ui/ContextMenu.tsx';
import { mjolnirUrl } from '../../lib/validate.ts';

/**
 * Feature flags, with the precedence visible.
 *
 * Every row says where its current value came from, because "I turned that on
 * and it is off" is the only interesting bug a flag system has. A flag with a
 * local override shows what the build and the server would have said, so
 * handing control back is a decision with the alternative in front of you
 * rather than a leap.
 */

const STAGE_TINT: Record<FlagState['stage'], string> = {
  stable: 'var(--status-ok)',
  beta: 'var(--series-1)',
  experimental: 'var(--status-warn)',
  internal: 'var(--text-tertiary)',
};

const SOURCE_TEXT: Record<FlagState['source'], string> = {
  override: 'you set this',
  remote: 'from the flag server',
  default: 'this build',
};

export function FlagsSection({ settings, onSave }: { settings: AppSettings | null; onSave: (patch: unknown, said?: string) => Promise<void> }) {
  const [flags, setFlags] = useState<FlagState[]>([]);
  const [remote, setRemote] = useState<RemoteFlagStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(settings?.flags.remote.url ?? '');
  const [token, setToken] = useState('');
  const [environment, setEnvironment] = useState(settings?.flags.remote.environment ?? 'production');

  const load = useCallback(async () => {
    const response = await api.flags.list();
    setFlags(response.flags);
    setRemote(response.remote);
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!settings) return;
    setUrl(settings.flags.remote.url);
    setEnvironment(settings.flags.remote.environment);
  }, [settings]);

  const set = async (id: string, value: boolean | null): Promise<void> => {
    const response = await api.flags.set(id, value);
    setFlags(response.flags);
  };

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await api.flags.refresh();
      setFlags(response.flags);
      setRemote(response.remote);
      toast.success(response.remote.error ? 'Refresh failed' : `Read ${response.remote.count} toggles`);
    } finally {
      setBusy(false);
    }
  };

  const test = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.flags.test({ url, token: token || 'set', environment });
      if (result.ok) {
        toast.success(`Connected. ${result.matched?.length ?? 0} of ${result.count ?? 0} toggles match a flag Mjolnir knows.`);
      } else {
        toast.error(result.error ?? 'Could not connect');
      }
    } finally {
      setBusy(false);
    }
  };

  const grouped = new Map<string, FlagState[]>();
  for (const flag of flags) {
    const list = grouped.get(flag.module) ?? [];
    list.push(flag);
    grouped.set(flag.module, list);
  }

  const overrides = flags.filter((flag) => flag.source === 'override').length;
  const config = settings?.flags.remote;

  return (
    <>
      <Card
        title="How a value is decided"
        subtitle="A switch you move wins. Failing that, the flag server. Failing that, what this build was compiled with. So Mjolnir has an answer before the network does, and offline it behaves exactly as it does online."
      >
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <Badge tint="var(--accent-base)" label={`${flags.length} flags`} />
          <Badge tint={overrides ? 'var(--series-1)' : 'var(--text-tertiary)'} label={`${overrides} overridden`} />
          <Badge
            tint={remote?.state === 'ok' ? 'var(--status-ok)' : remote?.state === 'failed' ? 'var(--status-error)' : 'var(--text-tertiary)'}
            label={
              remote?.state === 'ok'
                ? `flag server: ${remote.count} toggles`
                : remote?.state === 'failed'
                  ? 'flag server: not answering'
                  : remote?.state === 'never-fetched'
                    ? 'flag server: not read yet'
                    : 'flag server: off'
            }
          />
          {overrides > 0 ? (
            <Button
              variant="ghost"
              onClick={() => void onSave({ flags: { overrides: {} } }, 'Overrides cleared').then(load)}
            >
              Clear every override
            </Button>
          ) : null}
        </div>
        {remote?.error ? (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-[var(--status-error)] bg-[color-mix(in_oklab,var(--status-error)_8%,transparent)] px-2.5 py-2">
            <AlertTriangle size={13} strokeWidth={2} className="mt-[2px] shrink-0 text-[var(--status-error)]" aria-hidden />
            <span className="break-words text-[12px] text-secondary [overflow-wrap:anywhere]">{remote.error}</span>
          </div>
        ) : null}
      </Card>

      {[...grouped.entries()].map(([module, entries]) => (
        <Card key={module} title={moduleLabel(module)}>
          <div className="flex flex-col">
            {entries.map((flag) => (
              <Menu
                key={flag.id}
                label={flag.label}
                testId="flag-menu"
                entries={[
                  { id: 'on', label: 'Force on', onSelect: () => void set(flag.id, true) },
                  { id: 'off', label: 'Force off', onSelect: () => void set(flag.id, false) },
                  { id: 'clear', label: 'Use the default', disabled: flag.source !== 'override', onSelect: () => void set(flag.id, null) },
                  ...copyEntry('copy-id', 'Copy the flag id', flag.id),
                ]}
              >
                <div data-testid={`flag-${flag.id}`} className="row-hover flex items-start gap-4 rounded-md px-1 py-2.5">
                  <span className="icon-chip !h-[26px] !w-[26px] shrink-0" style={{ ['--chip-tint' as string]: STAGE_TINT[flag.stage] }} aria-hidden>
                    <Flag size={12} strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="break-words text-[13px] font-medium text-primary [overflow-wrap:anywhere]">{flag.label}</span>
                      <span
                        className="rounded-full px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-[0.05em]"
                        style={{ color: STAGE_TINT[flag.stage], background: `color-mix(in oklab, ${STAGE_TINT[flag.stage]} 14%, transparent)` }}
                      >
                        {flag.stage}
                      </span>
                    </div>
                    <div className="mt-0.5 break-words text-[11.5px] leading-[1.5] text-tertiary [overflow-wrap:anywhere]">{flag.description}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
                      <span>{SOURCE_TEXT[flag.source]}</span>
                      {flag.source === 'override' ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>
                            without it: {(flag.remote ?? flag.fallback) ? 'on' : 'off'} ({flag.remote === undefined ? 'this build' : 'the flag server'})
                          </span>
                          <button type="button" className="text-accent hover:underline" onClick={() => void set(flag.id, null)}>
                            hand it back
                          </button>
                        </>
                      ) : null}
                      {/*
                        Unleash draws a toggle as on whenever the environment
                        is enabled, whatever its strategies then do, so a flag
                        at 0% rollout reads as on there and is off here. Saying
                        which, in the app, is the difference between "the flags
                        are broken" and "that one is not rolled out yet".
                      */}
                      {flag.remoteReason ? (
                        <>
                          <span aria-hidden>·</span>
                          <span data-testid={`flag-reason-${flag.id}`}>{flag.remoteReason}</span>
                        </>
                      ) : null}
                    </div>
                    {flag.warning && flag.value ? (
                      <div className="mt-1 flex items-start gap-1.5 text-[11.5px] text-[var(--status-warn)]">
                        <AlertTriangle size={12} strokeWidth={2} className="mt-[2px] shrink-0" aria-hidden />
                        <span className="break-words [overflow-wrap:anywhere]">{flag.warning}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 pt-1">
                    <Switch checked={flag.value} onChange={(next) => void set(flag.id, next)} label={flag.label} testId={`flag-switch-${flag.id}`} />
                  </div>
                </div>
              </Menu>
            ))}
          </div>
        </Card>
      ))}

      <Card
        title="Flag server"
        subtitle="Unleash, reached through unleash.mjolnir.sh. Mjolnir reads toggles and never writes them, and a toggle whose name is not a flag in this build is ignored rather than acted on."
      >
        <div className="flex items-center gap-6 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-primary">Read flags from a server</div>
            <div className="mt-0.5 text-[11.5px] leading-[16px] text-tertiary">Off means this build's own defaults, plus anything you set here.</div>
          </div>
          <Switch
            checked={config?.enabled ?? false}
            onChange={(next) => void onSave({ flags: { remote: { enabled: next } } }, next ? 'Flag server on' : 'Flag server off').then(load)}
            label="Read flags from a server"
            testId="flags-remote"
          />
        </div>
        {config?.enabled ? (
          <>
            <div className="my-1 h-px bg-[var(--border-subtle)]" />
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field
                id="flag-url"
                label="Server"
                value={url}
                mono
                onChange={(event) => setUrl(event.target.value)}
                validate={mjolnirUrl}
                placeholder="https://unleash.mjolnir.sh"
              />
              <Field
                id="flag-token"
                label="Client token"
                type="password"
                value={token}
                mono
                placeholder={settings?.flags.remote.token ? 'set' : 'paste a client token'}
                onChange={(event) => setToken(event.target.value)}
              />
              {/*
                Not editable. One build ships to everyone, so a second flag
                environment is only a second place for a toggle's state to
                live and a second place to forget to change it.
              */}
              <Field id="flag-env" label="Environment" value="production" readOnly disabled />
              <div>
                <label htmlFor="flag-interval" className="mb-1 block text-[11.5px] font-medium text-secondary">
                  Refresh every
                </label>
                <Select
                  value={String(config.refreshSeconds)}
                  onChange={(next) => void onSave({ flags: { remote: { refreshSeconds: Number(next) } } }, 'Interval saved')}
                  options={[
                    { value: '60', label: 'minute' },
                    { value: '300', label: '5 minutes' },
                    { value: '900', label: '15 minutes' },
                    { value: '3600', label: 'hour' },
                    { value: '21600', label: '6 hours' },
                  ]}
                  label="Refresh interval"
                  width={160}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button variant="primary" disabled={busy} onClick={() => void onSave({ flags: { remote: { url, environment, ...(token ? { token } : {}) } } }, 'Flag server saved').then(() => { setToken(''); return load(); })}>
                Save
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void test()} icon={<Rss size={12} strokeWidth={2} />}>
                Test connection
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void refresh()} icon={<motion.span animate={busy ? { rotate: 360 } : { rotate: 0 }} transition={{ repeat: busy ? Infinity : 0, duration: 0.9, ease: 'linear' }} className="flex"><RefreshCw size={12} strokeWidth={2} /></motion.span>}>
                Refresh now
              </Button>
            </div>
            {remote?.fetchedAt ? <div className="mt-2 text-[11.5px] text-tertiary">Last read {new Date(remote.fetchedAt).toLocaleString()}.</div> : null}
          </>
        ) : null}
      </Card>
    </>
  );
}

function Badge({ label, tint }: { label: string; tint: string }) {
  return (
    <span className="rounded-full border px-2 py-[2px] text-[11px]" style={{ color: tint, borderColor: `color-mix(in oklab, ${tint} 35%, transparent)`, background: `color-mix(in oklab, ${tint} 10%, transparent)` }}>
      {label}
    </span>
  );
}

function moduleLabel(id: string): string {
  const labels: Record<string, string> = {
    mjolnir: 'Mjolnir',
    assistant: 'AI assistant',
    kubernetes: 'Kubernetes',
    docker: 'Containers',
    storage: 'Bucket store',
    machines: 'Machines',
    alerts: 'Alerts',
  };
  return labels[id] ?? id;
}
