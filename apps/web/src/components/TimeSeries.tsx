import { useMemo, useRef, useState } from 'react';

/**
 * A multi-series line chart.
 *
 * Rules this follows, from the visualization method:
 *
 * - **One axis, always.** CPU and memory are two charts, never two y-scales on
 *   one. A dual-axis chart lets any two series be made to look correlated by
 *   choosing the scales, which is the single most common way a chart lies.
 * - **Direct labels on every series.** The categorical hues sit in the CVD warn
 *   band, which is only legal with a secondary encoding — so identity is never
 *   carried by colour alone.
 * - **Crosshair and tooltip by default.** An SVG chart in a desktop app is
 *   interactive; shipping it inert wastes the medium.
 * - Thin marks, recessive grid, text in text tokens rather than series colour.
 */

export interface Point {
  readonly t: number;
  readonly v: number;
}

export interface Series {
  readonly name: string;
  readonly points: readonly Point[];
}

interface TimeSeriesProps {
  readonly series: readonly Series[];
  readonly height?: number;
  /** Renders a value for the axis and tooltip. */
  readonly format: (value: number) => string;
  /** Drawn as a dashed reference line — a limit, a capacity, a target. */
  readonly threshold?: { readonly value: number; readonly label: string };
  readonly ariaLabel: string;
}

/**
 * Categorical slots, validated for both themes.
 *
 * Fixed order, never cycled: a series keeps its colour when the set is filtered,
 * so a chart that loses a line does not repaint the survivors.
 */
const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
] as const;

const PADDING = { top: 12, right: 68, bottom: 20, left: 46 };

export function TimeSeries({ series, height = 168, format, threshold, ariaLabel }: TimeSeriesProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Measured once per resize rather than per frame; a chart that re-measures on
  // pointer move is how a dashboard starts dropping frames.
  const measure = (node: HTMLDivElement | null) => {
    if (!node) return;
    hostRef.current = node;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
  };

  const { scaleX, scaleY, max, count } = useMemo(() => {
    const all = series.flatMap((entry) => entry.points);
    const highest = Math.max(threshold?.value ?? 0, ...all.map((point) => point.v), 0.0001);
    // A little headroom, so the peak is not welded to the top edge.
    const ceiling = highest * 1.12;
    const first = all[0]?.t ?? 0;
    const last = all.at(-1)?.t ?? first + 1;

    const plotWidth = Math.max(1, width - PADDING.left - PADDING.right);
    const plotHeight = Math.max(1, height - PADDING.top - PADDING.bottom);

    return {
      max: ceiling,
      count: series[0]?.points.length ?? 0,
      scaleX: (t: number) => PADDING.left + ((t - first) / Math.max(1, last - first)) * plotWidth,
      scaleY: (v: number) => PADDING.top + plotHeight - (v / ceiling) * plotHeight,
    };
  }, [series, width, height, threshold?.value]);

  const paths = useMemo(
    () =>
      series.map((entry) => ({
        name: entry.name,
        d: entry.points
          .map((point, index) => `${index === 0 ? 'M' : 'L'}${scaleX(point.t)},${scaleY(point.v)}`)
          .join(' '),
        last: entry.points.at(-1),
      })),
    [series, scaleX, scaleY],
  );

  const ticks = [0, 0.5, 1].map((fraction) => ({
    v: max * fraction,
    y: scaleY(max * fraction),
  }));

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const plotWidth = width - PADDING.left - PADDING.right;
    const fraction = (x - PADDING.left) / Math.max(1, plotWidth);
    const index = Math.round(fraction * (count - 1));
    setHoverIndex(index >= 0 && index < count ? index : null);
  };

  const hovered = hoverIndex === null ? null : series[0]?.points[hoverIndex];

  return (
    <div ref={measure} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverIndex(null)}
        className="block touch-none"
      >
        {/* Grid sits behind everything and stays recessive. */}
        {ticks.map((tick) => (
          <g key={tick.v}>
            <line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--border-subtle)"
              strokeWidth={1}
            />
            <text
              x={PADDING.left - 8}
              y={tick.y + 3}
              textAnchor="end"
              className="fill-[var(--text-tertiary)] font-mono text-[9.5px] tabular-nums"
            >
              {format(tick.v)}
            </text>
          </g>
        ))}

        {threshold ? (
          <g>
            <line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={scaleY(threshold.value)}
              y2={scaleY(threshold.value)}
              stroke="var(--status-warn)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={width - PADDING.right + 6}
              y={scaleY(threshold.value) + 3}
              className="fill-[var(--status-warn)] text-[9.5px]"
            >
              {threshold.label}
            </text>
          </g>
        ) : null}

        {hoverIndex !== null && hovered ? (
          <line
            x1={scaleX(hovered.t)}
            x2={scaleX(hovered.t)}
            y1={PADDING.top}
            y2={height - PADDING.bottom}
            stroke="var(--border-strong)"
            strokeWidth={1}
          />
        ) : null}

        {paths.map((path, index) => (
          <path
            key={path.name}
            d={path.d}
            fill="none"
            stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Direct labels — the secondary encoding these hues require. */}
        {paths.map((path) =>
          path.last ? (
            <text
              key={`${path.name}-label`}
              x={width - PADDING.right + 6}
              y={scaleY(path.last.v) + 3}
              className="fill-[var(--text-secondary)] font-mono text-[9.5px]"
            >
              {path.name.replace(/^ip-/, '')}
            </text>
          ) : null,
        )}

        {/* A ring of surface colour keeps overlapping markers readable. */}
        {hoverIndex !== null
          ? series.map((entry, index) => {
              const point = entry.points[hoverIndex];
              if (!point) return null;
              return (
                <circle
                  key={`${entry.name}-dot`}
                  cx={scaleX(point.t)}
                  cy={scaleY(point.v)}
                  r={4}
                  fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                  stroke="var(--surface-raised)"
                  strokeWidth={2}
                />
              );
            })
          : null}
      </svg>

      {hoverIndex !== null && hovered ? (
        <div
          role="status"
          className="pointer-events-none absolute top-2 rounded-md border border-line bg-overlay px-2.5 py-1.5 shadow-[var(--shadow-md)]"
          style={{
            left: Math.min(Math.max(scaleX(hovered.t) + 10, 8), Math.max(8, width - 190)),
          }}
        >
          <div className="mb-1 font-mono text-[10px] text-tertiary">
            {new Date(hovered.t).toLocaleTimeString()}
          </div>
          {series.map((entry, index) => {
            const point = entry.points[hoverIndex];
            if (!point) return null;
            return (
              <div key={entry.name} className="flex items-center gap-2 whitespace-nowrap">
                <span
                  aria-hidden
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}
                />
                <span className="flex-1 font-mono text-[11px] text-secondary">{entry.name}</span>
                <span className="font-mono text-[11px] tabular-nums text-primary">
                  {format(point.v)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A single-series sparkline for a dense row.
 *
 * No axes, no legend, no hover — at 56×18 there is no room for any of it, and
 * the job is trend, not value. The number beside it carries the value.
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
  if (points.length < 2) return <span className="text-[12.5px] text-tertiary">—</span>;

  const values = points.map((point) => point.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.0001);

  const d = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - 1 - ((point.v - min) / span) * (height - 2);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} aria-hidden className="block overflow-visible">
      <path d={d} fill="none" stroke={tone} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
