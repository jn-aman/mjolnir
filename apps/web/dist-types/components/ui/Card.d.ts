import type { ReactNode } from 'react';
interface CardProps {
    readonly title?: string;
    readonly subtitle?: string;
    readonly actions?: ReactNode;
    readonly children: ReactNode;
    readonly className?: string;
}
/** A panel. Border and surface only, no shadow at rest, no gradient, ever. */
export declare function Card({ title, subtitle, actions, children, className }: CardProps): import("react").JSX.Element;
interface StatProps {
    readonly label: string;
    readonly value: string;
    readonly hint?: string;
    readonly tone?: 'default' | 'ok' | 'warn' | 'error';
    /** Makes the tile a link to whatever the number counts. */
    readonly onClick?: (() => void) | undefined;
    /** Shows a placeholder instead of a number that is not known yet. */
    readonly loading?: boolean;
}
/**
 * A single number, given room.
 *
 * Not every measure deserves a chart. One value with no trend is a stat tile,
 * and drawing it as a one-bar chart wastes the space and says less.
 */
export declare function Stat({ label, value, hint, tone, onClick, loading }: StatProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Card.d.ts.map