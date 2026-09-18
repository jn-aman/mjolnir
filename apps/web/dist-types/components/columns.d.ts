import type { ReactNode } from 'react';
/**
 * The column registry.
 *
 * One declaration per column, ordered by priority, looked up by kind. This is
 * what lets 28 resource kinds share one list component — and it is the specific
 * thing whose absence produced a 704-line `ResourceViewer` in the app this
 * replaces. Adding a kind is a row in a table, not a screen.
 *
 * Adapted from Freelens's column contract (MIT), minus the dependency-injection
 * machinery it is wrapped in there.
 */
export interface Column<T = KubeItem> {
    readonly id: string;
    /** Lower sorts earlier. Gaps are intentional so columns can be slotted in. */
    readonly priority: number;
    readonly header: string;
    /** CSS width. Fixed widths keep columns aligned down a long list. */
    readonly width: string;
    readonly align?: 'left' | 'right';
    readonly content: (item: T) => ReactNode;
    /** Sort key. Omit to make the column unsortable. */
    readonly sortBy?: (item: T) => string | number;
    /** Extra text the quick filter should match, beyond the name. */
    readonly searchText?: (item: T) => string | undefined;
}
export interface KubeItem {
    metadata?: {
        name?: string;
        namespace?: string;
        creationTimestamp?: string;
        labels?: Record<string, string>;
    };
    status?: Record<string, unknown>;
    spec?: Record<string, unknown>;
}
/**
 * Relative age, rendered the way kubectl does.
 *
 * Coarse on purpose: nobody needs "2 hours, 14 minutes" in a list, and the
 * precision invites reading meaning into noise.
 */
export declare function age(timestamp: string | undefined): string;
interface ContainerStatus {
    ready?: boolean;
    restartCount?: number;
    state?: {
        waiting?: {
            reason?: string;
        };
        terminated?: {
            reason?: string;
        };
    };
}
interface PodItem extends KubeItem {
    status?: {
        phase?: string;
        containerStatuses?: ContainerStatus[];
        conditions?: Array<{
            type?: string;
            reason?: string;
        }>;
    };
    spec?: {
        nodeName?: string;
        containers?: Array<{
            name?: string;
        }>;
    };
}
/**
 * A pod's real status.
 *
 * `phase` alone is misleading: a CrashLoopBackOff pod reports `Running`. The
 * waiting reason on a container is the truth, and showing anything else is how
 * a dashboard tells you a broken pod is fine.
 */
export declare function podStatus(pod: PodItem): string;
/** Columns for a kind, priority-ordered, falling back to name/namespace/age. */
export declare function columnsFor(kind: string): Array<Column<KubeItem>>;
export {};
//# sourceMappingURL=columns.d.ts.map