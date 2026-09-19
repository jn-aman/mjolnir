import { copyEntry, Menu, SEPARATOR, type MenuEntry } from './ui/ContextMenu.tsx';
import { formatDateTime, formatHourMinute, useTimezone } from '../lib/time.ts';
import { bisector, extent, max as d3max } from 'd3-array';
import { scaleLinear, scaleTime } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * A multi-series time chart.
 *
 * Rules this follows:
 *
 * - **One axis, always.** CPU and memory are two charts, never two y-scales on
 *   one. A dual-axis chart lets any two series be made to look correlated by
 *   picking the scales, and people size clusters off these.
 * - **Direct labels on every series**, because the categorical hues sit in the
 *   colour-vision-deficiency warn band and identity must never be carried by
 *   colour alone.
 * - **Every mark is a target.** Clicking a series opens the thing it describes.
 *   A chart that shows you a problem and then makes you go find it by hand is
 *   doing half its job.
 * - `curveMonotoneX` rather than a natural spline: monotone interpolation never
 *   overshoots, so the curve cannot invent a peak that is not in the data.
 */

export interface Point {
  readonly t: number;
  readonly v: number;
}

export interface Series {
  readonly name: string;
  readonly points: readonly Point[];
}

/** A period worth calling out, an incident, a deploy, a restart. */
export interface Band {
  readonly from: number;
  readonly to: number;
  readonly label: string;
}

interface TimeSeriesProps {
  readonly series: readonly Series[];
  readonly height?: number;
  readonly format: (value: number) => string;
  readonly bands?: readonly Band[];
  readonly ariaLabel: string;
  /** Called with a series name when its line, label or tooltip row is clicked. */
  readonly onSelect?: (name: string) => void;
}

const SERIES_VARS = ['--series-1', '--series-2', '--series-3', '--series-4'] as const;

const PADDING = { top: 14, right: 76, bottom: 22, left: 50 };

const bisect = bisector<Point, number>((point) => point.t).center;

export function TimeSeries({
  series,
  height = 180,
  format,
  bands = [],
  ariaLabel,
  onSelect,
}: TimeSeriesProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const zone = useTimezone((state) => state.zone);
  const [focused, setFocused] = useState<string | null>(null);

  const attach = useCallback((node: HTMLDivElement | null) => {
    hostRef.current = node;
  }, []);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { x, y, paths, areas, ticks } = useMemo(() => {
    const all = series.flatMap((entry) => [...entry.points]);
    const [from, to] = extent(all, (point) => point.t) as [number, number];
    const ceiling = (d3max(all, (point) => point.v) ?? 1) * 1.15;

    const scaleX = scaleTime()
      .domain([from ?? 0, to ?? 1])
      .range([PADDING.left, Math.max(PADDING.left + 1, width - PADDING.right)]);

    const scaleY = scaleLinear()
      .domain([0, ceiling || 1])
      .nice()
      .range([height - PADDING.bottom, PADDING.top]);

    const lineOf = line<Point>()
      .x((point) => scaleX(point.t))
      .y((point) => scaleY(point.v))
      .curve(curveMonotoneX);

    const areaOf = area<Point>()
      .x((point) => scaleX(point.t))
      .y0(height - PADDING.bottom)
      .y1((point) => scaleY(point.v))
      .curve(curveMonotoneX);

    return {
      x: scaleX,
      y: scaleY,
      ticks: scaleY.ticks(3),
      paths: series.map((entry) => ({
        name: entry.name,
        d: lineOf([...entry.points]) ?? '',
        last: entry.points.at(-1),
      })),
      areas: series.map((entry) => ({ name: entry.name, d: areaOf([...entry.points]) ?? '' })),
    };
  }, [series, width, height]);

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const points = series[0]?.points;
    if (!points?.length) return;
    const px = event.clientX - box.left;
    // Outside the plot area there is nothing to point at; clear rather than
    // pinning the crosshair to an edge.
    if (px < PADDING.left || px > width - PADDING.right) {
      setHover(null);
      return;
    }
    const t = x.invert(px).getTime();
    setHover(Math.min(Math.max(bisect([...points], t), 0), points.length - 1));
  };

  // Time ticks along the bottom: a chart of the last hour with no clock on it
  // cannot answer "when", which is the only question a time chart is for.
  const timeTicks = x.ticks(4);

  /**
   * Overlapping bands are merged.
   *
   * Two warnings a few seconds apart produce two bands in almost the same
   * place, and their labels then draw on top of each other, unreadable, and
   * worse than showing nothing. Merged bands carry a combined label instead.
   */
  const mergedBands = useMemo(() => {
    if (bands.length === 0) return [];
    const sorted = [...bands].sort((a, b) => a.from - b.from);
    const out: Array<{ from: number; to: number; labels: string[] }> = [];

    for (const band of sorted) {
      const last = out.at(-1);
      // 6% of the plot width: close enough that two labels would collide.
      const [start, end] = x.domain();
      const slack = ((end?.getTime() ?? 0) - (start?.getTime() ?? 0)) * 0.06;
      if (last && band.from <= last.to + slack) {
        last.to = Math.max(last.to, band.to);
        if (!last.labels.includes(band.label)) last.labels.push(band.label);
      } else {
        out.push({ from: band.from, to: band.to, labels: [band.label] });
      }
    }
    return out;
  }, [bands, x]);

  const hovered = hover === null ? null : series[0]?.points[hover];
  const id = useMemo(() => `ts-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <div
      ref={attach}
      className="relative w-full"
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        className="block touch-none select-none"
      >
        <defs>
          {series.map((entry, index) => {
            const colour = `var(${SERIES_VARS[index % SERIES_VARS.length]})`;
            return (
              <linearGradient key={entry.name} id={`${id}-${index}`} x1="0" y1="0" x2="0" y2="1">
                {/* Barely-there fill. Enough to give the line a body and read
                    magnitude; not enough to compete with the line itself. */}
                <stop offset="0%" stopColor={colour} stopOpacity={0.42} />
                <stop offset="55%" stopColor={colour} stopOpacity={0.12} />
                <stop offset="100%" stopColor={colour} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>

        {mergedBands.map((band) => {
          const left = x(band.from);
          const bandWidth = Math.max(3, x(band.to) - left);
          const label =
            band.labels.length > 2
              ? `${band.labels.length} warnings`
              : band.labels.join(' · ');
          // Labels flip to the left of the band when it sits near the right
          // edge, so they are never clipped by the plot area.
          const flip = left + 6 + label.length * 5 > width - PADDING.right;

          return (
            <g key={`${band.from}-${label}`}>
              <rect
                x={left}
                width={bandWidth}
                y={PADDING.top}
                height={height - PADDING.top - PADDING.bottom}
                fill="var(--status-error)"
                opacity={0.07}
              />
              <line
                x1={left}
                x2={left}
                y1={PADDING.top}
                y2={height - PADDING.bottom}
                stroke="var(--status-error)"
                strokeWidth={1}
                opacity={0.4}
              />
              <text
                x={flip ? left - 5 : left + bandWidth + 5}
                y={PADDING.top + 9}
                textAnchor={flip ? 'end' : 'start'}
                className="fill-[var(--status-error)] text-[9px] font-medium"
              >
                {label}
              </text>
            </g>
          );
        })}

        {timeTicks.map((tick) => (
          <text
            key={tick.getTime()}
            x={x(tick)}
            y={height - 6}
            textAnchor="middle"
            className="fill-[var(--text-tertiary)] font-mono text-[9.5px] tabular-nums"
          >
            {formatHourMinute(tick, zone)}
          </text>
        ))}

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border-subtle)"
              strokeWidth={1}
              strokeDasharray={tick === 0 ? undefined : '2 4'}
            />
            <text
              x={PADDING.left - 8}
              y={y(tick) + 3}
              textAnchor="end"
              className="fill-[var(--text-tertiary)] font-mono text-[9.5px] tabular-nums"
            >
              {format(tick)}
            </text>
          </g>
        ))}

        {areas.map((entry, index) => (
          <path
            key={entry.name}
            d={entry.d}
            fill={`url(#${id}-${index})`}
            className="mjolnir-fade-in"
            style={{ animationDelay: `${180 + index * 70}ms`, opacity: series.length === 1 ? 1 : 0.45 }}
          />
        ))}

        {hover !== null && hovered ? (
          <line
            x1={x(hovered.t)}
            x2={x(hovered.t)}
            y1={PADDING.top}
            y2={height - PADDING.bottom}
            stroke="var(--border-strong)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ) : null}

        {paths.map((path, index) => (
          <g key={path.name}>
            {/* A fat invisible stroke under the visible one: a 2px line is a
                2px hit target, which is unusable with a mouse. */}
            <path
              d={path.d}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              className={onSelect ? 'cursor-pointer' : undefined}
              onPointerEnter={() => setFocused(path.name)}
              onPointerLeave={() => setFocused(null)}
              onClick={() => onSelect?.(path.name)}
            />
            <path
              d={path.d}
              fill="none"
              stroke={`var(${SERIES_VARS[index % SERIES_VARS.length]})`}
              strokeWidth={focused === path.name ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={focused && focused !== path.name ? 0.35 : 1}
              pointerEvents="none"
              className="mjolnir-draw chart-glow"
              style={{
                color: `var(${SERIES_VARS[index % SERIES_VARS.length]})`,
                transition: 'opacity 160ms linear, stroke-width 160ms linear',
                animationDelay: `${index * 70}ms`,
              }}
            />
          </g>
        ))}

        {/* Direct labels, the secondary encoding these hues require, and the
            easiest thing to click when you want the node behind a line. */}
        {paths.map((path) =>
          path.last ? (
            <text
              key={`${path.name}-label`}
              x={width - PADDING.right + 8}
              y={y(path.last.v) + 3}
              onPointerEnter={() => setFocused(path.name)}
              onPointerLeave={() => setFocused(null)}
              onClick={() => onSelect?.(path.name)}
              className={`font-mono text-[9.5px] ${
                onSelect ? 'cursor-pointer' : ''
              } ${focused === path.name ? 'fill-[var(--text-primary)]' : 'fill-[var(--text-secondary)]'}`}
            >
              {path.name.replace(/^ip-/, '')}
            </text>
          ) : null,
        )}

        {hover !== null
          ? series.map((entry, index) => {
              const point = entry.points[hover];
              if (!point) return null;
              return (
                <circle
                  key={`${entry.name}-dot`}
                  cx={x(point.t)}
                  cy={y(point.v)}
                  r={4}
                  fill={`var(${SERIES_VARS[index % SERIES_VARS.length]})`}
                  stroke="var(--surface-raised)"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              );
            })
          : null}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1" data-testid="chart-legend">
        {series.map((entry, index) => {
          const latest = entry.points.at(-1);
          const dim = focused !== null && focused !== entry.name;
          const legendMenu: MenuEntry[] = [
            ...(onSelect ? [{ id: 'open', label: `Open ${entry.name}`, onSelect: () => onSelect(entry.name) }] : []),
            { id: 'solo', label: focused === entry.name ? 'Show all series' : 'Focus this series', onSelect: () => setFocused(focused === entry.name ? null : entry.name) },
            SEPARATOR,
            ...copyEntry('copy-name', 'Copy series name', entry.name),
            ...copyEntry('copy-value', 'Copy latest value', latest ? format(latest.v) : undefined),
          ];
          return (
            <Menu key={entry.name} label={entry.name} entries={legendMenu} testId="legend-menu">
            <button
              type="button"
              disabled={!onSelect}
              onPointerEnter={() => setFocused(entry.name)}
              onPointerLeave={() => setFocused(null)}
              onClick={() => onSelect?.(entry.name)}
              className={`flex items-center gap-2 rounded-full border border-line bg-raised px-2.5 py-1 text-left transition-[opacity,transform,box-shadow] duration-150 ${
                onSelect ? 'cursor-pointer hover:-translate-y-px hover:border-strong hover:shadow-[var(--shadow-sm)]' : 'cursor-default'
              }`}
              style={{ opacity: dim ? 0.4 : 1 }}
            >
              <span
                aria-hidden
                className="glow-dot"
                style={{ ['--dot' as string]: `var(${SERIES_VARS[index % SERIES_VARS.length]})` }}
              />
              <span className="font-mono text-[11px] text-secondary">{entry.name}</span>
              {latest ? (
                <span className="font-mono text-[11px] tabular-nums text-primary">{format(latest.v)}</span>
              ) : null}
            </button>
            </Menu>
          );
        })}
      </div>

      {hover !== null && hovered ? (
        <div
          role="status"
          className="pointer-events-none absolute top-3 z-10 rounded-lg border border-line bg-overlay p-2 shadow-[var(--shadow-lg)]"
          style={{ left: Math.min(Math.max(x(hovered.t) + 12, 8), Math.max(8, width - 210)) }}
        >
          <div className="mb-1.5 px-1 font-mono text-[10px] text-tertiary">
            {formatDateTime(hovered.t, zone)}
          </div>
          {[...series]
            .map((entry, index) => ({ entry, index, point: entry.points[hover] }))
            .sort((a, b) => (b.point?.v ?? 0) - (a.point?.v ?? 0))
            .map(({ entry, index, point }) =>
              point ? (
                <div
                  key={entry.name}
                  className="flex w-full items-center gap-2 whitespace-nowrap px-1 py-0.5"
                >
                  <span
                    aria-hidden
                    className="h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: `var(${SERIES_VARS[index % SERIES_VARS.length]})` }}
                  />
                  <span className="flex-1 font-mono text-[11px] text-secondary">{entry.name}</span>
                  <span className="font-mono text-[11px] tabular-nums text-primary">
                    {format(point.v)}
                  </span>
                </div>
              ) : null,
            )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A single-series sparkline for a dense row.
 *
 * No axes, no legend, no hover: at this size there is no room, and the job is
 * trend. The number beside it carries the value.
 */
export function Sparkline({
  points,
  tone = 'var(--accent-base)',
  width = 56,
  height = 18,
}: {
  points: readonly Point[];
  tone?: string;
  width?: number;
  height?: number;
}) {
  const d = useMemo(() => {
    if (points.length < 2) return null;
    const [from, to] = extent(points, (point) => point.t) as [number, number];
    const ceiling = d3max(points, (point) => point.v) ?? 1;
    const floor = Math.min(...points.map((point) => point.v));

    const x = scaleLinear().domain([from ?? 0, to ?? 1]).range([1, width - 1]);
    const y = scaleLinear().domain([floor, ceiling || 1]).range([height - 2, 2]);

    return line<Point>()
      .x((point) => x(point.t))
      .y((point) => y(point.v))
      .curve(curveMonotoneX)([...points]);
  }, [points, width, height]);

  if (!d) return <span className="text-[12.5px] text-tertiary">-</span>;

  return (
    <svg width={width} height={height} aria-hidden className="block overflow-visible">
      <path d={d} fill="none" stroke={tone} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
