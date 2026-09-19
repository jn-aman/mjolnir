/**
 * The handle that opens and closes a panel, living on the panel's own edge.
 *
 * A collapse control belongs to the thing it collapses. Putting it in the
 * header means guessing which panel it means, and putting it at the bottom of
 * a scrolling list means hunting for it. On the edge it is always in the same
 * place, it points the way the panel will move, and it is the one pixel column
 * your pointer is already crossing on its way out of the panel.
 */
interface EdgeToggleProps {
    readonly open: boolean;
    readonly onToggle: () => void;
    /** Read aloud, and shown in the tooltip. */
    readonly label: string;
    readonly hint?: string | undefined;
    readonly testId: string;
    /** Where on the edge it sits. Centred by default. */
    readonly top?: string | undefined;
}
export declare function EdgeToggle({ open, onToggle, label, hint, testId, top }: EdgeToggleProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=EdgeToggle.d.ts.map