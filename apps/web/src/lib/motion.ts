import type { Transition, Variants } from 'motion/react';

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
export const springs = {
  panel: { type: 'spring', stiffness: 260, damping: 24 } satisfies Transition,
  toast: { type: 'spring', stiffness: 240, damping: 22 } satisfies Transition,
  snappy: { type: 'spring', stiffness: 420, damping: 32 } satisfies Transition,
} as const;

export const easings = {
  /** Decelerating. Entrances, and anything arriving. */
  out: [0.16, 1, 0.3, 1] as const,
  /** Accelerating. Exits, and anything leaving. */
  in: [0.4, 0, 1, 1] as const,
  /** Symmetric. Colour and opacity changes that are not going anywhere. */
  smooth: [0.4, 0, 0.2, 1] as const,
};

export const durations = {
  hover: 0.09,
  tab: 0.18,
  overlay: 0.2,
  close: 0.16,
} as const;

export const transitions = {
  hover: { duration: durations.hover, ease: 'linear' } satisfies Transition,
  tab: { duration: durations.tab, ease: easings.out } satisfies Transition,
  overlayIn: { duration: durations.overlay, ease: easings.out } satisfies Transition,
  overlayOut: { duration: durations.close, ease: easings.in } satisfies Transition,
} as const;

/** Dialogs and the command palette: a small rise, never a zoom. */
export const overlayVariants: Variants = {
  hidden: { opacity: 0, scale: 0.98, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: transitions.overlayIn },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: transitions.overlayOut },
};

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitions.overlayIn },
  exit: { opacity: 0, transition: transitions.overlayOut },
};

/** The dock rises from the bottom edge it is attached to. */
export const dockVariants: Variants = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: springs.panel },
  exit: { y: '100%', transition: transitions.overlayOut },
};

/** A side panel slides from the edge it belongs to. */
export const drawerVariants: Variants = {
  hidden: { x: '100%' },
  visible: { x: 0, transition: springs.panel },
  exit: { x: '100%', transition: transitions.overlayOut },
};

export const toastVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: springs.toast },
  exit: { opacity: 0, scale: 0.96, transition: transitions.overlayOut },
};

/**
 * The live-tail indicator.
 *
 * Slow enough to read as breathing rather than blinking. A fast pulse says
 * "alarm"; this one says "still connected", which is the actual claim.
 */
export const pulse = {
  animate: { opacity: [0.5, 1, 0.5] },
  transition: { duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' },
} as const;

/**
 * True when the viewer has asked for less motion.
 *
 * CSS handles most of it, but a spring driven in JS has to be asked directly.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
