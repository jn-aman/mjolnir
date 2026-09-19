import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search } from 'lucide-react';
import { OverflowTip } from '../ui/OverflowTip.tsx';

/**
 * A CSV as a table, which is what it is.
 *
 * Reading a 40-column export as monospace text with commas in it is a task
 * people do with their finger on the screen counting fields. The parser
 * handles quoting and embedded newlines properly, because the row that breaks
 * a naive split is always the row that matters.
 */

/** RFC 4180 with the usual tolerances: CRLF, quotes, doubled quotes inside quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (quoted) {
      if (char === '"') {
        if (text[at + 1] === '"') {
          field += '"';
          at += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (char === '\r') continue;
    field += char;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Comma, tab, semicolon or pipe, whichever wins on the first few lines. */
export function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 8000).split('\n').slice(0, 20).join('\n');
  const counts = [',', '\t', ';', '|'].map((candidate) => [candidate, sample.split(candidate).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',';
}

export function TableView({ text, testId = 'table-view' }: { text: string; testId?: string }) {
  const [needle, setNeedle] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { header, rows } = useMemo(() => {
    const parsed = parseDelimited(text, sniffDelimiter(text)).filter((row) => row.length > 1 || (row[0] ?? '') !== '');
    return { header: parsed[0] ?? [], rows: parsed.slice(1) };
  }, [text]);

  const visible = useMemo(() => {
    const lower = needle.trim().toLowerCase();
    if (!lower) return rows;
    return rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(lower)));
  }, [rows, needle]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 16,
  });

  const template = header.map(() => 'minmax(120px, 1fr)').join(' ');

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={testId}>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-1.5">
        <span className="relative flex min-w-0 flex-1 items-center">
          <Search size={12} strokeWidth={2} aria-hidden className="pointer-events-none absolute left-2 text-tertiary" />
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Filter rows"
            data-testid="table-search"
            className="h-[26px] w-full rounded-md border border-line bg-sunken pl-[26px] pr-2 font-mono text-[12px] text-primary outline-none placeholder:text-tertiary focus:border-strong"
          />
        </span>
        <span className="shrink-0 font-mono text-[11px] text-tertiary" data-testid="table-count">
          {visible.length === rows.length ? `${rows.length} rows` : `${visible.length} of ${rows.length}`} · {header.length} columns
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-max">
          <div
            role="row"
            className="sticky top-0 z-10 grid h-[30px] items-center border-b border-line bg-raised text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary"
            style={{ gridTemplateColumns: template }}
          >
            {header.map((cell, index) => (
              <OverflowTip key={index} className="flex items-center overflow-hidden px-2.5">
                {cell || `column ${index + 1}`}
              </OverflowTip>
            ))}
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const cells = visible[row.index];
              if (!cells) return null;
              return (
                <div
                  key={row.index}
                  role="row"
                  data-testid="table-row"
                  className="absolute inset-x-0 grid items-center border-b border-subtle font-mono text-[12px] text-secondary hover:bg-hover"
                  style={{ gridTemplateColumns: template, height: row.size, transform: `translateY(${row.start}px)` }}
                >
                  {header.map((_, index) => (
                    <OverflowTip key={index} className="flex items-center overflow-hidden px-2.5">
                      {cells[index] ?? ''}
                    </OverflowTip>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
