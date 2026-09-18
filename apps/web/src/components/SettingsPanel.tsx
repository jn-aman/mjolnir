import * as Switch from '@radix-ui/react-switch';
import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react';
import type { ClustersResponse } from '../lib/api.ts';
import type { ThemeChoice } from '../lib/theme.ts';
import { Card } from './ui/Card.tsx';
import { Button } from './ui/Button.tsx';
import { Select } from './ui/Select.tsx';
import { Field } from './ui/Field.tsx';

/**
 * Settings.
 *
 * Kubeconfig comes first because it is the only setting that can leave someone
 * unable to use the app at all. If a file in `KUBECONFIG` is unreadable, that
 * is stated here with the path and the reason rather than swallowed — a tool
 * that silently shows fewer clusters than you have is worse than one that
 * refuses to start.
 */

interface SettingsPanelProps {
  readonly clusters: ClustersResponse | null;
  readonly theme: ThemeChoice;
  readonly onTheme: (choice: ThemeChoice) => void;
  readonly onReload: () => Promise<void>;
}

export function SettingsPanel({ clusters, theme, onTheme, onReload }: SettingsPanelProps) {
  const failures = clusters?.failures ?? [];

  return (
    <div data-testid="settings" className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-[760px] space-y-3">
        <Card
          title="Kubeconfig"
          subtitle="Read from KUBECONFIG, or ~/.kube/config when it is not set"
          actions={
            <Button onClick={() => void onReload()} icon={<RefreshCw size={13} strokeWidth={2} />}>
              Reload
            </Button>
          }
        >
          {failures.length > 0 ? (
            <div className="mb-3 rounded-md border border-[var(--status-warn)] bg-warn-bg p-3">
              <div className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-warn">
                <AlertTriangle size={14} strokeWidth={2} aria-hidden />
                {failures.length === 1 ? 'A kubeconfig could not be read' : `${failures.length} kubeconfigs could not be read`}
              </div>
              {failures.map((failure) => (
                <div key={failure.path} className="font-mono text-[11.5px] text-secondary">
                  {failure.path} — {failure.error}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mb-3">
            <Field
              id="kubeconfig-path"
              label="Add a kubeconfig file"
              placeholder="/path/to/kubeconfig"
              mono
              trailing={
                <Button
                  iconOnly
                  variant="ghost"
                  aria-label="Browse"
                  icon={<FolderOpen size={13} strokeWidth={1.9} />}
                />
              }
            />
            <p className="mt-1.5 text-[11.5px] text-tertiary">
              Merged with the files already loaded, the way kubectl merges KUBECONFIG. Nothing is
              written to your existing files.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-tertiary">
              Loaded contexts ({clusters?.contexts.length ?? 0})
            </h3>
            <ul className="space-y-1">
              {clusters?.contexts.map((entry) => (
                <li
                  key={entry.name}
                  className="flex items-center gap-2 rounded-md border border-line bg-raised px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-primary">
                    {entry.name}
                  </span>
                  <span className="shrink-0 truncate font-mono text-[11px] text-tertiary">
                    {entry.server ?? '—'}
                  </span>
                  {entry.provider !== 'other' ? (
                    <span className="shrink-0 rounded-xs bg-accent-subtle px-1.5 py-[1px] text-[10px] font-semibold uppercase text-accent">
                      {entry.provider}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card title="Appearance">
          <Row
            label="Theme"
            hint="System follows your operating system setting."
            control={
              <Select
                label="Theme"
                value={theme}
                onChange={(value) => onTheme(value as ThemeChoice)}
                testId="theme-select"
                align="end"
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
              />
            }
          />
        </Card>

        <Card title="Defaults">
          <Row
            label="Default namespace"
            hint="Applied when a cluster does not name one."
            control={
              <Field id="default-namespace" label="Default namespace" hideLabel placeholder="default" mono />
            }
          />
          <Divider />
          <Row
            label="Confirm destructive actions"
            hint="Delete, scale and rollout restart always ask twice. This cannot be turned off."
            control={<Switch.Root checked disabled className="opacity-45"><Toggle /></Switch.Root>}
          />
          <Divider />
          <Row
            label="Show system namespaces"
            hint="kube-system and friends, in lists and the namespace picker."
            control={
              <Switch.Root
                defaultChecked
                className="relative h-[20px] w-[34px] rounded-full bg-[var(--border-strong)] outline-none data-[state=checked]:bg-[var(--accent-solid)]"
                style={{ transitionProperty: 'background-color', transitionDuration: '160ms' }}
              >
                <Toggle />
              </Switch.Root>
            }
          />
        </Card>

        <Card title="About">
          <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2 text-[12.5px]">
            <dt className="text-tertiary">Version</dt>
            <dd className="m-0 font-mono text-primary">0.1.0</dd>
            <dt className="text-tertiary">Licence</dt>
            <dd className="m-0 text-primary">Free tier</dd>
            <dt className="text-tertiary">Local API</dt>
            <dd className="m-0 font-mono text-primary">127.0.0.1 only</dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Toggle() {
  return (
    <Switch.Thumb
      className="block h-[16px] w-[16px] translate-x-[2px] rounded-full bg-white data-[state=checked]:translate-x-[16px]"
      style={{ transitionProperty: 'transform', transitionDuration: '160ms', transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
    />
  );
}

function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-1">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-primary">{label}</div>
        <div className="text-[11.5px] text-tertiary">{hint}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Divider() {
  return <div className="my-2 h-px bg-[var(--border-subtle)]" />;
}
