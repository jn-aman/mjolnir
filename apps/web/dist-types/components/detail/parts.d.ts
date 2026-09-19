import type { ReactNode } from 'react';
/**
 * The pieces every detail pane is built from.
 *
 * One vocabulary across twenty-seven kinds, so a Node and a RoleBinding read
 * the same way: a titled section, a two-column field list, chips for anything
 * repeated, a table for anything with rows, and a bar for anything that is a
 * share of a total. Kind-specific cleverness goes in the renderer; the shapes
 * live here, and none of them can drift apart.
 */
export declare function Section({ title, hint, action, children }: {
    title: string;
    hint?: string;
    action?: ReactNode;
    children: ReactNode;
}): import("react").JSX.Element;
export type FieldRow = readonly [label: string, value: ReactNode, mono?: boolean];
export declare function Fields({ rows }: {
    rows: readonly (FieldRow | null | false)[];
}): import("react").JSX.Element | null;
/** A key=value pill. Used for labels, annotations, selectors and node labels. */
export declare function Chips({ values, empty }: {
    values: Record<string, string> | undefined;
    empty?: string;
}): import("react").JSX.Element;
/** A flat list of strings as pills, for taints, finalizers, access modes. */
export declare function Tags({ values, tint, empty }: {
    values: readonly string[];
    tint?: string;
    empty?: string;
}): import("react").JSX.Element;
/**
 * A table, for anything with rows: ports, rules, subjects, conditions.
 *
 * Built here rather than reusing the virtualised list, because a detail pane
 * has ten rows and no need for a scroll container, a filter or a header menu.
 */
export declare function Table({ head, rows, empty, align, }: {
    head: readonly string[];
    rows: readonly (readonly ReactNode[])[];
    empty?: string;
    align?: readonly ('left' | 'right')[];
}): import("react").JSX.Element;
/** A share of a total, with the numbers beside it rather than in a tooltip. */
export declare function Bar({ label, used, total, unit, tint }: {
    label: string;
    used: number;
    total: number;
    unit?: string;
    tint?: string;
}): import("react").JSX.Element;
export interface ConditionShape {
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
    lastUpdateTime?: string;
}
/**
 * Conditions, with the interesting ones first.
 *
 * Kubernetes reports conditions in whatever order the controller wrote them,
 * and the one that matters is almost always the one that is false. So anything
 * unhealthy sorts to the top: the point of this block is to answer "what is
 * wrong" without reading nine rows of True.
 */
export declare function Conditions({ conditions }: {
    conditions: readonly ConditionShape[] | undefined;
}): import("react").JSX.Element;
/** A link to another object, with its kind mark. The way you walk the graph. */
export declare function RefChip({ kind, name, hint, onOpen, testId, }: {
    kind: string;
    name: string;
    hint?: string | undefined;
    onOpen?: (() => void) | undefined;
    testId?: string;
}): import("react").JSX.Element;
export declare function Callout({ tone, title, children }: {
    tone: 'error' | 'warn' | 'info';
    title: string;
    children?: ReactNode;
}): import("react").JSX.Element;
/** Kubernetes quantities: 100m, 2, 1Gi, 500Mi, 1e3. Returned in base units. */
export declare function parseQuantity(value: string | undefined): number;
export declare function bytes(value: number): string;
//# sourceMappingURL=parts.d.ts.map