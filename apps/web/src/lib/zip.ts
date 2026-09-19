/**
 * A ZIP reader, in the browser, with nothing added to the bundle.
 *
 * An archive in a bucket is usually the thing you actually wanted: a build's
 * artefacts, a backup, a log roll-up. "Download it and look outside the tool"
 * is the answer a tool gives when it has given up, so this reads the central
 * directory and inflates entries on demand through `DecompressionStream`,
 * which Chromium has had for years and Electron therefore always has.
 *
 * On demand matters: a 200 MB archive of 10,000 files lists instantly because
 * listing only reads the directory at the end, and nothing is inflated until
 * someone opens an entry.
 *
 * Deflate and stored are handled, which between them cover essentially every
 * archive in the wild, including jar, war, whl, nupkg, docx and apk. Anything
 * else is reported by name rather than silently producing nonsense.
 */

export interface ZipEntry {
  readonly name: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly method: number;
  readonly crc: number;
  readonly modified: Date | undefined;
  readonly directory: boolean;
  /** Where the local header sits; the data follows it. */
  readonly offset: number;
  readonly encrypted: boolean;
}

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Entries of an archive, read from its central directory. Throws when it is not one. */
export function readZip(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const end = findEocd(view);
  if (end === -1) throw new Error('Not a ZIP archive, or its directory is truncated');

  let count = view.getUint16(end + 10, true);
  let start = view.getUint32(end + 16, true);

  // Zip64: the 32-bit fields saturate and the real ones live in their own record.
  if (count === 0xffff || start === 0xffffffff) {
    const locator = findBackwards(view, end - 20, end, EOCD64_LOCATOR);
    if (locator === -1) throw new Error('Zip64 archive without a locator record');
    const record = Number(view.getBigUint64(locator + 8, true));
    if (view.getUint32(record, true) !== EOCD64) throw new Error('Zip64 directory record is missing');
    count = Number(view.getBigUint64(record + 32, true));
    start = Number(view.getBigUint64(record + 48, true));
  }

  const entries: ZipEntry[] = [];
  let at = start;
  const decoder = new TextDecoder('utf-8');
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL) break;
    const flags = view.getUint16(at + 8, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const name = decoder.decode(new Uint8Array(buffer, at + 46, nameLength));
    let size = view.getUint32(at + 24, true);
    let compressedSize = view.getUint32(at + 20, true);
    let offset = view.getUint32(at + 42, true);

    if (size === 0xffffffff || compressedSize === 0xffffffff || offset === 0xffffffff) {
      const found = zip64Extra(view, buffer, at + 46 + nameLength, extraLength, { size, compressedSize, offset });
      size = found.size;
      compressedSize = found.compressedSize;
      offset = found.offset;
    }

    entries.push({
      name,
      size,
      compressedSize,
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      modified: dosDate(view.getUint16(at + 14, true), view.getUint16(at + 12, true)),
      directory: name.endsWith('/'),
      offset,
      encrypted: (flags & 0x1) !== 0,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The bytes of one entry, inflated if it needs it. */
export async function readZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new Error(`${entry.name} is encrypted; Mjolnir cannot open it without the password`);
  const view = new DataView(buffer);
  if (view.getUint32(entry.offset, true) !== LOCAL) throw new Error(`${entry.name}: its local header is not where the directory says`);
  // The local header repeats the name and extra field with its own lengths,
  // which are the ones that count: some writers pad one and not the other.
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const raw = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`${entry.name} uses compression method ${entry.method}, which Mjolnir does not read. Download it to open it.`);

  const stream = new Response(raw).body?.pipeThrough(new DecompressionStream('deflate-raw'));
  if (!stream) throw new Error(`${entry.name} could not be inflated`);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The archive as a folder tree, for a browser that looks like the bucket does. */
export function zipFolders(entries: readonly ZipEntry[], prefix: string): { folders: string[]; files: ZipEntry[] } {
  const folders = new Set<string>();
  const files: ZipEntry[] = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix)) continue;
    const rest = entry.name.slice(prefix.length);
    if (rest === '') continue;
    const slash = rest.indexOf('/');
    if (slash === -1) {
      if (!entry.directory) files.push(entry);
    } else {
      folders.add(rest.slice(0, slash + 1));
    }
  }
  return { folders: [...folders].sort(), files: files.sort((a, b) => a.name.localeCompare(b.name)) };
}

function findEocd(view: DataView): number {
  // The comment can be 64 KB, so the record is not necessarily the last bytes.
  const from = Math.max(0, view.byteLength - 65557);
  return findBackwards(view, from, view.byteLength - 4, EOCD);
}

function findBackwards(view: DataView, from: number, to: number, signature: number): number {
  for (let at = Math.min(to, view.byteLength - 4); at >= Math.max(0, from); at -= 1) {
    if (view.getUint32(at, true) === signature) return at;
  }
  return -1;
}

function zip64Extra(
  view: DataView,
  buffer: ArrayBuffer,
  at: number,
  length: number,
  current: { size: number; compressedSize: number; offset: number },
): { size: number; compressedSize: number; offset: number } {
  let cursor = at;
  const limit = at + length;
  while (cursor + 4 <= limit && cursor + 4 <= buffer.byteLength) {
    const id = view.getUint16(cursor, true);
    const size = view.getUint16(cursor + 2, true);
    if (id === 0x0001) {
      // The fields appear only for the ones that saturated, in this order.
      let field = cursor + 4;
      const next = { ...current };
      if (current.size === 0xffffffff) {
        next.size = Number(view.getBigUint64(field, true));
        field += 8;
      }
      if (current.compressedSize === 0xffffffff) {
        next.compressedSize = Number(view.getBigUint64(field, true));
        field += 8;
      }
      if (current.offset === 0xffffffff) next.offset = Number(view.getBigUint64(field, true));
      return next;
    }
    cursor += 4 + size;
  }
  return current;
}

function dosDate(date: number, time: number): Date | undefined {
  if (date === 0) return undefined;
  const year = 1980 + ((date >> 9) & 0x7f);
  const month = ((date >> 5) & 0x0f) - 1;
  const day = date & 0x1f;
  return new Date(year, month, day, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
}
