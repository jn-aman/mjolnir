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
/** A period worth calling out — an incident, a deploy, a restart. */
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
export declare function TimeSeries({ series, height, format, bands, ariaLabel, onSelect, }: TimeSeriesProps): import("react").JSX.Element;
/**
 * A single-series sparkline for a dense row.
 *
 * No axes, no legend, no hover: at this size there is no room, and the job is
 * trend. The number beside it carries the value.
 */
export declare function Sparkline({ points, tone, width, height, }: {
    points: readonly Point[];
    tone?: string;
    width?: number;
    height?: number;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=TimeSeries.d.ts.map