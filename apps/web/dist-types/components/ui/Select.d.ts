import type { ReactNode } from 'react';
/**
 * A select built on Radix, not a native `<select>`.
 *
 * A native select renders an **operating-system** popup: system fonts, system
 * colours, system corner radius, ignoring every token in the design system. On
 * a dense dark interface it lands like a hole punched through the app, and no
 * amount of styling the closed state fixes the open one, because the menu is
 * drawn by the OS and not by us.
 *
 * Radix gives us the menu as real DOM — so it inherits the tokens — while
 * keeping the keyboard and screen-reader behaviour a native select has and a
 * hand-rolled div never does: typeahead, arrow keys, Home/End, Escape, focus
 * return, and a correct `aria` tree.
 */
export interface SelectOption {
    readonly value: string;
    readonly label: string;
    /** Rendered to the right of the label — a count, a status, a hint. */
    readonly hint?: string | undefined;
    readonly icon?: ReactNode;
}
interface SelectProps {
    readonly label: string;
    readonly value: string;
    readonly options: readonly SelectOption[];
    readonly onChange: (value: string) => void;
    readonly testId?: string;
    /** Rendered in place of the default pill. */
    readonly trigger?: ReactNode;
    readonly align?: 'start' | 'end';
    readonly mono?: boolean;
}
export declare function Select({ label, value, options, onChange, testId, trigger, align, mono, }: SelectProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Select.d.ts.map