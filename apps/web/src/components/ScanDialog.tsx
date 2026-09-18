import { useEffect, useState } from 'react';
import { ExternalLink, RotateCw, ShieldAlert } from 'lucide-react';
import { api, type ScanReport } from '../lib/api.ts';
import { Modal } from './ui/Modal.tsx';
import { Button } from './ui/Button.tsx';
import { Switch } from './ui/Switch.tsx';
import { copyEntry, copyText, Menu, type MenuEntry } from './ui/ContextMenu.tsx';

/**
 * Trivy, on one image, right here.
 *
 * Findings by severity with the fixed version where there is one, because
 * "47 vulnerabilities" is a number and "12 you can fix by bumping curl" is a
 * task. Cached for ten minutes per image; Rescan bypasses it.
 */
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
const SEVERITY_TONE: Record<string, string> = { CRITICAL: 'var(--status-error)', HIGH: 'var(--series-2)', MEDIUM: 'var(--status-warn)', LOW: 'var(--series-1)', UNKNOWN: 'var(--text-tertiary)' };

export function scanImage(image: string): void {
  window.dispatchEvent(new CustomEvent('mjolnir:scan', { detail: image }));
}

export function ScanDialog({ image, onClose }: { image: string | null; onClose: () => void }) {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyFixable, setOnlyFixable] = useState(false);
  const [severity, setSeverity] = useState<string | null>(null);
  const [availability, setAvailability] = useState<{ available: boolean; install: string } | null>(null);

  const run = async (force = false) => {
    if (!image) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await api.scan.image(image, force));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setReport(null);
    setError(null);
    setSeverity(null);
    if (!image) return;
    void api.scan.status().then(setAvailability).catch(() => setAvailability(null));
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  const findings = (report?.findings ?? []).filter((f) => (!onlyFixable || f.fixed) && (!severity || f.severity === severity));

  return (
    <Modal
      open={image !== null}
      onClose={onClose}
      title="Vulnerability scan"
      description={<span className="font-mono">{image}</span>}
      width={880}
      testId="scan-dialog"
      footer={
        <>
          {report ? <span className="mr-auto text-[11.5px] text-tertiary">Scanned {new Date(report.scannedAt).toLocaleTimeString()}{report.cached ? ' (cached)' : ''}{report.os?.Family ? ` · ${report.os.Family} ${report.os.Name ?? ''}` : ''}</span> : null}
          <Button variant="ghost" disabled={busy || !image} onClick={() => void run(true)} icon={<RotateCw size={12} strokeWidth={1.9} />}>Rescan</Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {busy ? (
        <div className="flex items-center gap-3 py-8 text-[13px] text-secondary">
          <ShieldAlert size={16} strokeWidth={1.8} className="animate-pulse text-accent" aria-hidden />
          Trivy is scanning {image}… the first scan of an image pulls its layers and the vulnerability database, so it can take a minute.
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-[var(--status-error-border)] bg-error-bg p-3 text-[12.5px] text-error">
          {error}
          {availability && !availability.available ? (
            <div className="mt-2 flex items-center gap-2 text-secondary">
              <code className="font-mono text-[12px] text-primary">brew install trivy</code>
              <Button variant="ghost" onClick={() => copyText('brew install trivy', 'Copied')}>Copy</Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {report && !busy ? (
        <div className="flex min-h-0 flex-col">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {SEVERITIES.map((level) => {
              const count = report.bySeverity[level] ?? 0;
              const active = severity === level;
              return (
                <button
                  key={level}
                  type="button"
                  data-testid={`scan-sev-${level.toLowerCase()}`}
                  onClick={() => setSeverity(active ? null : level)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition-colors duration-100 ${active ? 'border-strong bg-pressed text-primary' : 'border-line bg-raised text-secondary hover:border-strong'}`}
                >
                  <span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: SEVERITY_TONE[level] }} />
                  {level.charAt(0) + level.slice(1).toLowerCase()}
                  <span className="font-mono tabular-nums text-primary">{count}</span>
                </button>
              );
            })}
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-[12px] text-secondary">
              Only fixable ({report.fixable})
              <Switch checked={onlyFixable} onChange={setOnlyFixable} label="Only fixable" />
            </label>
          </div>
          {report.total === 0 ? (
            <p className="py-6 text-center text-[13px] text-ok">No known vulnerabilities. Rescan after the next database update to be sure.</p>
          ) : (
            <div className="max-h-[440px] overflow-y-auto rounded-lg border border-line">
              <div className="grid grid-cols-[90px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)] gap-x-3 border-b border-line bg-raised px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">
                <span>Severity</span><span>Vulnerability</span><span>Package</span><span>Installed → fixed</span><span>Title</span>
              </div>
              {findings.map((f) => {
                const entries: MenuEntry[] = [
                  ...(f.url ? [{ id: 'open', label: 'Open advisory', onSelect: () => window.open(f.url, '_blank') }] : []),
                  ...copyEntry('copy-id', 'Copy id', f.id),
                  ...copyEntry('copy-fix', 'Copy fix', f.fixed ? `${f.package} ${f.installed} → ${f.fixed}` : undefined),
                ];
                return (
                  <Menu key={`${f.id}:${f.package}:${f.target}`} label={f.id} entries={entries}>
                    <div className="grid grid-cols-[90px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-3 border-b border-subtle px-3 py-1.5 text-[12px] hover:bg-hover" data-testid="scan-finding">
                      <span className="flex items-center gap-1.5 text-secondary"><span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: SEVERITY_TONE[f.severity] }} />{f.severity.charAt(0) + f.severity.slice(1).toLowerCase()}</span>
                      <span className="truncate font-mono text-primary">{f.id}{f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="ml-1 inline-block align-middle text-tertiary hover:text-accent"><ExternalLink size={10} /></a> : null}</span>
                      <span className="truncate font-mono text-secondary">{f.package}</span>
                      <span className="truncate font-mono text-tertiary">{f.installed}{f.fixed ? <span className="text-ok"> → {f.fixed}</span> : ''}</span>
                      <span className="truncate text-secondary" title={f.title}>{f.title}</span>
                    </div>
                  </Menu>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
