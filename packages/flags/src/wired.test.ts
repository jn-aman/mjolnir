import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLAGS } from './registry.ts';

/**
 * A shipped flag has to gate something.
 *
 * A flag on the settings page that nothing reads is worse than no flag: it is
 * a switch a person moves, believing they have changed what the app does, and
 * nothing happens. This caught seven of them at once, including the welcome
 * screen, the metrics charts, the assistant's tool calls and the MCP server.
 *
 * Flags for features that are not built yet are exempt, and that is what
 * `internal` and `experimental` mean. The moment one is promoted to `beta` or
 * `stable` this test starts asking where it is used, which is exactly when
 * that question should be asked.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE_DIRS = ['apps/web/src', 'apps/server/src'];

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sources(path, found);
    } else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) {
      found.push(path);
    }
  }
  return found;
}

const code = SOURCE_DIRS.flatMap((dir) => sources(join(root, dir)))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

describe('every shipped flag gates something', () => {
  const shipped = FLAGS.filter((flag) => flag.stage === 'stable' || flag.stage === 'beta');

  it('has flags to check', () => {
    expect(shipped.length).toBeGreaterThan(10);
  });

  for (const flag of shipped) {
    it(`${flag.id} is read somewhere`, () => {
      // Module flags are looked up as `module.${tool.id}`, so the literal
      // never appears; the prefix is what the code actually contains.
      const literal = code.includes(`'${flag.id}'`) || code.includes(`"${flag.id}"`);
      const templated = flag.id.startsWith('module.') && code.includes('module.${');
      expect(literal || templated, `${flag.id} is declared and shown in settings but nothing reads it`).toBe(true);
    });
  }
});

describe('the registry itself', () => {
  it('has no duplicate ids', () => {
    const ids = FLAGS.map((flag) => flag.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes every flag in a sentence a person could act on', () => {
    for (const flag of FLAGS) {
      expect(flag.label.length, `${flag.id} has no label`).toBeGreaterThan(3);
      expect(flag.description.length, `${flag.id} has no description`).toBeGreaterThan(20);
      expect(flag.description.endsWith('.'), `${flag.id} description is not a sentence`).toBe(true);
    }
  });

  it('warns about the flags that deserve a warning', () => {
    // Anything that writes to a cluster, spends money or exposes a port
    // should say so before the switch moves.
    for (const id of ['kubernetes.edit', 'kubernetes.exec', 'assistant.writes', 'mcp.http', 'storage.presigned']) {
      const flag = FLAGS.find((entry) => entry.id === id);
      expect(flag, `${id} is missing from the registry`).toBeDefined();
      expect(flag?.warning, `${id} changes something consequential and has no warning`).toBeTruthy();
    }
  });
});
