import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
interface CardProps {
    readonly title?: string;
    readonly subtitle?: string;
    readonly icon?: LucideIcon | undefined;
    readonly tint?: string | undefined;
    readonly actions?: ReactNode;
    readonly children: ReactNode;
    readonly className?: string;
    /** Lifts on hover, for cards that open something. */
    readonly interactive?: boolean;
}
/** A panel with depth: lit top edge, soft shadow, an icon chip when it has a subject. */
export declare function Card({ title, subtitle, icon: Icon, tint, actions, children, className, interactive }: CardProps): import("react").JSX.Element;
interface StatProps {
    readonly label: string;
    readonly value: string;
    readonly hint?: string;
    readonly tone?: 'default' | 'ok' | 'warn' | 'error';
    readonly icon?: LucideIcon | undefined;
    /** A small trend under the number, e.g. "+2 in the last hour". */
    readonly trend?: ReactNode;
    readonly onClick?: (() => void) | undefined;
    readonly loading?: boolean;
}
/**
 * A single number, given room and light. The tone colours a soft glow in
 * the corner and the icon chip; the number stays the loudest thing.
 */
export declare function Stat({ label, value, hint, tone, icon: Icon, trend, onClick, loading }: StatProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Card.d.ts.map