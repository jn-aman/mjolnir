import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Download, RotateCw, Search, X } from 'lucide-react';
import { api, type ScanReport } from '../lib/api.ts';
import { Modal } from './ui/Modal.tsx';
import { Button } from './ui/Button.tsx';
import { Switch } from './ui/Switch.tsx';
import { Select } from './ui/Select.tsx';
import { Truncate } from './ui/Truncate.tsx';
import { MarkTile } from './ui/Mark.tsx';
import { copyEntry, copyText } from './ui/ContextMenu.tsx';
import { ResourceList } from './ResourceList.tsx';
import type { KubeItem } from './columns.tsx';

/**
 * Trivy, on one image, right here.
 *
 * Findings by severity with the fixed version where there is one, because
 * "471 vulnerabilities" is a number and "12 you can fix by bumping curl" is a
 * task. Cached for ten minutes per image; Rescan bypasses it.
 *
 * The scan streams. A first run against a fat image spends a minute pulling
 * layers and updating the vulnerability database, and Trivy narrates all of it
 * on stderr. Showing that is the difference between a progress screen and a
 * spinner people assume has hung, and it is free: the lines already exist.
 */
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: 'var(--status-error)',
  HIGH: 'var(--series-2)',
  MEDIUM: 'var(--status-warn)',
  LOW: 'var(--series-1)',
  UNKNOWN: 'var(--text-tertiary)',
};
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };

export function scanImage(image: string): void {
  window.dispatchEvent(new CustomEvent('mjolnir:scan', { detail: image }));
}

type SortKey = 'severity' | 'package' | 'id' | 'fixable';

export function ScanDialog({ image, onClose }: { image: string | null; onClose: () => void }) {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [onlyFixable, setOnlyFixable] = useState(false);
  const [severity, setSeverity] = useState<string | null>(null);
  const [pkg, setPkg] = useState<string>('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('severity');
  const [availability, setAvailability] = useState<{ available: boolean; install: string } | null>(null);
  const source = useRef<EventSource | null>(null);

  const run = (force = false): void => {
    if (!image) return;
    source.current?.close();
    setBusy(true);
    setError(null);
    setReport(null);
    setLines([]);
    const stream = new EventSource(`/api/scan/stream?image=${encodeURIComponent(image)}${force ? '&force=true' : ''}`);
    source.current = stream;
    stream.addEventListener('log', (event) => {
      const { line } = JSON.parse((event as MessageEvent<string>).data) as { line: string };
      // Bounded: a database update can print hundreds of progress lines and
      // nobody scrolls back through them.
      setLines((current) => [...current.slice(-200), line]);
    });
    stream.addEventListener('done', (event) => {
      setReport(JSON.parse((event as MessageEvent<string>).data) as ScanReport);
      setBusy(false);
      stream.close();
    });
    stream.addEventListener('failed', (event) => {
      setError((JSON.parse((event as MessageEvent<string>).data) as { message: string }).message);
      setBusy(false);
      stream.close();
    });
    stream.onerror = () => {
      // Only a real failure if nothing arrived; the server closes the stream
      // itself once it has sent the report.
      setBusy((wasBusy) => {
        if (wasBusy) setError('The scan stream closed before it finished.');
        return false;
      });
      stream.close();
    };
  };

  useEffect(() => {
    setReport(null);
    setError(null);
    setSeverity(null);
    setSearch('');
    setPkg('');
    setOnlyFixable(false);
    if (!image) {
      source.current?.close();
      return;
    }
    void api.scan.status().then(setAvailability).catch(() => setAvailability(null));
    run();
    return () => source.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  const packages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const finding of report?.findings ?? []) counts.set(finding.package, (counts.get(finding.package) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [report]);

  const findings = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (report?.findings ?? []).filter((finding) => {
      if (onlyFixable && !finding.fixed) return false;
      if (severity && finding.severity !== severity) return false;
      if (pkg && finding.package !== pkg) return false;
      if (!needle) return true;
      // Everything on the row, plus the target, so searching "curl", "CVE-2026"
      // or "heap" all land somewhere sensible.
      return `${finding.id} ${finding.package} ${finding.installed} ${finding.fixed ?? ''} ${finding.severity} ${finding.title} ${finding.target}`
        .toLowerCase()
        .includes(needle);
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      const rank = (severityName: string): number => SEVERITY_RANK[severityName] ?? 9;
      if (sort === 'package') return a.package.localeCompare(b.package) || rank(a.severity) - rank(b.severity);
      if (sort === 'id') return a.id.localeCompare(b.id);
      if (sort === 'fixable') return Number(Boolean(b.fixed)) - Number(Boolean(a.fixed)) || rank(a.severity) - rank(b.severity);
      return rank(a.severity) - rank(b.severity) || a.package.localeCompare(b.package);
    });
    return sorted;
  }, [report, search, severity, pkg, onlyFixable, sort]);

  /** What is on screen, not the whole report: the filter is part of the question. */
  const downloadCsv = (): void => {
    if (!report) return;
    const header = ['severity', 'vulnerability', 'package', 'installed', 'fixed', 'title', 'target', 'url'];
    const rows = findings.map((finding) => [
      finding.severity,
      finding.id,
      finding.package,
      finding.installed,
      finding.fixed ?? '',
      finding.title,
      finding.target,
      finding.url,
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    // The BOM is what makes Excel open a UTF-8 CSV without mangling it.
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.image.replace(/[^a-zA-Z0-9._-]+/g, '-')}-vulnerabilities.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filtered = report ? findings.length !== report.total : false;

  /*
   * Findings as rows.
   *
   * The same shape every other table in the app takes, so the columns for
   * this kind live beside the columns for pods and deployments rather than
   * inside this dialog.
   */
  const rows = useMemo(
    () =>
      findings.map((finding) => ({
        metadata: { name: finding.id, uid: `${finding.id}:${finding.package}:${finding.target}` },
        spec: {
          severity: finding.severity,
          package: finding.package,
          installed: finding.installed,
          fixed: finding.fixed,
          url: finding.url,
          target: finding.target,
        },
        status: { title: finding.title },
      })) as unknown as KubeItem[],
    [findings],
  );

  return (
    <Modal
      open={image !== null}
      onClose={onClose}
      title="Vulnerability scan"
      description={<span className="font-mono">{image}</span>}
      width={980}
      testId="scan-dialog"
      footer={
        <>
          {report ? (
            <span className="mr-auto text-[11.5px] text-tertiary">
              Scanned {new Date(report.scannedAt).toLocaleTimeString()}
              {report.cached ? ' (cached)' : ''}
              {report.os?.Family ? ` · ${report.os.Family} ${report.os.Name ?? ''}` : ''}
            </span>
          ) : null}
          {report && report.total > 0 ? (
            <Button variant="ghost" onClick={downloadCsv} icon={<Download size={12} strokeWidth={1.9} />} data-testid="scan-csv">
              {filtered ? `Download ${findings.length} as CSV` : 'Download CSV'}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy || !image} onClick={() => run(true)} icon={<RotateCw size={12} strokeWidth={1.9} />}>
            Rescan
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {busy ? <Running image={image ?? ''} lines={lines} /> : null}

      {error ? (
        <div className="rounded-lg border border-[var(--status-error-border)] bg-error-bg p-3 text-[12.5px] text-error">
          {error}
          {availability && !availability.available ? (
            <div className="mt-2 flex items-center gap-2 text-secondary">
              <code className="font-mono text-[12px] text-primary">brew install trivy</code>
              <Button variant="ghost" onClick={() => copyText('brew install trivy', 'Copied')}>
                Copy
              </Button>
            </div>
          ) : null}
          {lines.length > 0 ? <LogBlock lines={lines} className="mt-3" /> : null}
        </div>
      ) : null}

      {report && !busy ? (
        <div className="flex min-h-0 flex-col">
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            {SEVERITIES.map((level) => {
              const count = report.bySeverity[level] ?? 0;
              const active = severity === level;
              return (
                <button
                  key={level}
                  type="button"
                  data-testid={`scan-sev-${level.toLowerCase()}`}
                  disabled={count === 0}
                  onClick={() => setSeverity(active ? null : level)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition-colors duration-100 disabled:opacity-40 ${
                    active ? 'border-strong bg-pressed text-primary' : 'border-line bg-raised text-secondary hover:border-strong'
                  }`}
                >
                  <span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: SEVERITY_TONE[level] }} />
                  {level.charAt(0) + level.slice(1).toLowerCase()}
                  <span className="font-mono tabular-nums text-primary">{count}</span>
                </button>
              );
            })}
            <div className="flex-1" />
            <label className="flex items-center gap-2 whitespace-nowrap text-[12px] text-secondary">
              Only fixable ({report.fixable})
              <Switch checked={onlyFixable} onChange={setOnlyFixable} label="Only fixable" testId="scan-fixable" />
            </label>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex h-[30px] min-w-[220px] flex-1 items-center gap-1.5 rounded-md border border-line bg-sunken px-2.5 focus-within:border-focus">
              <Search size={12} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search CVE, package, version or title"
                data-testid="scan-search"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-primary outline-none placeholder:text-tertiary"
              />
              {search ? (
                <button type="button" onClick={() => setSearch('')} aria-label="Clear the search" className="shrink-0 text-tertiary hover:text-primary">
                  <X size={12} strokeWidth={2.2} />
                </button>
              ) : null}
            </div>
            <Select
              label="Package"
              value={pkg}
              onChange={setPkg}
              width={210}
              mono
              testId="scan-package"
              options={[{ value: '', label: `All packages (${packages.length})` }, ...packages.map(([name, count]) => ({ value: name, label: name, hint: `${count}` }))]}
            />
            <Select
              label="Sort"
              value={sort}
              onChange={(next) => setSort(next as SortKey)}
              width={160}
              testId="scan-sort"
              options={[
                { value: 'severity', label: 'Worst first' },
                { value: 'fixable', label: 'Fixable first' },
                { value: 'package', label: 'By package' },
                { value: 'id', label: 'By CVE' },
              ]}
            />
          </div>

          {report.total === 0 ? (
            <p className="py-6 text-center text-[13px] text-ok">No known vulnerabilities. Rescan after the next database update to be sure.</p>
          ) : findings.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-[13px] text-secondary">None of the {report.total} findings match these filters.</p>
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setSeverity(null);
                  setPkg('');
                  setOnlyFixable(false);
                }}
              >
                Clear the filters
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-1.5 text-[11.5px] text-tertiary" data-testid="scan-count">
                Showing {findings.length} of {report.total}
              </div>
              {/*
                The shared table, not a grid of its own.
                
                This was a fixed five-column grid with no sorting, no
                reordering and no resizing, so the one column somebody wanted
                wider was the one they could not widen. Going through the same
                component as every other list means each of those arrives here
                without being built again, and arrives everywhere at once.
              */}
              <div className="flex h-[420px] min-h-0 flex-col overflow-hidden rounded-lg border border-line">
                <ResourceList
                  kind="ScanFinding"
                  label="Findings"
                  items={rows}
                  state="synced"
                  error={null}
                  filter=""
                  menu={(item: KubeItem) => {
                    const finding = findings.find(
                      (entry) => entry.id === item.metadata?.name && entry.package === (item.spec as { package?: string } | undefined)?.package,
                    );
                    if (!finding) return [];
                    return [
                      ...(finding.url ? [{ id: 'open', label: 'Open advisory', onSelect: () => window.open(finding.url, '_blank') }] : []),
                      ...copyEntry('copy-id', 'Copy id', finding.id),
                      ...copyEntry('copy-fix', 'Copy fix', finding.fixed ? `${finding.package} ${finding.installed} to ${finding.fixed}` : undefined),
                      { id: 'filter-pkg', label: `Only ${finding.package}`, onSelect: () => setPkg(finding.package) },
                    ];
                  }}
                  empty={{ title: 'Nothing matches those filters', detail: 'Widen the severity or clear the package filter.' }}
                />
              </div>
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * The scan in progress.
 *
 * Trivy's own output, live, with the most recent line pulled out as the
 * headline. "Pulling layers" and "updating the vulnerability database" are the
 * two slow steps, and seeing which one you are in is the whole difference
 * between waiting and wondering.
 */
function Running({ image, lines }: { image: string; lines: readonly string[] }) {
  const latest = lines[lines.length - 1] ?? 'Starting Trivy';
  return (
    <div className="flex flex-col gap-4 py-2" data-testid="scan-running">
      <div className="flex items-center gap-3.5">
        <span className="relative block">
          {[0, 1].map((ring) => (
            <motion.span
              key={ring}
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 rounded-[30%] border"
              style={{ borderColor: 'color-mix(in oklab, var(--accent-solid) 45%, transparent)', width: 42, height: 42, marginLeft: -21, marginTop: -21 }}
              initial={{ opacity: 0.45, scale: 1 }}
              animate={{ opacity: 0, scale: 1.9 }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay: ring * 1.1 }}
            />
          ))}
          <MarkTile size={42} pulse />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-primary">Scanning the image</div>
          <div className="mt-0.5 min-w-0 font-mono text-[11.5px] text-tertiary">
            <Truncate text={latest} />
          </div>
          <span aria-hidden className="mt-2 block h-[3px] w-full overflow-hidden rounded-full bg-sunken">
            <motion.span
              className="block h-full w-[38%] rounded-full"
              style={{ background: 'linear-gradient(90deg, transparent, var(--accent-base), transparent)' }}
              animate={{ x: ['-110%', '280%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          </span>
        </div>
      </div>
      <p className="text-[12px] leading-[1.6] text-tertiary">
        The first scan of <span className="font-mono text-secondary">{image}</span> pulls its layers and the vulnerability database, so it can take a minute. After that the result
        is cached for ten minutes.
      </p>
      <LogBlock lines={lines} />
    </div>
  );
}

function LogBlock({ lines, className = '' }: { lines: readonly string[]; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Pinned to the bottom: the interesting line is always the last one.
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);
  if (lines.length === 0) return null;
  return (
    <div
      ref={box}
      data-testid="scan-log"
      className={`max-h-[220px] overflow-y-auto rounded-lg border border-line bg-sunken p-2.5 font-mono text-[11px] leading-[1.7] text-tertiary ${className}`}
    >
      {lines.map((line, index) => (
        <div key={index} className="break-words [overflow-wrap:anywhere]">
          {line}
        </div>
      ))}
    </div>
  );
}
