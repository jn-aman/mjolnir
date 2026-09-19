/**
 * The Mjolnir mark.
 *
 * A war hammer, head on: a broad striking face, a bolt struck out of its
 * centre, and a haft that flares into a grip. The flare is the whole trick.
 * Without it a rectangle on a stick reads as a mallet, a plunger or a letter T
 * at the sizes this thing actually gets used at, and a logo that needs to be
 * large to be legible is not a logo.
 *
 * Drawn as solid shapes with the bolt as negative space, so it survives being
 * 13 pixels wide in a menu and 72 wide on an empty page, and so it works in one
 * colour on a tinted tile.
 */
export declare function Mark({ size, className }: {
    size?: number;
    className?: string;
}): import("react").JSX.Element;
interface TileProps {
    readonly size?: number;
    readonly className?: string;
    /** Breathe, for a screen that is waiting on something. */
    readonly pulse?: boolean;
    readonly tint?: string;
}
/**
 * The lock-up: the mark reversed out of a lit gradient square.
 *
 * The same object in the title bar, the welcome, the About page and every
 * empty screen, so the app signs its own work in one hand. The inner highlight
 * and the coloured drop make it sit on the surface rather than in it.
 */
export declare function MarkTile({ size, className, pulse, tint }: TileProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Mark.d.ts.map