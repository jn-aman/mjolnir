import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markSvg } from '@mjolnir/brand';

/**
 * Every icon file, regenerated from the one mark.
 *
 * They had drifted: the favicon still carried a straight haft while the app
 * had been redrawn with a flared grip, so the hammer in the browser tab was a
 * different hammer from the one on every empty state. Three hand-maintained
 * copies of the same drawing will always end up as three drawings.
 *
 *   npm run icons
 *
 * Rasterising uses Quick Look, which every Mac has, rather than adding a
 * native image library to the build. That means this is a macOS-only script,
 * which is fine: it is run when the artwork changes, and its output is
 * committed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

interface Target {
  readonly path: string;
  readonly size: number;
  readonly svg: string;
  readonly note: string;
}

const TARGETS: readonly Target[] = [
  {
    path: 'apps/web/public/mark.svg',
    size: 24,
    svg: markSvg({ tile: true, inset: 0.66 }),
    note: 'browser tab and the web build',
  },
  {
    path: 'apps/desktop/build/icon.png',
    size: 1024,
    // The radius is in viewBox units, not pixels: 5.4 of 24 is the ~22.5%
    // corner macOS uses, and the first attempt passed 180, which on a 24 unit
    // square is a circle. electron-builder does not mask this image, so what
    // is drawn here is what appears in the Dock.
    svg: markSvg({ size: 1024, tile: true, inset: 0.58, radius: 5.4 }),
    note: 'the application icon, every platform',
  },
  {
    path: 'apps/desktop/build/trayTemplate.png',
    size: 18,
    // A macOS template image is black and transparent only; the system
    // recolours it for light, dark and highlighted menu bars. Any colour in
    // here would be thrown away, and a tile would come out as a black square.
    svg: markSvg({ size: 18, flat: '#000000', inset: 0.92 }),
    note: 'menu bar, standard density',
  },
  {
    path: 'apps/desktop/build/trayTemplate@2x.png',
    size: 36,
    svg: markSvg({ size: 36, flat: '#000000', inset: 0.92 }),
    note: 'menu bar, retina',
  },
];

function rasterise(svg: string, size: number, destination: string): void {
  const scratch = join(tmpdir(), `mjolnir-icon-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(scratch, { recursive: true });
  const source = join(scratch, 'mark.svg');
  writeFileSync(source, svg);
  try {
    execFileSync('qlmanage', ['-t', '-s', String(size), '-o', scratch, source], { stdio: 'ignore' });
    const produced = readdirSync(scratch).find((name) => name.endsWith('.png'));
    if (!produced) throw new Error('Quick Look produced nothing');
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(join(scratch, produced), destination);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

process.stdout.write('\n');
for (const target of TARGETS) {
  const destination = join(root, target.path);
  if (target.path.endsWith('.svg')) {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, `${target.svg}\n`);
  } else {
    rasterise(target.svg, target.size, destination);
  }
  process.stdout.write(`  ${target.path.padEnd(40)} ${String(target.size).padStart(4)}px  ${target.note}\n`);
}
process.stdout.write('\n  Written from packages/brand. Edit the paths there, then run this again.\n\n');
