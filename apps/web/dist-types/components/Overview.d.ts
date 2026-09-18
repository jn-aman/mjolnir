/**
 * The cluster at a glance.
 *
 * CPU and memory are **two charts, never one with two y-axes**. A dual-axis
 * chart lets any pair of series be made to look correlated by choosing the
 * scales, which is the single most common way a chart misleads — and on an
 * infrastructure dashboard people make capacity decisions from it.
 */
interface OverviewProps {
    readonly context: string;
    readonly onOpenResources: () => void;
}
export declare function Overview({ context, onOpenResources }: OverviewProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Overview.d.ts.map