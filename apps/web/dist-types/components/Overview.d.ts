/**
 * The cluster at a glance.
 *
 * CPU and memory are **two charts, never one with two y-axes**. A dual-axis
 * chart lets any pair of series be made to look correlated by choosing the
 * scales, which is the single most common way a chart misleads, and on an
 * infrastructure dashboard people make capacity decisions from it.
 */
export interface NavigateTarget {
    readonly kind: string;
    readonly name?: string;
    readonly namespace?: string;
    readonly filter?: string;
    /** Set when the target is a workspace rather than a kind. */
    readonly workspace?: string;
}
interface OverviewProps {
    readonly context: string;
    /** The cluster as the kubeconfig describes it, for the hero. */
    readonly cluster?: {
        name: string;
        server?: string | null | undefined;
        provider: string;
    } | undefined;
    /** Called after the display name or colour is changed, so the strip updates. */
    readonly onDecorChanged?: (() => void) | undefined;
    /**
     * Opens the thing that was clicked.
     *
     * Every number, line and row on this screen is about a specific object, so
     * every one of them is a link to it. A dashboard that shows you a problem and
     * then makes you go find it by hand is doing half its job.
     */
    readonly onNavigate: (target: NavigateTarget) => void;
}
export declare function Overview({ context, cluster, onDecorChanged, onNavigate }: OverviewProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Overview.d.ts.map