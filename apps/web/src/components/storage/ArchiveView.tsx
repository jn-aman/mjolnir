import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Download, File, Folder, Search } from 'lucide-react';
import { readZipEntry, zipFolders, type ZipEntry } from '../../lib/zip.ts';
import { formatBytes } from '../columns.tsx';
import { formatDateTime } from '../../lib/time.ts';
import { EmptyState } from '../ui/States.tsx';
import { Tip } from '../ui/Tooltip.tsx';

/**
 * Inside the archive, without leaving.
 *
 * A zip in a bucket is a folder someone wrapped for transport, and until now
 * the only thing Mjolnir could say about one was how many bytes it is. It is
 * browsed exactly like the bucket around it: folders, a filter, and a click
 * that opens the entry in the same viewer as everything else, so a JSON file
 * inside a build artefact gets the same tree as a JSON file beside it.
 */
export function ArchiveView({
  entries,
  buffer,
  onOpen,
  prefix,
  onPrefix,
}: {
  entries: readonly ZipEntry[];
  buffer: ArrayBuffer;
  onOpen: (entry: ZipEntry, bytes: Uint8Array) => void;
  /**
   * Held by the viewer above, not here. Opening an entry unmounts this, and
   * coming back to the top of a deep archive after reading one file in it is
   * the same as losing your place.
   */
  prefix: string;
  onPrefix: (next: string) => void;
}) {
  const [needle, setNeedle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { folders, files } = useMemo(() => zipFolders(entries, prefix), [entries, prefix]);
  const lower = needle.trim().toLowerCase();
  const shownFolders = lower ? [] : folders;
  const shownFiles = useMemo(
    () => (lower ? entries.filter((entry) => !entry.directory && entry.name.toLowerCase().includes(lower)) : files),
    [lower, entries, files],
  );

  const crumbs = prefix.split('/').filter(Boolean);
  const total = entries.filter((entry) => !entry.directory).length;
  const uncompressed = entries.reduce((sum, entry) => sum + entry.size, 0);

  const open = async (entry: ZipEntry) => {
    setBusy(entry.name);
    setError(null);
    try {
      onOpen(entry, await readZipEntry(buffer, entry));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const save = async (entry: ZipEntry) => {
    try {
      const bytes = await readZipEntry(buffer, entry);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      const link = document.createElement('a');
      link.href = url;
      link.download = entry.name.split('/').pop() ?? entry.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="archive-view">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-1.5">
        {prefix ? (
          <Tip label="Up one folder">
            <button
              type="button"
              aria-label="Up one folder"
              onClick={() => onPrefix(crumbs.slice(0, -1).map((part) => `${part}/`).join(''))}
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
            >
              <ArrowLeft size={13} strokeWidth={2} />
            </button>
          </Tip>
        ) : null}
        <nav className="flex min-w-0 shrink items-center gap-0.5 overflow-hidden font-mono text-[12px]" aria-label="Path inside the archive">
          <button type="button" onClick={() => onPrefix('')} className="shrink-0 rounded-xs px-1 text-secondary hover:bg-hover hover:text-primary">
            archive
          </button>
          {crumbs.map((part, index) => (
            <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight size={12} className="shrink-0 text-tertiary" aria-hidden />
              <button
                type="button"
                onClick={() => onPrefix(crumbs.slice(0, index + 1).map((entry) => `${entry}/`).join(''))}
                className="max-w-[160px] truncate rounded-xs px-1 text-secondary hover:bg-hover hover:text-primary"
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
        <span className="relative flex w-[220px] shrink-0 items-center">
          <Search size={12} strokeWidth={2} aria-hidden className="pointer-events-none absolute left-2 text-tertiary" />
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Search the whole archive"
            data-testid="archive-search"
            className="h-[26px] w-full rounded-md border border-line bg-sunken pl-[26px] pr-2 font-mono text-[12px] text-primary outline-none placeholder:text-tertiary focus:border-strong"
          />
        </span>
        <div className="flex-1" />
        <span className="shrink-0 font-mono text-[11px] text-tertiary" data-testid="archive-count">
          {total} files · {formatBytes(uncompressed)} unpacked
        </span>
      </div>

      {error ? <div className="shrink-0 border-b border-[var(--status-error-border)] bg-error-bg px-3 py-2 text-[12.5px] text-error">{error}</div> : null}

      {shownFolders.length === 0 && shownFiles.length === 0 ? (
        <EmptyState
          testId="archive-empty"
          title={lower ? `Nothing in the archive matches “${needle.trim()}”` : 'This folder is empty'}
          detail={lower ? 'The search covers every path in the archive, not only this folder.' : 'The archive records it, but it holds no files.'}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {shownFolders.map((folder) => (
            <button
              key={folder}
              type="button"
              data-testid="archive-folder"
              onClick={() => onPrefix(`${prefix}${folder}`)}
              className="flex w-full items-center gap-2.5 border-b border-subtle px-3 py-[9px] text-left hover:bg-hover"
            >
              <Folder size={13} strokeWidth={1.9} aria-hidden className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-primary">{folder.replace(/\/$/, '')}</span>
            </button>
          ))}
          {shownFiles.map((entry) => (
            <div
              key={entry.name}
              data-testid="archive-file"
              className="group/row flex items-center gap-2.5 border-b border-subtle px-3 py-[9px] hover:bg-hover"
            >
              <File size={13} strokeWidth={1.9} aria-hidden className="shrink-0 text-tertiary" />
              <button
                type="button"
                onClick={() => void open(entry)}
                disabled={busy !== null}
                className="min-w-0 flex-1 truncate text-left font-mono text-[12.5px] text-primary hover:text-accent disabled:opacity-60"
                title={entry.name}
              >
                {lower ? entry.name : (entry.name.slice(prefix.length) || entry.name)}
              </button>
              {busy === entry.name ? <span className="shrink-0 text-[11px] text-tertiary">opening…</span> : null}
              <span className="w-[86px] shrink-0 text-right font-mono text-[11.5px] text-tertiary">{formatBytes(entry.size)}</span>
              <span className="w-[150px] shrink-0 text-right font-mono text-[11.5px] text-tertiary">
                {entry.modified ? formatDateTime(entry.modified.toISOString()) : ''}
              </span>
              <Tip label="Save this entry" hint="Extracted here, without downloading the whole archive">
                <button
                  type="button"
                  aria-label={`Save ${entry.name}`}
                  onClick={() => void save(entry)}
                  className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
                >
                  <Download size={12} strokeWidth={1.9} />
                </button>
              </Tip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
