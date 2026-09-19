import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The renderer runs in a browser, and some packages here do not.
 *
 * `@mjolnir/k8s` reaches a transport built on node:https and the Kubernetes
 * client. A `import type` from it is erased at build and costs nothing; a
 * value import drags the whole graph into the bundle, where it cannot load.
 *
 * The failure is total and silent: the app does not mount, the boot splash
 * stays on screen, and every end-to-end test fails at once with an element
 * that is simply not there. It happened, and it took a while to see, because
 * the typecheck passes and the build succeeds. Nothing about it looks like an
 * import.
 */

const root = new URL('../..', import.meta.url).pathname;

/** Packages that exist to talk to something and cannot run in a renderer. */
const SERVER_ONLY = ['@mjolnir/k8s', '@mjolnir/demo', '@mjolnir/paddle'];

/** Entries of those packages that are pure and safe to import for real. */
const ALLOWED = ['@mjolnir/k8s/log-line'];

function sources(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

describe('what the renderer is allowed to import', () => {
  it('never imports a value from a server-only package', () => {
    const offenders: string[] = [];

    for (const file of sources(join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        const match = /^\s*import\s+(type\s+)?(?:.+?)\s+from\s+'([^']+)'/.exec(line);
        if (!match) continue;
        const [, isType, specifier] = match;
        if (isType) continue;
        if (ALLOWED.includes(specifier ?? '')) continue;
        if (SERVER_ONLY.some((name) => specifier === name)) {
          offenders.push(`${file.replace(root, '')}: ${line.trim()}`);
        }
      }
    }

    // If this fails: either use `import type`, or move the pure part of what
    // you need behind its own entry the way `@mjolnir/k8s/log-line` is.
    expect(offenders).toEqual([]);
  });
});
