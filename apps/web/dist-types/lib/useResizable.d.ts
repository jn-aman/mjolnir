/**
 * A width that can be dragged and is remembered.
 *
 * One hook for every resizable edge in the app, the sidebar, the drawer, a
 * split pane, so they all behave the same way: a wide invisible grip, a live
 * drag, a clamp to sane bounds, and the result stored per surface so the layout
 * someone set is the layout they get back tomorrow.
 *
 * `direction` says which way the edge grows: `right` for a panel anchored on
 * the left (dragging right widens it), `left` for one anchored on the right,
 * `up` for a panel anchored at the bottom (the dock), where the "width" is a
 * height and dragging up makes it taller.
 */
interface Options {
    readonly key: string;
    readonly initial: number;
    readonly min: number;
    readonly max: number;
    readonly direction: 'left' | 'right' | 'up';
}
export declare function useResizable({ key, initial, min, max, direction }: Options): {
    width: number;
    dragging: boolean;
    onPointerDown: (event: React.PointerEvent) => void;
    reset: () => void;
};
/**
 * The grip itself. 8px wide, invisible until hovered, sitting over the edge it
 * resizes. A 1px border is not a target anyone can hit; this is.
 */
export declare function ResizeHandle({ side, onPointerDown, dragging, label, }: {
    side: 'left' | 'right' | 'top';
    onPointerDown: (event: React.PointerEvent) => void;
    dragging: boolean;
    label: string;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=useResizable.d.ts.map