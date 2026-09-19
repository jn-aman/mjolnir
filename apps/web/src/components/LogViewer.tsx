import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Download, Maximize2, Minimize2, MoreHorizontal, Regex, Search, WrapText } from 'lucide-react';
import { useLogStream } from '../lib/useLogStream.ts';
import { Button } from './ui/Button.tsx';
import { askEntry, copyEntry, Menu, SEPARATOR, type MenuEntry } from './ui/ContextMenu.tsx';
import { formatClock, formatDateTime, useTimezone } from '../lib/time.ts';
import { Select } from './ui/Select.tsx';

/**
 * The log viewer.
 *
 * Three behaviours here are the reason this exists rather than a `<pre>`:
 *
 * 1. **Follow pauses when you scroll up** and resumes when you ask. A tail that
 *    yanks you back to the bottom mid-read is unusable, and one that silently
 *    stops following is worse.
 * 2. **Highlight and filter are different modes.** Highlight tints matches and
 *    keeps the surrounding lines; filter hides everything else. Every tool
 *    collapses these into one, and they are different tasks.
 * 3. **Previous-container logs.** When the current container has written
 *    nothing because it is crash-looping, the dead one explains why.
 *
 * Rows are virtualized and never animated, easing a log line into view
 * misstates when it arrived.
 */

const ANSI = new RegExp(
  `[${String.fromCharCode(0x1b)}${String.fromCharCode(0x9b)}][[\\]()#;?]*` +
    `(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?${String.fromCharCode(0x07)}` +
    `|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~])`,
  'g',
);

const LEVEL = /\b(ERROR|FATAL|PANIC|WARN|WARNING|INFO|DEBUG|TRACE)\b/;

const LEVEL_TOKEN: Record<string, string> = {
  ERROR: 'var(--log-error)',
  FATAL: 'var(--log-error)',
  PANIC: 'var(--log-error)',
  WARN: 'var(--log-warn)',
  WARNING: 'var(--log-warn)',
  INFO: 'var(--log-info)',
  DEBUG: 'var(--log-debug)',
  TRACE: 'var(--log-debug)',
};

const ROW = 19;

interface LogViewerProps {
  readonly source?: 'kubernetes' | 'docker' | undefined;
  readonly context: string;
  readonly namespace: string;
  readonly pod: string;
  readonly containers: string[];
  readonly expanded?: boolean;
  /**
   * One row of controls instead of a wrapping block.
   *
   * In the dock the whole viewer is a few hundred pixels tall, and a toolbar
   * that wraps to two rows takes half of it: three log lines under a control
   * panel is not a log viewer. Compact keeps the search and the follow state,
   * which are the two things anyone touches, and moves the rest behind a
   * menu.
   */
  readonly compact?: boolean;
  readonly onToggleExpand?: () => void;
  readonly initialContainer?: string | undefined;
  readonly initialPrevious?: boolean | undefined;
}

export function LogViewer({
  source,
  context,
  namespace,
  pod,
  containers,
  expanded = false,
  compact = false,
  onToggleExpand,
  initialContainer,
  initialPrevious,
}: LogViewerProps) {
  const zone = useTimezone((state) => state.zone);
  const [container, setContainer] = useState(initialContainer ?? containers[0] ?? '');
  const [previous, setPrevious] = useState(initialPrevious ?? false);
  const [query, setQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [mode, setMode] = useState<'highlight' | 'filter'>('highlight');
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const { lines, state, error } = useLogStream({
    source,
    context,
    namespace,
    pod,
    container,
    previous,
    follow: !previous,
    tailLines: 500,
  });

  const matcher = useMemo(() => {
    if (!query) return null;
    try {
      return new RegExp(useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch {
      // A half-typed regex is not an error state, it just matches nothing yet.
      return null;
    }
  }, [query, useRegex]);

  const rows = useMemo(() => {
    const cleaned = lines.map((line) => ({ ...line, message: line.message.replace(ANSI, '') }));
    if (mode !== 'filter' || !matcher) return cleaned;
    return cleaned.filter((line) => matcher.test(line.message));
  }, [lines, matcher, mode]);

  const matchCount = useMemo(() => {
    if (!matcher) return 0;
    return lines.reduce((total, line) => (matcher.test(line.message) ? total + 1 : total), 0);
  }, [lines, matcher]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 24,
  });

  // A wrapped line is taller than one row, so rows must be measured rather than
  // estimated, otherwise long lines draw on top of each other, which is
  // exactly what happens to stack traces, the lines you most need to read.
  // TanStack's own measureElement reads data-index off the node; a replacement
  // that returns only a height cannot associate the measurement with a row.
  useEffect(() => {
    virtualizer.measure();
  }, [wrap, virtualizer]);

  // Follow means "stay pinned to the bottom". Scrolling away turns it off;
  // scrolling back to the bottom does not turn it back on, because an implicit
  // resume is how you lose your place a second time.
  useEffect(() => {
    if (!follow || rows.length === 0) return;
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
  }, [rows.length, follow, virtualizer]);

  useEffect(() => {
    if (!expanded || !onToggleExpand) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggleExpand();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, onToggleExpand]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    if (!atBottom && stickRef.current) {
      stickRef.current = false;
      setFollow(false);
    } else if (atBottom) {
      stickRef.current = true;
    }
  };

  const download = () => {
    const text = rows
      .map((line) => `${line.timestamp?.toISOString() ?? ''} ${line.message}`)
      .join('\n');
    // A Blob, not a data: URI, the URI form silently truncates past a few MB,
    // which is exactly the size of log anyone bothers to download.
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${pod}${container ? `-${container}` : ''}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="log-viewer">
      <div className={`flex shrink-0 items-center gap-2 border-b border-line bg-raised ${compact ? 'h-[36px] flex-nowrap overflow-hidden px-2' : 'flex-wrap px-3 py-2'}`}>
        {containers.length > 1 ? (
          <Select
            label="Container"
            value={container}
            onChange={setContainer}
            options={containers.map((name) => ({ value: name, label: name }))}
            testId="log-container"
            mono
          />
        ) : null}

        <div className="flex h-[30px] min-w-[220px] flex-1 items-center gap-2 rounded-md border border-line bg-sunken px-2.5 focus-within:border-focus">
          <Search size={13} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />
          <label htmlFor="log-search" className="sr-only">
            Search logs
          </label>
          <input
            id="log-search"
            data-testid="log-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-primary outline-none placeholder:text-tertiary"
          />
          {query ? (
            <span data-testid="log-match-count" className="shrink-0 font-mono text-[11px] tabular-nums text-tertiary">
              {matchCount}
            </span>
          ) : null}
          <button
            type="button"
            data-testid="log-regex-toggle"
            onClick={() => setUseRegex((value) => !value)}
            aria-label="Regular expression"
            aria-pressed={useRegex}
            className={`shrink-0 rounded-xs p-0.5 ${useRegex ? 'text-accent' : 'text-tertiary hover:text-secondary'}`}
          >
            <Regex size={13} strokeWidth={2} />
          </button>
        </div>

        {compact ? (
          // Everything the compact bar has no room for, in one menu, so
          // nothing is lost by making the viewer short.
          <Menu
            label="Logs"
            testId="log-more-menu"
            entries={[
              { id: 'mode-highlight', label: mode === 'highlight' ? 'Marking matches' : 'Mark matches', onSelect: () => setMode('highlight') },
              { id: 'mode-filter', label: mode === 'filter' ? 'Showing only matches' : 'Only matches', onSelect: () => setMode('filter') },
              SEPARATOR,
              { id: 'current', label: previous ? 'Current container' : 'Current container \u00b7 showing', onSelect: () => setPrevious(false) },
              { id: 'previous', label: previous ? 'Previous container \u00b7 showing' : 'Previous container', onSelect: () => setPrevious(true) },
              SEPARATOR,
              { id: 'wrap', label: wrap ? 'Stop wrapping lines' : 'Wrap lines', onSelect: () => setWrap((value) => !value) },
              { id: 'download', label: 'Download these logs', onSelect: download },
              ...(onToggleExpand ? [{ id: 'expand', label: 'Open full screen', onSelect: onToggleExpand }] : []),
            ]}
          >
            <button
              type="button"
              data-testid="log-more"
              aria-label="More log options"
              className="flex h-[24px] shrink-0 items-center gap-1 rounded-md border border-line bg-sunken px-2 text-[11.5px] text-secondary hover:border-strong hover:text-primary"
            >
              {previous ? <span className="text-error">previous</span> : null}
              {mode === 'filter' ? <span className="text-accent">filtered</span> : null}
              <MoreHorizontal size={13} strokeWidth={2} aria-hidden />
            </button>
          </Menu>
        ) : null}

        {compact ? null : (
        <Segmented
          value={mode}
          onChange={(value) => setMode(value as 'highlight' | 'filter')}
          options={[
            { value: 'highlight', label: 'Mark matches' },
            { value: 'filter', label: 'Only matches' },
          ]}
        />
        )}

        {/*
          Shown in the dock too, unlike the other controls here.
          
          Logs live in the dock now, and this is the control a crash loop
          needs: the current container has not started, so its logs are empty,
          and the output that explains the crash belongs to the run that
          already ended. Leaving it in an overflow menu hides the one button
          the feature exists for, at the one moment somebody is looking for it.
        */}
        <Segmented
          value={previous ? 'previous' : 'current'}
          onChange={(value) => setPrevious(value === 'previous')}
          tone={previous ? 'error' : 'default'}
          testId="log-previous-group"
          options={[
            { value: 'current', label: 'Current' },
            { value: 'previous', label: 'Previous' },
          ]}
        />

        <button
          type="button"
          data-testid="log-follow"
          data-active={follow}
          onClick={() => {
            stickRef.current = true;
            setFollow(true);
          }}
          disabled={previous}
          className={`inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium disabled:opacity-40 ${
            follow
              ? 'border-[var(--status-ok-border)] bg-ok-bg text-ok'
              : 'border-line bg-sunken text-secondary hover:border-strong'
          }`}
          style={{ transitionProperty: 'background-color, border-color, color', transitionDuration: '90ms' }}
        >
          {follow ? (
            <span
              aria-hidden
              className="h-[6px] w-[6px] rounded-full bg-current"
              style={{ animation: 'mjolnir-pulse 2.4s ease-in-out infinite' }}
            />
          ) : (
            <ArrowDown size={12} strokeWidth={2.4} aria-hidden />
          )}
          {follow ? 'Following' : 'Paused'}
        </button>

        {compact ? null : (
        <Button
          iconOnly
          aria-label="Wrap lines"
          onClick={() => setWrap((value) => !value)}
          variant={wrap ? 'secondary' : 'ghost'}
          icon={<WrapText size={14} strokeWidth={1.9} />}
        />
        )}
        {compact ? null : (
        <Button
          iconOnly
          aria-label="Download logs"
          onClick={download}
          icon={<Download size={14} strokeWidth={1.9} />}
        />
        )}
        {onToggleExpand && !compact ? (
          <Button
            iconOnly
            data-testid="log-expand"
            aria-label={expanded ? 'Exit full screen' : 'Full screen'}
            onClick={onToggleExpand}
            icon={
              expanded ? (
                <Minimize2 size={14} strokeWidth={1.9} />
              ) : (
                <Maximize2 size={14} strokeWidth={1.9} />
              )
            }
          />
        ) : null}
      </div>

      {previous ? (
        <div className="shrink-0 border-b border-[var(--status-error-border)] bg-error-bg px-3 py-2 text-[12px] text-error">
          Showing the previous container. The running one has written nothing yet.
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-testid="log-body"
        className="min-h-0 flex-1 overflow-auto bg-sunken py-1"
      >
        {state === 'connecting' && rows.length === 0 ? (
          <Empty>Connecting…</Empty>
        ) : error ? (
          <Empty tone="error">{error}</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            {query && mode === 'filter' ? (
              `Nothing matches “${query}”.`
            ) : previous ? (
              'The previous container wrote nothing.'
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="m-0 max-w-[320px] text-[13px] text-secondary">
                  This container has written nothing yet.
                </p>
                <p className="m-0 max-w-[340px] text-[12px] text-tertiary">
                  If it is restarting, the instance that failed is the one with the
                  answer.
                </p>
                <Button variant="secondary" onClick={() => setPrevious(true)}>
                  Show the previous container
                </Button>
              </div>
            )}
          </Empty>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const line = rows[item.index];
              if (!line) return null;
              const level = LEVEL.exec(line.message)?.[1];
              // The level gets its own column, so strip it from the message -
              // otherwise every warning reads "WARN WARN ...".
              const body = level
                ? line.message.replace(new RegExp(`^\\s*${level}\\s+`), '')
                : line.message;
              const hit = mode === 'highlight' && matcher?.test(line.message);
              // A continuation line, a stack frame, dims so the eye lands on
              // the error above it rather than five equally loud frames.
              const continuation = /^\s{4,}at\s/.test(line.message);

              const json = body.trimStart().startsWith('{') ? body.trim() : undefined;
              const lineMenu: MenuEntry[] = [
                askEntry('Explain this log line', `Explain this log line from pod ${pod} in namespace ${namespace} and whether it matters:\n\n${line.message.slice(0, 1500)}`),
                SEPARATOR,
                ...copyEntry('copy-line', 'Copy line', line.message),
                ...copyEntry('copy-json', 'Copy as JSON', json),
                ...copyEntry('copy-time', 'Copy timestamp', line.timestamp?.toISOString()),
                SEPARATOR,
                ...(onToggleExpand && !expanded
                  ? [{ id: 'expand', label: 'Open full screen', onSelect: onToggleExpand }]
                  : []),
              ];

              return (
                <Menu key={line.seq} entries={lineMenu} testId="log-menu">
                <div
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  data-testid="log-line"
                  className="absolute inset-x-0 flex items-baseline gap-0 px-3 font-mono text-[12.5px]"
                  style={{
                    ...(wrap ? {} : { height: item.size }),
                    minHeight: ROW,
                    lineHeight: `${ROW}px`,
                    transform: `translateY(${item.start}px)`,
                    background: hit ? 'var(--log-highlight)' : undefined,
                  }}
                >
                  <span
                    className="w-[86px] shrink-0 select-none text-[var(--log-time)]"
                    title={line.timestamp ? formatDateTime(line.timestamp, zone) : undefined}
                  >
                    {line.timestamp ? formatClock(line.timestamp, zone) : ''}
                  </span>
                  <span
                    className="w-[52px] shrink-0 font-medium"
                    style={{ color: level ? LEVEL_TOKEN[level] : 'transparent' }}
                  >
                    {level ?? ''}
                  </span>
                  <span
                    className={wrap ? 'min-w-0 flex-1 whitespace-pre-wrap break-words' : 'flex-1 whitespace-pre'}
                    style={{
                      color: continuation ? 'var(--log-debug)' : 'var(--log-body)',
                    }}
                  >
                    {body}
                  </span>
                </div>
                </Menu>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-raised px-3 font-mono text-[11px] text-tertiary">
        <span data-testid="log-count">{rows.length} lines</span>
        {state === 'streaming' ? <span className="text-ok">streaming</span> : null}
        {state === 'ended' && !previous ? <span>ended</span> : null}
      </div>
    </div>
  );
}

function Empty({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div
      className={`flex h-full items-center justify-center p-8 text-[13px] ${
        tone === 'error' ? 'text-error' : 'text-tertiary'
      }`}
    >
      {children}
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
  tone = 'default',
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  tone?: 'default' | 'error';
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`flex shrink-0 rounded-md border bg-sunken p-[3px] ${
        tone === 'error' ? 'border-[var(--status-error-border)]' : 'border-line'
      }`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            data-testid={`seg-${option.value}`}
            data-active={active}
            onClick={() => onChange(option.value)}
            className={`rounded-sm px-2.5 py-[3px] text-[12px] font-medium ${
              active
                ? tone === 'error'
                  ? 'bg-error-bg text-error'
                  : 'bg-pressed text-primary'
                : 'text-secondary hover:text-primary'
            }`}
            style={{ transitionProperty: 'background-color, color', transitionDuration: '90ms' }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
