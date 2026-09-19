import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, type UpdateView } from '../../lib/api.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Select } from '../ui/Select.tsx';
import { Switch } from '../ui/Switch.tsx';

/**
 * Updates, from updates.mjolnir.sh.
 *
 * An out-of-date Kubernetes client is a real hazard, so the default is to
 * download in the background and install on quit. It stays a default: turning
 * it off means Mjolnir tells you and waits, and the beta channel is a
 * deliberate choice rather than a thing you end up on.
 */

const STATUS_TEXT: Record<UpdateView['state']['status'], string> = {
  idle: 'Not checked yet',
  checking: 'Checking',
  available: 'An update is available',
  downloading: 'Downloading',
  ready: 'Ready to install',
  current: 'Up to date',
  error: 'The last check failed',
  unsupported: 'This build does not update itself',
};

export function UpdatesSection() {
  const [view, setView] = useState<UpdateView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setView(await api.updates.get());
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
    const timer = setInterval(() => void load().catch(() => undefined), 4000);
    return () => clearInterval(timer);
  }, [load]);

  const preferences = view?.preferences;
  const state = view?.state;
  const save = async (patch: Partial<NonNullable<typeof preferences>>): Promise<void> => {
    await api.updates.preferences(patch);
    await load();
  };

  return (
    <>
      <Card
        title={`Mjolnir ${view?.version ?? ''}`}
        subtitle={`Updates come from ${view?.feed ?? 'updates.mjolnir.sh'}, which is our own domain, so a network that allows only *.mjolnir.sh can still update the app.`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="update-status"
            className="rounded-full border px-2.5 py-[3px] text-[12px]"
            style={{
              color: state?.status === 'ready' || state?.status === 'available' ? 'var(--status-ok)' : state?.status === 'error' ? 'var(--status-error)' : 'var(--text-secondary)',
              borderColor: 'var(--border-default)',
              background: 'var(--surface-sunken)',
            }}
          >
            {STATUS_TEXT[state?.status ?? 'idle']}
            {state?.version ? ` · ${state.version}` : ''}
            {state?.status === 'downloading' && state.percent !== undefined ? ` · ${state.percent}%` : ''}
          </span>
          {state?.checkedAt ? <span className="text-[11.5px] text-tertiary">checked {new Date(state.checkedAt).toLocaleString()}</span> : null}
        </div>
        {state?.error ? <div className="mt-2 break-words text-[12px] text-[var(--status-warn)] [overflow-wrap:anywhere]">{state.error}</div> : null}
        {state?.status === 'unsupported' ? (
          <p className="mt-2 max-w-[70ch] text-[12.5px] leading-[1.55] text-secondary">
            You are running from a source checkout, or from a build without the updater. Pull and rebuild, or download the current version from mjolnir.sh.
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            disabled={busy}
            data-testid="update-check"
            onClick={() => {
              setBusy(true);
              void api.updates
                .check()
                .then((response) => {
                  if (response.message) toast.message(response.message);
                  return load();
                })
                .finally(() => setBusy(false));
            }}
            icon={
              <motion.span animate={busy ? { rotate: 360 } : { rotate: 0 }} transition={{ repeat: busy ? Infinity : 0, duration: 0.9, ease: 'linear' }} className="flex">
                <RefreshCw size={12} strokeWidth={2} />
              </motion.span>
            }
          >
            Check now
          </Button>
          {state?.status === 'ready' ? (
            <Button variant="primary" onClick={() => void api.updates.install()} icon={<Download size={12} strokeWidth={2} />}>
              Restart and install {state.version}
            </Button>
          ) : null}
        </div>
      </Card>

      <Card title="How updates behave">
        <div className="flex items-center gap-6 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-primary">Check on launch</div>
            <div className="mt-0.5 text-[11.5px] leading-[16px] text-tertiary">And every six hours while the app is open.</div>
          </div>
          <Switch checked={preferences?.checkOnLaunch ?? true} onChange={(next) => void save({ checkOnLaunch: next })} label="Check on launch" testId="update-check-launch" />
        </div>
        <div className="my-1 h-px bg-[var(--border-subtle)]" />
        <div className="flex items-center gap-6 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-primary">Install automatically</div>
            <div className="mt-0.5 text-[11.5px] leading-[16px] text-tertiary">
              Download in the background and install when you quit. Off means Mjolnir tells you and waits for you to say yes.
            </div>
          </div>
          <Switch checked={preferences?.automatic ?? true} onChange={(next) => void save({ automatic: next })} label="Install automatically" testId="update-automatic" />
        </div>
        <div className="my-1 h-px bg-[var(--border-subtle)]" />
        <div className="flex items-center gap-6 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-primary">Channel</div>
            <div className="mt-0.5 text-[11.5px] leading-[16px] text-tertiary">Beta gets releases earlier, with the bugs that implies.</div>
          </div>
          <Select
            value={preferences?.channel ?? 'stable'}
            onChange={(next) => void save({ channel: next as 'stable' | 'beta' })}
            options={[
              { value: 'stable', label: 'Stable' },
              { value: 'beta', label: 'Beta' },
            ]}
            label="Update channel"
            width={150}
            testId="update-channel"
          />
        </div>
        {preferences?.skipped ? (
          <>
            <div className="my-1 h-px bg-[var(--border-subtle)]" />
            <div className="flex items-center gap-6 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-primary">Skipped {preferences.skipped}</div>
                <div className="mt-0.5 text-[11.5px] leading-[16px] text-tertiary">You will not be told about this version again.</div>
              </div>
              <Button variant="ghost" onClick={() => void save({ skipped: '' })}>Stop skipping</Button>
            </div>
          </>
        ) : null}
      </Card>
    </>
  );
}
