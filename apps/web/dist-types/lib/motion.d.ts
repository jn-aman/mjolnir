import type { Variants } from 'motion/react';
/**
 * The motion system, from the Storm design system's spec.
 *
 * **The rule: animate the container, never the content.** Panels, dialogs, tabs
 * and toasts animate, because their movement tells you where they came from.
 * Rows in a log, a table or a resource list do not — they appear.
 *
 * That is not a taste call. Easing data into view misrepresents when it
 * arrived, and this is a tool people use to establish what happened when. There
 * is deliberately no `row.enter` transition in this file, and adding one is a
 * correctness regression, not a polish improvement.
 */
/** Springs are interruptible: reversing mid-flight resolves from where it is. */
export declare const springs: {
    readonly panel: {
        type: "spring";
        stiffness: number;
        damping: number;
    };
    readonly toast: {
        type: "spring";
        stiffness: number;
        damping: number;
    };
    readonly snappy: {
        type: "spring";
        stiffness: number;
        damping: number;
    };
};
export declare const easings: {
    /** Decelerating. Entrances, and anything arriving. */
    out: readonly [0.16, 1, 0.3, 1];
    /** Accelerating. Exits, and anything leaving. */
    in: readonly [0.4, 0, 1, 1];
    /** Symmetric. Colour and opacity changes that are not going anywhere. */
    smooth: readonly [0.4, 0, 0.2, 1];
};
export declare const durations: {
    readonly hover: 0.09;
    readonly tab: 0.18;
    readonly overlay: 0.2;
    readonly close: 0.16;
};
export declare const transitions: {
    readonly hover: {
        duration: 0.09;
        ease: "linear";
    };
    readonly tab: {
        duration: 0.18;
        ease: readonly [0.16, 1, 0.3, 1];
    };
    readonly overlayIn: {
        duration: 0.2;
        ease: readonly [0.16, 1, 0.3, 1];
    };
    readonly overlayOut: {
        duration: 0.16;
        ease: readonly [0.4, 0, 1, 1];
    };
};
/** Dialogs and the command palette: a small rise, never a zoom. */
export declare const overlayVariants: Variants;
export declare const backdropVariants: Variants;
/** The dock rises from the bottom edge it is attached to. */
export declare const dockVariants: Variants;
/** A side panel slides from the edge it belongs to. */
export declare const drawerVariants: Variants;
export declare const toastVariants: Variants;
/**
 * The live-tail indicator.
 *
 * Slow enough to read as breathing rather than blinking. A fast pulse says
 * "alarm"; this one says "still connected", which is the actual claim.
 */
export declare const pulse: {
    readonly animate: {
        readonly opacity: readonly [0.5, 1, 0.5];
    };
    readonly transition: {
        readonly duration: 2.4;
        readonly repeat: number;
        readonly ease: 'easeInOut';
    };
};
/**
 * True when the viewer has asked for less motion.
 *
 * CSS handles most of it, but a spring driven in JS has to be asked directly.
 */
export declare function prefersReducedMotion(): boolean;
//# sourceMappingURL=motion.d.ts.map