import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, History as HistoryIcon, RefreshCw } from 'lucide-react';
import { api, type HistoryEntry, type HistoryResult } from '../lib/api.ts';
import { formatDateTime, relativeTime } from '../lib/time.ts';
import { Button } from './ui/Button.tsx';
import { EmptyState, LoadingState } from './ui/States.tsx';
import { usePolling } from '../lib/usePolling.ts';

/**
 * What this object used to look like.
 *
 * Kubernetes keeps no history, so this is whatever has been recorded since
 * somebody first opened this kind. That window is usually short, and the page
 * says so rather than letting an empty list read as "nothing changed". Those
 * are different facts and only one of them is reassuring.
 *
 * Newest first, because that is the order an incident is read in: you start
 * from "it is broken now" and walk backwards to the change.
 */

interface HistoryPanelProps {
  readonly context: string;
  readonly kind: string;
  readonly name: string;
  readonly namespace?: string | undefined;
}

export function HistoryPanel({ context, kind, name, namespace }: HistoryPanelProps) {
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setResult(await api.history.get(context, kind, name, namespace));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [context, kind, name, namespace]);

  useEffect(() => {
    setResult(null);
    void load();
  }, [load]);
  // The window fills from the watch, so this only has to keep up with reading.
  usePolling(load, 5000);

  if (error) {
    return (
      <EmptyState
        tone="error"
        title="Could not read the history"
        detail={error}
        testId="history-error"
        action={<Button variant="secondary" onClick={() => void load()} icon={<RefreshCw size={13} strokeWidth={1.9} />}>Try again</Button>}
      />
    );
  }
  if (!result) return <LoadingState title="Reading what has changed" rows={3} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="history-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
        <HistoryIcon size={13} strokeWidth={1.9} aria-hidden className="text-tertiary" />
        <span className="text-[12px] text-tertiary">
          {result.since ? `watching since ${relativeTime(result.since)}` : 'watching from now'}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {result.revisions.length <= 1 ? (
          <div className="rounded-xl border border-line bg-raised p-4" data-testid="history-empty">
            <p className="text-[13.5px] font-semibold tracking-[-0.005em] text-primary">Nothing has changed yet</p>
            {/*
              The distinction that matters. An empty list is not evidence that
              the object has been stable, only that it has been stable since
              somebody started looking, and a page that lets the two read the
              same way is a page that lies quietly.
            */}
            <p className="mt-1.5 text-[12.5px] leading-[1.65] text-secondary">
              Kubernetes keeps no history of its own, so this is only what has been seen since this kind was first opened
              {result.since ? `, ${relativeTime(result.since)}` : ''}. It is not a record of the time before that.
            </p>
          </div>
        ) : (
          <ol className="space-y-2" data-testid="history-revisions">
            {result.revisions.map((entry, index) => (
              <RevisionRow key={`${entry.at}:${entry.resourceVersion}`} entry={entry} latest={index === 0} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function RevisionRow({ entry, latest }: { entry: HistoryEntry; latest: boolean }) {
  const [open, setOpen] = useState(latest && entry.changes.length > 0);
  const tint =
    entry.kind === 'deleted'
      ? 'var(--status-error)'
      : entry.kind === 'created'
        ? 'var(--status-ok)'
        : // Something somebody did stands out from something that followed.
          entry.origin === 'spec'
          ? 'var(--series-3)'
          : 'var(--border-strong)';

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14 }}
      className="overflow-hidden rounded-xl border border-line bg-raised"
      data-testid={`history-${entry.kind}`}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100 hover:bg-sunken"
        aria-expanded={open}
        disabled={entry.changes.length === 0}
      >
        <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: tint }} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[12.5px] ${entry.origin === 'status' && entry.kind === 'changed' ? 'text-tertiary' : 'text-primary'}`}>
            {entry.kind === 'created'
              ? 'First seen'
              : entry.kind === 'deleted'
                ? 'Deleted'
                : summarise(entry)}
          </span>
        </span>
        {/*
          Named, because the difference decides what to do about it: a spec
          change is somebody's decision and a status change is the cluster
          reacting to one.
        */}
        {entry.kind === 'changed' ? (
          <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-tertiary">
            {entry.origin === 'spec' ? 'changed' : 'settled'}
          </span>
        ) : null}
        <time className="shrink-0 whitespace-nowrap text-[11px] text-tertiary" title={formatDateTime(entry.at)}>
          {relativeTime(entry.at)}
        </time>
        {entry.changes.length > 0 ? (
          <ChevronDown
            size={13}
            strokeWidth={2}
            aria-hidden
            className="shrink-0 text-tertiary transition-transform duration-150"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          />
        ) : null}
      </button>

      {open && entry.changes.length > 0 ? (
        <ul className="border-t border-subtle px-4 py-2.5" data-testid="history-changes">
          {entry.changes.map((change) => (
            <li key={change.path} className="py-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <code className="break-all font-mono text-[11.5px] text-primary">{change.path}</code>
                <span className="text-[10.5px] uppercase tracking-wide text-tertiary">{change.kind}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11.5px]">
                <span className="max-w-full break-all text-tertiary line-through decoration-1">{render(change.before)}</span>
                <span aria-hidden className="text-tertiary">
                  {'→'}
                </span>
                <span className="max-w-full break-all text-secondary">{render(change.after)}</span>
              </div>
              {change.note ? <p className="mt-1 text-[11.5px] leading-[1.55] text-tertiary">{change.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </motion.li>
  );
}

/** One line for a revision, preferring a change that has something to say. */
function summarise(entry: HistoryEntry): string {
  const explained = entry.changes.find((change) => change.note);
  if (explained?.note) return explained.note;
  const first = entry.changes[0];
  if (!first) return 'Changed';
  const others = entry.changes.length - 1;
  return `${first.path}${others > 0 ? ` and ${others} other field${others === 1 ? '' : 's'}` : ''}`;
}

function render(value: unknown): string {
  if (value === undefined) return 'not set';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  }
  return String(value);
}
