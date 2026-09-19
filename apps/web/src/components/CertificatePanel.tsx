import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, ChevronDown, RefreshCw, Search, ShieldCheck, Wrench } from 'lucide-react';
import { api, type CertificateReport, type CertificateSummary } from '../lib/api.ts';
import { formatDateTime, relativeTime } from '../lib/time.ts';
import { Button } from './ui/Button.tsx';
import { Field } from './ui/Field.tsx';
import { EmptyState, LoadingState } from './ui/States.tsx';
import { copyText } from './ui/ContextMenu.tsx';
import { usePolling } from '../lib/usePolling.ts';

/**
 * Certificates, sorted by when they stop working.
 *
 * The column that matters is not the date, it is **who renews it**. A
 * cert-manager certificate eleven days out is not news; a hand-made one
 * eleven days out is the reason this page exists, so the page leads on that
 * and says it in words on every row rather than leaving it to a badge.
 */

interface CertificatePanelProps {
  readonly context: string;
  readonly namespace?: string | undefined;
  readonly onNavigate: (target: { kind: string; name?: string; namespace?: string }) => void;
}

const STATE: Record<CertificateSummary['state'], { color: string; label: string }> = {
  expired: { color: 'var(--status-error)', label: 'Expired' },
  critical: { color: 'var(--status-error)', label: 'This week' },
  soon: { color: 'var(--status-warn)', label: 'This month' },
  ok: { color: 'var(--status-ok)', label: 'Fine' },
  'not-yet-valid': { color: 'var(--status-warn)', label: 'Not valid yet' },
};

const SOURCE_LABEL: Record<CertificateSummary['source'], string> = {
  secret: 'TLS secret',
  'cert-manager': 'cert-manager',
  webhook: 'Admission webhook',
  'api-service': 'Aggregated API',
};

export function CertificatePanel({ context, namespace, onNavigate }: CertificatePanelProps) {
  const [report, setReport] = useState<CertificateReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [onlyUnmanaged, setOnlyUnmanaged] = useState(false);

  const load = useCallback(async () => {
    try {
      setReport(await api.certificates.list(context, namespace));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [context, namespace]);

  useEffect(() => {
    setReport(null);
    void load();
  }, [load]);
  // A certificate's expiry date does not move. Five minutes is generous, and
  // it stops entirely when nobody is looking.
  usePolling(load, 300_000);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (report?.certificates ?? []).filter((entry) => {
      if (onlyUnmanaged && entry.managed) return false;
      if (!needle) return true;
      return (
        entry.name.toLowerCase().includes(needle) ||
        entry.subject.toLowerCase().includes(needle) ||
        (entry.namespace ?? '').toLowerCase().includes(needle) ||
        entry.hosts.some((host) => host.toLowerCase().includes(needle))
      );
    });
  }, [report, filter, onlyUnmanaged]);

  if (error) {
    return (
      <EmptyState
        tone="error"
        title="Could not read the certificates"
        detail={error}
        testId="certificates-error"
        action={<Button variant="secondary" onClick={() => void load()} icon={<RefreshCw size={13} strokeWidth={1.9} />}>Try again</Button>}
      />
    );
  }
  if (!report) return <LoadingState title="Reading every TLS secret, certificate and CA bundle" rows={5} />;

  const worst = report.counts.expired > 0 || report.counts.critical > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="certificates-panel">
      <div className="flex h-[50px] shrink-0 items-center gap-2 border-b border-line bg-raised px-3.5">
        <ShieldCheck size={14} strokeWidth={1.9} aria-hidden style={{ color: 'var(--status-ok)' }} />
        <span className="text-[13px] font-semibold text-primary">Certificates</span>
        <span className="text-[12px] text-tertiary">{namespace || 'every namespace'}</span>
        <div className="flex-1" />
        <Field
          id="certificates-filter"
          label="Filter certificates"
          hideLabel
          mono
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name or host"
          className="w-[240px] min-w-[150px] shrink"
          leading={<Search size={13} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />}
        />
        <Button
          variant={onlyUnmanaged ? 'secondary' : 'ghost'}
          onClick={() => setOnlyUnmanaged((current) => !current)}
          hint="Hide everything cert-manager looks after, leaving only what needs a person"
        >
          Needs a person
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setBusy(true);
            void load().finally(() => setBusy(false));
          }}
          disabled={busy}
          icon={<RefreshCw size={12} strokeWidth={1.9} />}
        >
          Refresh
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-6 py-6">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="rounded-xl border p-5"
            style={{
              borderColor: worst ? 'color-mix(in oklab, var(--status-error) 35%, transparent)' : 'var(--border-line)',
              background: worst ? 'var(--status-error-bg)' : 'var(--surface-raised)',
            }}
            data-testid="certificates-summary"
          >
            <p className="text-[15px] font-semibold leading-[1.45] tracking-[-0.01em] text-primary">{report.summary}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-tertiary">
              {/* Counts, but underneath the sentence rather than instead of it. */}
              {report.counts.expired > 0 ? <Count label="expired" value={report.counts.expired} tint="var(--status-error)" /> : null}
              {report.counts.critical > 0 ? <Count label="within a week" value={report.counts.critical} tint="var(--status-error)" /> : null}
              {report.counts.soon > 0 ? <Count label="within a month" value={report.counts.soon} tint="var(--status-warn)" /> : null}
              <Count label="not expiring soon" value={report.counts.ok} tint="var(--status-ok)" />
            </div>
          </motion.div>

          {shown.length === 0 ? (
            <p className="mt-6 text-center text-[12.5px] text-tertiary">
              {report.certificates.length === 0
                ? 'No TLS secrets, cert-manager certificates or webhook CA bundles in reach of this token.'
                : 'Nothing here matches that.'}
            </p>
          ) : (
            <ul className="mt-5 space-y-2" data-testid="certificate-list">
              {shown.map((entry) => (
                <CertificateRow key={entry.id} entry={entry} onNavigate={onNavigate} />
              ))}
            </ul>
          )}

          <p className="mt-6 text-[11.5px] leading-[1.6] text-tertiary">
            Read from TLS secrets, cert-manager Certificates, admission webhook CA bundles and aggregated API services. The private
            key beside each certificate is never parsed, stored or sent anywhere: a certificate is public, and the key next to it
            is not.
          </p>
        </div>
      </div>
    </div>
  );
}

function Count({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="h-[6px] w-[6px] rounded-full" style={{ background: tint }} />
      <span className="text-secondary">{value}</span> {label}
    </span>
  );
}

function CertificateRow({ entry, onNavigate }: { entry: CertificateSummary; onNavigate: CertificatePanelProps['onNavigate'] }) {
  const [open, setOpen] = useState(false);
  const tone = STATE[entry.state];
  const critical = entry.problems.filter((problem) => problem.severity === 'critical');

  return (
    <li className="overflow-hidden rounded-xl border border-line bg-raised" data-testid={`certificate-${entry.name}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-100 hover:bg-sunken"
        aria-expanded={open}
      >
        <span
          aria-hidden
          className="mt-[3px] h-[8px] w-[8px] shrink-0 rounded-full"
          style={{ background: tone.color }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="break-words text-[13.5px] font-semibold tracking-[-0.005em] text-primary [overflow-wrap:anywhere]">
              {entry.subject}
            </span>
            <span className="font-mono text-[11px] text-tertiary">
              {entry.name}
              {entry.namespace ? ` · ${entry.namespace}` : ''}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className="rounded-xs px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: tone.color, background: `color-mix(in oklab, ${tone.color} 12%, transparent)` }}
            >
              {entry.state === 'expired'
                ? `Expired ${Math.abs(entry.daysLeft)}d ago`
                : entry.state === 'not-yet-valid'
                  ? tone.label
                  : `${entry.daysLeft}d left`}
            </span>
            {/*
              The whole point of the page, said on every row rather than left
              to a colour: a date nobody will act on is a date that matters.
            */}
            <span className="text-[11px]" style={{ color: entry.managed ? 'var(--text-tertiary)' : 'var(--status-warn)' }}>
              {entry.managed ? 'renews itself' : 'needs a person'}
            </span>
            <span className="text-[11px] text-tertiary">{SOURCE_LABEL[entry.source]}</span>
            {critical.length > 0 ? (
              <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--status-error)' }}>
                <AlertTriangle size={10} strokeWidth={2.2} aria-hidden />
                {critical.length === 1 ? 'a problem beyond the date' : `${critical.length} problems beyond the date`}
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
          <p className="break-words text-[12.5px] leading-[1.65] text-secondary [overflow-wrap:anywhere]">{entry.detail}</p>

          {entry.problems.map((problem) => (
            <div
              key={problem.kind + problem.detail}
              className="mt-2.5 rounded-lg border px-3 py-2"
              style={{
                borderColor:
                  problem.severity === 'critical'
                    ? 'color-mix(in oklab, var(--status-error) 35%, transparent)'
                    : 'var(--border-subtle)',
                background: problem.severity === 'critical' ? 'var(--status-error-bg)' : 'var(--surface-sunken)',
              }}
            >
              <p className="break-words text-[12.5px] leading-[1.6] text-secondary [overflow-wrap:anywhere]">{problem.detail}</p>
            </div>
          ))}

          {entry.fix ? (
            <div className="mt-2.5 flex gap-2.5 rounded-lg border border-line bg-sunken px-3 py-2.5">
              <Wrench size={13} strokeWidth={1.9} aria-hidden className="mt-[2px] shrink-0 text-tertiary" />
              <p className="min-w-0 flex-1 break-words text-[12.5px] leading-[1.6] text-secondary [overflow-wrap:anywhere]">{entry.fix}</p>
              {entry.fix.startsWith('kubectl ') ? (
                <Button variant="ghost" onClick={() => copyText(entry.fix ?? '', 'Command copied')}>
                  Copy
                </Button>
              ) : null}
            </div>
          ) : null}

          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
            <Detail label="Covers">{entry.hosts.length > 0 ? entry.hosts.join(', ') : 'no hostnames listed'}</Detail>
            <Detail label="Issued by">{entry.selfSigned ? `${entry.issuer} (self-signed)` : entry.issuer}</Detail>
            <Detail label="Valid until">
              {formatDateTime(entry.notAfter)} · {relativeTime(entry.notAfter)}
            </Detail>
            {entry.renewAt ? <Detail label="Renews">{formatDateTime(entry.renewAt)}</Detail> : null}
            {entry.issuerRef ? <Detail label="cert-manager issuer">{entry.issuerRef}</Detail> : null}
            <Detail label="Key">{entry.keyType}</Detail>
            {entry.chainLength > 1 ? <Detail label="Chain">{entry.chainLength} certificates</Detail> : null}
          </dl>

          {entry.usedBy.length > 0 ? (
            <div className="mt-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">Used by</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {entry.usedBy.map((use) => (
                  <button
                    key={`${use.kind}:${use.name}`}
                    type="button"
                    onClick={() => onNavigate({ kind: use.kind, name: use.name, ...(use.namespace ? { namespace: use.namespace } : {}) })}
                    className="rounded-xs border border-subtle bg-sunken px-1.5 py-[2px] font-mono text-[11px] text-tertiary transition-colors duration-100 hover:border-strong hover:text-secondary"
                  >
                    {use.kind}/{use.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {entry.source === 'secret' || entry.source === 'cert-manager' ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button
                variant="secondary"
                onClick={() => onNavigate({ kind: 'Secret', name: entry.name, ...(entry.namespace ? { namespace: entry.namespace } : {}) })}
              >
                Open the secret
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="whitespace-nowrap text-tertiary">{label}</dt>
      <dd className="min-w-0 break-words text-secondary [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}
