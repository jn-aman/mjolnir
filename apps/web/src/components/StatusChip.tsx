/**
 * A workload's state in one word.
 *
 * The mapping is the interesting part, not the styling:
 *
 * - **Completed is neutral, not ok.** A Job that finished is not healthy, it is
 *   done. Colouring it green trains people to read green as "nothing to see",
 *   which is exactly wrong on the day a Job completes when it should still be
 *   running.
 * - **Unknown is neutral, not error.** We do not know. Red would be a claim we
 *   cannot support.
 * - The Kubernetes string is shown verbatim, because that is what people search
 *   for and paste into a terminal.
 */

export type StatusTone = 'ok' | 'warn' | 'error' | 'neutral';

const OK = new Set(['Running', 'Ready', 'Active', 'Bound', 'Synced', 'Healthy', 'Available']);
const WARN = new Set([
  'Pending',
  'ContainerCreating',
  'PodInitializing',
  'Progressing',
  'Terminating',
  'Degraded',
  'NotReady',
  'Released',
]);
const ERROR = new Set([
  'CrashLoopBackOff',
  'Failed',
  'Error',
  'ImagePullBackOff',
  'ErrImagePull',
  'Evicted',
  'OOMKilled',
  'CreateContainerConfigError',
  'InvalidImageName',
  'Unschedulable',
  'Lost',
]);

export function toneFor(status: string): StatusTone {
  if (OK.has(status)) return 'ok';
  if (ERROR.has(status)) return 'error';
  if (WARN.has(status)) return 'warn';
  // Completed, Succeeded, Suspended, Unknown and anything unrecognised.
  return 'neutral';
}

const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'bg-ok-bg text-ok border-[var(--status-ok-border)]',
  warn: 'bg-warn-bg text-warn border-[color-mix(in_oklab,var(--status-warn)_35%,transparent)]',
  error: 'bg-error-bg text-error border-[var(--status-error-border)]',
  neutral: 'bg-overlay text-secondary border-line',
};
const TONE_DOT: Record<StatusTone, string> = {
  ok: 'var(--status-ok)',
  warn: 'var(--status-warn)',
  error: 'var(--status-error)',
  neutral: 'var(--text-tertiary)',
};

interface StatusChipProps {
  readonly status: string;
  readonly tone?: StatusTone;
}

export function StatusChip({ status, tone }: StatusChipProps) {
  const resolved = tone ?? toneFor(status);
  return (
    <span
      data-testid="status-chip"
      data-tone={resolved}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-[9px] py-[3px] text-[11.5px] font-medium ${TONE_CLASS[resolved]}`}
      style={{ boxShadow: '0 1px 0 var(--highlight) inset' }}
    >
      <span aria-hidden className={`glow-dot ${resolved === 'ok' && status === 'Running' ? 'breathe' : ''}`} style={{ ['--dot' as string]: TONE_DOT[resolved], ...(resolved === 'neutral' ? { boxShadow: 'none' } : {}) }} />
      {status}
    </span>
  );
}
