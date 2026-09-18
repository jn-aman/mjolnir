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
    readonly threshold?: {
        readonly value: number;
        readonly label: string;
    };
    readonly ariaLabel: string;
}
export declare function TimeSeries({ series, height, format, threshold, ariaLabel }: TimeSeriesProps): import("react").JSX.Element;
/**
 * A single-series sparkline for a dense row.
 *
 * No axes, no legend, no hover — at 56×18 there is no room for any of it, and
 * the job is trend, not value. The number beside it carries the value.
 */
export declare function Sparkline({ points, tone, width, height, }: {
    points: readonly Point[];
    tone?: string;
    width?: number;
    height?: number;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=TimeSeries.d.ts.map