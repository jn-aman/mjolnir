import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, ChevronDown, Info, RefreshCw, ScrollText, Siren, Wrench } from 'lucide-react';
import { api, type Diagnosis, type DiagnosisFinding, type DiagnosisSeverity } from '../lib/api.ts';
import { formatDateTime, relativeTime } from '../lib/time.ts';
import { Button } from './ui/Button.tsx';
import { EmptyState, LoadingState } from './ui/States.tsx';
import { copyText } from './ui/ContextMenu.tsx';
import { usePolling } from '../lib/usePolling.ts';

/**
 * "What broke?"
 *
 * The page is ordered the way the answer is: one sentence at the top naming
 * the thing, then findings with the first cause above the symptoms it caused,
 * then the timeline for anyone who wants to check the ordering themselves.
 *
 * Two deliberate refusals.
 *
 * **No severity counts as the headline.** "3 critical, 2 warnings" is a
 * summary of the summary. The person already knows something is wrong; what
 * they need is the name of it.
 *
 * **No unexplained Kubernetes vocabulary anywhere on the page.** Every
 * finding carries its own plain sentence, and the raw reason strings live in
 * the evidence underneath where they can be searched for, which is the only
 * thing they are good for.
 */

interface DiagnosePanelProps {
  readonly context: string;
  readonly namespace?: string | undefined;
  /** Set when opened from one workload rather than from the rail. */
  readonly focus?: { kind: string; name: string; namespace?: string | undefined } | undefined;
  readonly onNavigate: (target: { kind: string; name?: string; namespace?: string }) => void;
  readonly onOpenLogs?: ((target: { name: string; namespace?: string | undefined; container?: string | undefined; previous?: boolean }) => void) | undefined;
}

const TONE: Record<DiagnosisSeverity, { color: string; background: string; label: string }> = {
  critical: { color: 'var(--status-error)', background: 'var(--status-error-bg)', label: 'Broken' },
  warning: { color: 'var(--status-warn)', background: 'var(--status-warn-bg)', label: 'Worth a look' },
  info: { color: 'var(--text-tertiary)', background: 'var(--surface-raised)', label: 'For information' },
};

/** What the rank means, in words, because a number in a tooltip is not an answer. */
const CAUSE_LABEL: Record<number, string> = {
  0: 'A change, before the failures',
  1: 'What failed',
  2: 'A consequence',
  3: 'Background',
};

export function DiagnosePanel({ context, namespace, focus, onNavigate, onOpenLogs }: DiagnosePanelProps) {
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  const scope = useMemo(
    () => ({
      ...(focus?.namespace ?? namespace ? { namespace: focus?.namespace ?? namespace ?? '' } : {}),
      ...(focus ? { kind: focus.kind, name: focus.name } : {}),
    }),
    [context, focus, namespace],
  );

  const load = useCallback(async () => {
    try {
      setResult(await api.diagnose.run(context, scope));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [context, scope]);

  useEffect(() => {
    setResult(null);
    void load();
  }, [load]);
  // Slower than a list, because this reads six collections and the answer is
  // read rather than watched. It stops entirely when the window is hidden.
  usePolling(load, 20_000);

  const refresh = async () => {
    setBusy(true);
    await load();
    setBusy(false);
  };

  const subject = focus ? `${focus.name}` : namespace ? `namespace ${namespace}` : 'this cluster';

  if (error) {
    return (
      <EmptyState
        tone="error"
        title="Could not work out what broke"
        detail={error}
        testId="diagnose-error"
        action={<Button variant="secondary" onClick={() => void refresh()} icon={<RefreshCw size={13} strokeWidth={1.9} />}>Try again</Button>}
      />
    );
  }
  if (!result) return <LoadingState title={`Reading events, pods and nodes for ${subject}`} rows={4} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="diagnose-panel">
      <div className="flex h-[50px] shrink-0 items-center gap-2 border-b border-line bg-raised px-3.5">
        <Siren size={14} strokeWidth={1.9} aria-hidden style={{ color: 'var(--status-warn)' }} />
        <span className="text-[13px] font-semibold text-primary">What broke?</span>
        <span className="text-[12px] text-tertiary">{subject}</span>
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => void refresh()} disabled={busy} icon={<RefreshCw size={12} strokeWidth={1.9} />}>
          {busy ? 'Looking' : 'Look again'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] px-6 py-6">
          <Headline result={result} subject={subject} />

          {result.findings.length > 0 ? (
            <ol className="mt-5 space-y-2.5" data-testid="diagnose-findings">
              {result.findings.map((finding, index) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  /* The first cause is expanded, because it is the answer and
                     an answer behind a disclosure triangle is not an answer. */
                  defaultOpen={index === 0}
                  onNavigate={onNavigate}
                  {...(onOpenLogs ? { onOpenLogs } : {})}
                />
              ))}
            </ol>
          ) : null}

          {result.timeline.length > 0 ? (
            <div className="mt-7">
              <button
                type="button"
                onClick={() => setShowTimeline((open) => !open)}
                className="flex w-full items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-left transition-colors duration-100 hover:border-strong"
                data-testid="diagnose-timeline-toggle"
              >
                <ScrollText size={13} strokeWidth={1.9} aria-hidden className="text-tertiary" />
                <span className="text-[12.5px] font-medium text-primary">Everything that happened, in order</span>
                <span className="text-[11.5px] text-tertiary">{result.timeline.length} entries</span>
                <div className="flex-1" />
                <ChevronDown
                  size={13}
                  strokeWidth={2}
                  aria-hidden
                  className="text-tertiary transition-transform duration-150"
                  style={{ transform: showTimeline ? 'rotate(180deg)' : 'none' }}
                />
              </button>

              {showTimeline ? (
                <ul className="mt-2 space-y-px overflow-hidden rounded-lg border border-line" data-testid="diagnose-timeline">
                  {result.timeline.map((entry, index) => (
                    <li key={`${entry.at}:${entry.object.name}:${index}`} className="flex gap-3 bg-raised px-3 py-2">
                      <span
                        aria-hidden
                        className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full"
                        style={{ background: TONE[entry.severity].color }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[12.5px] font-medium text-primary">{entry.title}</span>
                          <button
                            type="button"
                            onClick={() => onNavigate({ kind: entry.object.kind, name: entry.object.name, ...(entry.object.namespace ? { namespace: entry.object.namespace } : {}) })}
                            className="font-mono text-[11.5px] text-tertiary underline-offset-2 hover:text-secondary hover:underline"
                          >
                            {entry.object.kind}/{entry.object.name}
                          </button>
                        </div>
                        {entry.detail ? <p className="mt-0.5 break-words text-[11.5px] leading-[1.55] text-tertiary [overflow-wrap:anywhere]">{entry.detail}</p> : null}
                      </div>
                      <time className="shrink-0 whitespace-nowrap text-[11px] text-tertiary" title={formatDateTime(entry.at)}>
                        {relativeTime(entry.at)}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <p className="mt-6 text-[11.5px] leading-[1.6] text-tertiary">
            Read from events, pod statuses, node conditions and recent changes in the last hour. Nothing here is a guess about the
            future: every line has the thing it was read from underneath it.
          </p>
        </div>
      </div>
    </div>
  );
}

/** The one sentence. Named subject, no counts. */
function Headline({ result, subject }: { result: Diagnosis; subject: string }) {
  if (result.healthy) {
    return (
      <div className="rounded-xl border border-line bg-raised p-5 text-center" data-testid="diagnose-healthy">
        <p className="text-[15px] font-semibold tracking-[-0.01em] text-primary">Nothing is failing in {subject}</p>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-tertiary">
          No crash loops, no failing health checks, no pods without a node, and no node under pressure. Anything that broke more
          than an hour ago has aged out of the events the cluster keeps.
        </p>
      </div>
    );
  }

  const worst: DiagnosisSeverity = result.counts.critical > 0 ? 'critical' : result.counts.warning > 0 ? 'warning' : 'info';
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="rounded-xl border p-5"
      style={{ borderColor: `color-mix(in oklab, ${TONE[worst].color} 35%, transparent)`, background: TONE[worst].background }}
      data-testid="diagnose-summary"
    >
      <p className="text-[15px] font-semibold leading-[1.45] tracking-[-0.01em] text-primary">{result.summary}</p>
      <p className="mt-1.5 text-[12.5px] leading-[1.6] text-secondary">
        Ordered with the cause above the symptoms, not by when it happened. The first entry is what to look at.
      </p>
    </motion.div>
  );
}

function FindingCard({
  finding,
  defaultOpen,
  onNavigate,
  onOpenLogs,
}: {
  finding: DiagnosisFinding;
  defaultOpen: boolean;
  onNavigate: DiagnosePanelProps['onNavigate'];
  onOpenLogs?: DiagnosePanelProps['onOpenLogs'];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tone = TONE[finding.severity];
  const Icon = finding.severity === 'critical' ? Siren : finding.severity === 'warning' ? AlertTriangle : Info;

  const act = (action: DiagnosisFinding['actions'][number]) => {
    const target = action.target;
    if (action.kind === 'nodes') return onNavigate({ kind: 'Node' });
    if (!target) return;
    if ((action.kind === 'logs' || action.kind === 'previous-logs') && onOpenLogs) {
      onOpenLogs({
        name: target.name,
        ...(target.namespace ? { namespace: target.namespace } : {}),
        ...(target.container ? { container: target.container } : {}),
        previous: action.kind === 'previous-logs',
      });
      return;
    }
    onNavigate({ kind: target.kind, name: target.name, ...(target.namespace ? { namespace: target.namespace } : {}) });
  };

  return (
    <li className="overflow-hidden rounded-xl border border-line bg-raised" data-testid={`finding-${finding.rule}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-100 hover:bg-sunken"
        aria-expanded={open}
      >
        <span
          aria-hidden
          className="mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md"
          style={{ color: tone.color, background: `color-mix(in oklab, ${tone.color} 14%, transparent)` }}
        >
          <Icon size={13} strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[13.5px] font-semibold leading-[1.4] tracking-[-0.005em] text-primary [overflow-wrap:anywhere]">
            {finding.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className="rounded-xs px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: tone.color, background: `color-mix(in oklab, ${tone.color} 12%, transparent)` }}
            >
              {tone.label}
            </span>
            {/* The rank, spelled out. Sorting by something invisible is how a
                list looks arbitrary. */}
            <span className="text-[11px] text-tertiary">{CAUSE_LABEL[finding.cause] ?? 'Background'}</span>
            <span className="font-mono text-[11px] text-tertiary">
              {/* One problem on four pods is one problem. The count says how
                  wide it is without spending four rows saying it. */}
              {(finding.affected?.length ?? 1) > 1
                ? `${finding.affected?.length} pods · ${finding.object.namespace ?? ''}`
                : `${finding.object.kind}/${finding.object.name}${finding.object.namespace ? ` · ${finding.object.namespace}` : ''}`}
            </span>
            {finding.at ? (
              <span className="text-[11px] text-tertiary" title={formatDateTime(finding.at)}>
                {relativeTime(finding.at)}
              </span>
            ) : null}
          </span>
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          aria-hidden
          className="mt-[3px] shrink-0 text-tertiary transition-transform duration-150"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open ? (
        <div className="border-t border-subtle px-4 py-3">
          <p className="break-words text-[12.5px] leading-[1.65] text-secondary [overflow-wrap:anywhere]">{finding.detail}</p>

          {finding.fix ? (
            <div className="mt-3 flex gap-2.5 rounded-lg border border-line bg-sunken px-3 py-2.5">
              <Wrench size={13} strokeWidth={1.9} aria-hidden className="mt-[2px] shrink-0 text-tertiary" />
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">What to do</div>
                <p className="mt-0.5 break-words text-[12.5px] leading-[1.6] text-secondary [overflow-wrap:anywhere]">{finding.fix}</p>
              </div>
              {finding.fix.startsWith('kubectl ') ? (
                <Button variant="ghost" onClick={() => copyText(finding.fix ?? '', 'Command copied')}>
                  Copy
                </Button>
              ) : null}
            </div>
          ) : null}

          {(finding.affected?.length ?? 1) > 1 ? (
            <div className="mt-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">Where it is happening</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {finding.affected?.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onNavigate({ kind: 'Pod', name, ...(finding.object.namespace ? { namespace: finding.object.namespace } : {}) })}
                    className="rounded-xs border border-subtle bg-sunken px-1.5 py-[2px] font-mono text-[11px] text-tertiary transition-colors duration-100 hover:border-strong hover:text-secondary"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {finding.evidence.length > 0 ? (
            <div className="mt-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">What this was read from</div>
              <ul className="mt-1.5 space-y-1.5">
                {finding.evidence.map((line, index) => (
                  <li key={`${line.source}:${index}`} className="rounded-md border border-subtle bg-sunken px-2.5 py-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[11px] font-medium text-tertiary">{line.source}</span>
                      {line.at ? (
                        <span className="text-[10.5px] text-tertiary" title={formatDateTime(line.at)}>
                          {relativeTime(line.at)}
                        </span>
                      ) : null}
                    </div>
                    {line.text ? (
                      <p className="mt-0.5 break-words font-mono text-[11.5px] leading-[1.5] text-secondary [overflow-wrap:anywhere]">{line.text}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {finding.actions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {finding.actions.map((action) => (
                <Button key={`${action.kind}:${action.label}`} variant="secondary" onClick={() => act(action)}>
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
