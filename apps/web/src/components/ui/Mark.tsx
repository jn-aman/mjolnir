import { motion } from 'motion/react';
import { MARK_HAFT, MARK_HEAD, MARK_VIEWBOX } from '@mjolnir/brand';

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
 *
 * The geometry comes from `@mjolnir/brand`, the same source the favicon, the
 * application icon and the tray image are generated from. It used to be copied
 * here, and the copies drifted: the favicon kept a straight haft for months
 * after the app was redrawn with a flared grip.
 */
export function Mark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} width={size} height={size} fill="none" aria-hidden className={className}>
      <path d={MARK_HEAD} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
      {/* The haft, flaring into a grip. */}
      <path d={MARK_HAFT} fill="currentColor" />
    </svg>
  );
}

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
export function MarkTile({ size = 26, className = '', pulse = false, tint = 'var(--accent-solid)' }: TileProps) {
  return (
    <motion.span
      aria-hidden
      className={`relative flex shrink-0 items-center justify-center overflow-hidden text-white ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: `linear-gradient(145deg, color-mix(in oklab, ${tint} 100%, white 26%), color-mix(in oklab, ${tint} 100%, black 20%))`,
        boxShadow: `0 1px 0 rgb(255 255 255 / 0.3) inset, 0 0 0 0.5px color-mix(in oklab, ${tint} 60%, black 30%), 0 ${Math.round(size / 6)}px ${Math.round(size / 2)}px color-mix(in oklab, ${tint} 45%, transparent)`,
      }}
      animate={pulse ? { scale: [1, 1.04, 1] } : { scale: 1 }}
      transition={pulse ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
    >
      {/* A glint across the top left, the way a physical badge catches a window. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(135deg, rgb(255 255 255 / 0.26) 0%, rgb(255 255 255 / 0.04) 38%, transparent 62%)' }}
      />
      <Mark size={Math.round(size * 0.6)} className="relative" />
    </motion.span>
  );
}
