import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readZip, readZipEntry, zipFolders, type ZipEntry } from './zip.ts';

/**
 * A ZIP writer, only as much as the reader has to survive.
 *
 * Building archives here rather than committing binary fixtures keeps the
 * cases legible: this is the one place the byte layout is written down twice,
 * so a reader that drifts from the format fails loudly instead of quietly
 * producing plausible nonsense.
 */
function buildZip(files: Array<{ name: string; body: string; store?: boolean }>): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = encoder.encode(file.body);
    const compressed = file.store ? raw : new Uint8Array(deflateRawSync(Buffer.from(raw)));
    const method = file.store ? 0 : 8;

    const local = new Uint8Array(30 + name.length + compressed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(compressed, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + eocd.length);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

describe('readZip', () => {
  it('lists every entry with its uncompressed size', () => {
    const entries = readZip(
      buildZip([
        { name: 'readme.md', body: '# hello' },
        { name: 'src/main.ts', body: 'export const a = 1;\n'.repeat(40) },
      ]),
    );
    expect(entries.map((entry) => entry.name)).toEqual(['readme.md', 'src/main.ts']);
    expect(entries[0]?.size).toBe(7);
    expect(entries[1]?.size).toBe(800);
  });

  it('refuses something that is not an archive', () => {
    const bytes = new TextEncoder().encode('not a zip at all, just some bytes');
    expect(() => readZip(bytes.buffer as ArrayBuffer)).toThrow(/not a zip/i);
  });

  it('inflates a deflated entry', async () => {
    const body = 'the quick brown fox '.repeat(50);
    const archive = buildZip([{ name: 'fox.txt', body }]);
    const entry = readZip(archive)[0] as ZipEntry;
    expect(entry.method).toBe(8);
    expect(entry.compressedSize).toBeLessThan(entry.size);
    expect(new TextDecoder().decode(await readZipEntry(archive, entry))).toBe(body);
  });

  it('reads a stored entry without inflating it', async () => {
    const archive = buildZip([{ name: 'plain.txt', body: 'stored', store: true }]);
    const entry = readZip(archive)[0] as ZipEntry;
    expect(entry.method).toBe(0);
    expect(new TextDecoder().decode(await readZipEntry(archive, entry))).toBe('stored');
  });
});

describe('zipFolders', () => {
  const entries = readZip(
    buildZip([
      { name: 'top.txt', body: 'a' },
      { name: 'src/one.ts', body: 'b' },
      { name: 'src/deep/two.ts', body: 'c' },
    ]),
  );

  it('shows one level at a time', () => {
    const root = zipFolders(entries, '');
    expect(root.folders).toEqual(['src/']);
    expect(root.files.map((file) => file.name)).toEqual(['top.txt']);
  });

  it('descends into a folder', () => {
    const inner = zipFolders(entries, 'src/');
    expect(inner.folders).toEqual(['deep/']);
    expect(inner.files.map((file) => file.name)).toEqual(['src/one.ts']);
  });
});
