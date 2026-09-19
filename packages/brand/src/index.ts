/**
 * The mark, once.
 *
 * It was drawn in three places and they had drifted: the favicon still had a
 * straight haft while the app had been redrawn with a flared grip months
 * before, so the icon in the browser tab was a different hammer from the one
 * on every empty state. Nobody notices that in a code review and everybody
 * notices it in a screenshot.
 *
 * So the geometry lives here as path data, every surface renders from it, and
 * `npm run icons` regenerates the raster files. Changing the mark is editing
 * two strings.
 *
 * ## What it is
 *
 * A war hammer, head on: a broad striking face, a bolt struck out of its
 * centre as negative space, and a haft that flares into a grip. The flare is
 * the whole trick. Without it a rectangle on a stick reads as a mallet, a
 * plunger or a letter T at the sizes this actually gets used at, and a logo
 * that needs to be large to be legible is not a logo.
 */

/** The head, with the bolt cut out of it. Even-odd, on a 24 unit grid. */
export const MARK_HEAD =
  'M4.9 3.4h14.2c1 0 1.8.8 1.8 1.8v4.9c0 1-.8 1.8-1.8 1.8H4.9c-1 0-1.8-.8-1.8-1.8V5.2c0-1 .8-1.8 1.8-1.8Zm8.9 2.1-4 4.3h2.3l-.7 2.4 4-4.4h-2.3l.7-2.3Z';

/** The haft, flaring into a grip. */
export const MARK_HAFT = 'M10.75 12.6h2.5l.62 6.6a1.87 1.87 0 0 1-3.74 0l.62-6.6Z';

export const MARK_VIEWBOX = '0 0 24 24';

/** The two blues the tile is lit with, light and dark end. */
export const BRAND = {
  light: '#6b8dff',
  dark: '#2f52d8',
  /** The mark itself, reversed out of the tile. */
  ink: '#ffffff',
} as const;

export interface MarkSvgOptions {
  readonly size?: number;
  /** A rounded square behind the mark, as app icons need. */
  readonly tile?: boolean;
  /** One flat colour instead of the gradient. For a tray template. */
  readonly flat?: string;
  /** Proportion of the tile the mark occupies. */
  readonly inset?: number;
  /** macOS rounds its own corners on an .icns, so a tile for it is square. */
  readonly radius?: number;
}

/**
 * The mark as a standalone SVG document.
 *
 * Used for the favicon, for the icon sources the raster files are made from,
 * and for anything else that needs a file rather than a component.
 */
export function markSvg(options: MarkSvgOptions = {}): string {
  const size = options.size ?? 24;
  const inset = options.inset ?? 0.66;
  const radius = options.radius ?? 6;
  const fill = options.flat ?? (options.tile ? BRAND.ink : 'currentColor');

  // Centred at the given proportion, so the mark keeps the same optical weight
  // whatever the tile is.
  const scale = inset;
  const offset = (24 - 24 * scale) / 2;
  const glyph = `<g transform="translate(${round(offset)} ${round(offset)}) scale(${round(scale)})" fill="${fill}"><path fill-rule="evenodd" clip-rule="evenodd" d="${MARK_HEAD}"/><path d="${MARK_HAFT}"/></g>`;

  if (!options.tile) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" width="${size}" height="${size}">${glyph}</svg>`;
  }

  const background = options.flat
    ? ''
    : `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.light}"/><stop offset="1" stop-color="${BRAND.dark}"/></linearGradient></defs>`;
  const plate = options.flat
    ? ''
    : `<rect width="24" height="24" rx="${radius}" fill="url(#g)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" width="${size}" height="${size}">${background}${plate}${glyph}</svg>`;
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
