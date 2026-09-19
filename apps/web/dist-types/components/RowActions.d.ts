import type { MenuEntry } from './ui/ContextMenu.tsx';
/**
 * What you can do to a row, on the row.
 *
 * The same verbs the right-click menu offers, because an action that lives
 * only behind right-click is an action most people never find. Edit and
 * delete get their own buttons since they are what people reach for; the
 * rest are behind the ellipsis. Visible on hover and whenever the menu is
 * open, so the row never flickers.
 */
export declare function RowActions({ entries, name }: {
    entries: readonly MenuEntry[];
    name: string;
}): import("react").JSX.Element;
//# sourceMappingURL=RowActions.d.ts.map