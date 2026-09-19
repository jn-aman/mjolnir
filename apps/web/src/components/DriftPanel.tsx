import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, GitCompare, RefreshCw } from 'lucide-react';
import { api, type DriftChange, type DriftResult } from '../lib/api.ts';
import { Button } from './ui/Button.tsx';
import { EmptyState, LoadingState } from './ui/States.tsx';
import { copyText } from './ui/ContextMenu.tsx';

/**
 * What this object is running against what somebody said it should run.
 *
 * The page exists to answer one question, so it answers it in the first line:
 * either the cluster matches, or here is the field that does not. Everything
 * else is underneath.
 *
 * The thing worth saying loudly is the distinction between "no differences"
 * and "nothing to compare against". They look identical as an empty list and
 * mean opposite things, and conflating them is how a drift page quietly
 * reassures somebody about an object it never checked.
 */

interface DriftPanelProps {
  readonly context: string;
  readonly kind: string;
  readonly name: string;
  readonly namespace?: string | undefined;
}

export function DriftPanel({ context, kind, name, namespace }: DriftPanelProps) {
  const [result, setResult] = useState<DriftResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setResult(await api.drift.check(context, kind, name, namespace));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [context, kind, name, namespace]);

  useEffect(() => {
    setResult(null);
    void load();
  }, [load]);

  if (error) {
    return (
      <EmptyState
        tone="error"
        title="Could not compare this"
        detail={error}
        testId="drift-error"
        action={<Button variant="secondary" onClick={() => void load()} icon={<RefreshCw size={13} strokeWidth={1.9} />}>Try again</Button>}
      />
    );
  }
  if (!result) return <LoadingState title="Finding what this was supposed to look like" rows={3} />;

  if (!result.available) {
    return (
      <div className="p-4" data-testid="drift-unavailable">
        <div className="rounded-xl border border-line bg-raised p-4">
          <p className="text-[13.5px] font-semibold tracking-[-0.005em] text-primary">Nothing to compare against</p>
          <p className="mt-1.5 text-[12.5px] leading-[1.65] text-secondary">{result.reason}</p>
        </div>
      </div>
    );
  }

  const worth = result.changes.filter((change) => !change.expected);
  const expected = result.changes.filter((change) => change.expected);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="drift-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
        <GitCompare size={13} strokeWidth={1.9} aria-hidden className="text-tertiary" />
        <span className="text-[12px] text-tertiary">against {result.against}</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          onClick={() => {
            setBusy(true);
            void load().finally(() => setBusy(false));
          }}
          disabled={busy}
          icon={<RefreshCw size={12} strokeWidth={1.9} />}
        >
          Check again
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
          className="rounded-xl border p-4"
          style={{
            borderColor: result.inSync
              ? 'color-mix(in oklab, var(--status-ok) 30%, transparent)'
              : worth.length > 0
                ? 'color-mix(in oklab, var(--status-warn) 35%, transparent)'
                : 'var(--border-line)',
            background: result.inSync ? 'var(--status-ok-bg)' : worth.length > 0 ? 'var(--status-warn-bg)' : 'var(--surface-raised)',
          }}
          data-testid="drift-summary"
        >
          <p className="flex items-start gap-2 text-[13.5px] font-semibold leading-[1.45] tracking-[-0.005em] text-primary">
            {result.inSync ? (
              <CheckCircle2 size={15} strokeWidth={2} aria-hidden className="mt-[1px] shrink-0 text-ok" />
            ) : null}
            {result.summary}
          </p>
          {!result.inSync ? (
            <p className="mt-1.5 text-[12px] leading-[1.6] text-secondary">
              {/* The consequence, which is the part people miss: drift against
                  a chart is temporary whether or not anyone meant it to be. */}
              {result.source === 'helm'
                ? 'The next helm upgrade reasserts the chart, so anything changed here goes back.'
                : 'The next kubectl apply reasserts what was applied, so anything changed here goes back.'}
            </p>
          ) : null}
        </motion.div>

        {worth.length > 0 ? (
          <ul className="mt-3 space-y-1.5" data-testid="drift-changes">
            {worth.map((change) => (
              <ChangeRow key={change.path} change={change} />
            ))}
          </ul>
        ) : null}

        {expected.length > 0 ? (
          <div className="mt-4">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">
              Also different, and meant to be
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {expected.map((change) => (
                <ChangeRow key={change.path} change={change} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChangeRow({ change }: { change: DriftChange }) {
  return (
    <li className="rounded-lg border border-line bg-raised px-3 py-2.5" data-testid={`drift-${change.kind}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <code className="break-all font-mono text-[12px] text-primary">{change.path}</code>
        <span
          className="rounded-xs px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide"
          style={
            change.kind === 'removed'
              ? { color: 'var(--status-error)', background: 'color-mix(in oklab, var(--status-error) 12%, transparent)' }
              : { color: 'var(--text-tertiary)', background: 'var(--surface-sunken)' }
          }
        >
          {change.kind === 'removed' ? 'deleted live' : change.kind === 'type-changed' ? 'type changed' : 'changed'}
        </span>
      </div>

      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <Value label="Declared" value={change.desired} tint="var(--text-tertiary)" />
        <Value label="Running" value={change.live} tint={change.kind === 'removed' ? 'var(--status-error)' : 'var(--status-warn)'} />
      </div>

      {change.note ? <p className="mt-2 text-[12px] leading-[1.6] text-secondary">{change.note}</p> : null}
    </li>
  );
}

function Value({ label, value, tint }: { label: string; value: unknown; tint: string }) {
  const text = value === undefined ? 'not there' : typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value);
  const long = text.length > 80 || text.includes('\n');
  return (
    <div className="min-w-0 rounded-md border border-subtle bg-sunken px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: tint }} />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">{label}</span>
        {long ? (
          <button
            type="button"
            onClick={() => copyText(text, `${label} value copied`)}
            className="ml-auto text-[10.5px] text-tertiary underline-offset-2 hover:text-secondary hover:underline"
          >
            copy
          </button>
        ) : null}
      </div>
      <pre className="mt-0.5 max-h-[160px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.5] text-secondary [overflow-wrap:anywhere]">
        {text}
      </pre>
    </div>
  );
}
