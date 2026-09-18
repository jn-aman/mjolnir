import type { ReactNode } from 'react';
/**
 * The right-click menu, once.
 *
 * Everything in Mjolnir that names a thing, a row, a cluster tile, a label
 * chip, a log line, a legend entry, a stat tile, carries one of these. A
 * context menu is a shortcut, never the only route: every action here is also
 * reachable from a visible control, because an action that exists only behind
 * right-click is an action most people never find.
 *
 * Entries are data, not JSX, so callers describe *what* can be done and this
 * component owns how a menu looks, animates and separates its groups. Runs of
 * separators collapse and edge separators are dropped, so callers can build
 * lists conditionally without counting.
 */
export interface MenuItem {
    readonly type?: 'item';
    readonly id: string;
    readonly label: string;
    readonly icon?: ReactNode;
    readonly shortcut?: string;
    readonly danger?: boolean;
    readonly disabled?: boolean;
    readonly onSelect: () => void;
}
export type MenuEntry = MenuItem | {
    readonly type: 'separator';
} | {
    readonly type: 'heading';
    readonly label: string;
};
export declare const SEPARATOR: MenuEntry;
/** Writes to the clipboard and says so; silent copying leaves people clicking twice. */
export declare function copyText(text: string, what?: string): void;
/** A "Copy X" entry, or nothing when there is no X. Spread it into a list. */
export declare function copyEntry(id: string, label: string, text: string | undefined | null): MenuEntry[];
/**
 * "Ask the assistant" from anywhere. The prompt carries what was right-clicked
 * so the model starts with the context instead of asking for it. Dispatched as
 * an event because every menu in the app would otherwise need a prop for it.
 */
export declare function askAssistant(prompt: string): void;
export declare function askEntry(label: string, prompt: string): MenuEntry;
interface MenuProps {
    /** Shown as a monospace heading at the top, the name of the thing. */
    readonly label?: string | undefined;
    readonly entries: readonly MenuEntry[];
    readonly children: ReactNode;
    readonly testId?: string;
}
export declare function Menu({ label, entries, children, testId }: MenuProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ContextMenu.d.ts.map