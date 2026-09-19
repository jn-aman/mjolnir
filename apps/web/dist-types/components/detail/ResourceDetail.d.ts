import { bytes } from './parts.tsx';
/**
 * A detail pane for every kind that is not a Pod.
 *
 * Twenty-four kinds used to land on "a detailed view for this is not built
 * yet, the YAML tab has everything", which is true and useless: YAML is the
 * thing you read when the UI has given up. What a person actually wants from a
 * Service is which pods are behind it, from a Node whether it is full, from a
 * Role what it can actually do, and from a CronJob when it last ran and
 * whether that worked.
 *
 * So this is one dispatcher over per-kind renderers, all built from the same
 * pieces in parts.tsx. A kind with no renderer still gets metadata, labels,
 * annotations and owners, which is more than the old message and never lies.
 */
export interface DetailProps {
    readonly context: string;
    readonly kind: string;
    readonly item: KubeObject;
    readonly onNavigate?: ((target: {
        kind: string;
        name?: string;
        namespace?: string;
    }) => void) | undefined;
}
export interface KubeObject {
    metadata?: {
        name?: string;
        namespace?: string;
        uid?: string;
        labels?: Record<string, string>;
        annotations?: Record<string, string>;
        creationTimestamp?: string;
        finalizers?: string[];
        ownerReferences?: Array<{
            kind?: string;
            name?: string;
            controller?: boolean;
        }>;
        [key: string]: unknown;
    };
    spec?: Record<string, unknown>;
    status?: Record<string, unknown>;
    [key: string]: unknown;
}
export declare function ResourceDetail({ context, kind, item, onNavigate }: DetailProps): import("react").JSX.Element;
export { bytes };
//# sourceMappingURL=ResourceDetail.d.ts.map