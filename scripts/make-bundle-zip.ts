import { deflateRawSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';

/**
 * Builds the archive the test cluster seeds into its buckets.
 *
 * The seed used to write ten bytes of PK magic and call it a zip, which
 * listed as an empty archive and therefore tested nothing. A real one needs a
 * CRC per entry and a central directory, and the `minio/mc` image the seed job
 * runs in has no zip tool, so it is built here and carried into the manifest
 * as base64.
 *
 * Run: npm run seed:bundle   (prints the base64 to paste into 40-seed.yaml)
 */

const FILES: ReadonlyArray<readonly [string, string]> = [
  [
    'bundle/README.md',
    '# Catalog bundle\n\nBuilt nightly from the `catalog` service.\n\n## Contents\n\n' +
      '- `manifest.json` — what shipped, and the git sha it came from\n' +
      '- `config/app.yaml` — the values the build was made with\n' +
      '- `data/metrics.csv` — request counts per route\n' +
      '- `src/handler.ts` — the entry point\n\n' +
      '| Field | Meaning |\n| --- | --- |\n| `sha` | the commit |\n| `built` | when |\n\n' +
      '> Regenerate with `make bundle`. Do **not** edit in place.\n',
  ],
  [
    'bundle/manifest.json',
    `${JSON.stringify(
      {
        name: 'catalog',
        version: '4.18.2',
        sha: '9f3c1ad',
        built: '2026-09-19T04:12:00Z',
        artifacts: [
          { path: 'src/handler.ts', bytes: 4211 },
          { path: 'assets/logo.svg', bytes: 118 },
        ],
        dependencies: { express: '5.1.0', yaml: '2.9.1' },
        flags: { newPricing: true, legacyCart: false },
      },
      null,
      2,
    )}\n`,
  ],
  [
    'bundle/config/app.yaml',
    'service: catalog\nreplicas: 3\nresources:\n  requests:\n    cpu: 100m\n    memory: 256Mi\n  limits:\n    memory: 1Gi\ndatabase:\n  host: postgres.data.svc\n  port: 5432\n  pool: 12\nfeatures:\n  - newPricing\n  - regionalStock\n',
  ],
  [
    'bundle/data/metrics.csv',
    'route,method,requests,p50_ms,p99_ms,errors\n/,GET,184203,12,88,4\n/product/{id},GET,98122,18,140,11\n"/cart,checkout",POST,20431,44,910,203\n/api/health,GET,518900,1,4,0\n',
  ],
  [
    'bundle/src/handler.ts',
    "import type { Request, Response } from 'express';\n\nexport async function handler(req: Request, res: Response): Promise<void> {\n  const id = String(req.params['id'] ?? '');\n  if (!id) {\n    res.status(400).json({ error: 'id is required' });\n    return;\n  }\n  res.json(await load(id));\n}\n",
  ],
  [
    'bundle/assets/logo.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#2f52d8"/></svg>\n',
  ],
  [
    'bundle/logs/build.log',
    `${Array.from(
      { length: 120 },
      (_, index) =>
        `2026-09-19T04:${String(10 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z INFO  step ${index + 1}/120 complete`,
    ).join('\n')}\n`,
  ],
];

/** A fixed DOS timestamp, so the same input always produces the same bytes. */
const DOS_TIME = 0x8b40;
const DOS_DATE = 0x5913;

function build(): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, body] of FILES) {
    const encoded = Buffer.from(name, 'utf8');
    const raw = Buffer.from(body, 'utf8');
    const compressed = deflateRawSync(raw);
    const sum = crc32(raw) >>> 0;

    const local = Buffer.alloc(30 + encoded.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(encoded.length, 26);
    encoded.copy(local, 30);
    compressed.copy(local, 30 + encoded.length);
    locals.push(local);

    const central = Buffer.alloc(46 + encoded.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(encoded.length, 28);
    central.writeUInt32LE(offset, 42);
    encoded.copy(central, 46);
    centrals.push(central);

    offset += local.length;
  }

  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(FILES.length, 8);
  end.writeUInt16LE(FILES.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, end]);
}

const zip = build();
const target = process.argv[2];
if (target) {
  writeFileSync(target, zip);
  process.stderr.write(`wrote ${target} (${zip.length} bytes, ${FILES.length} entries)\n`);
}
process.stdout.write(`${zip.toString('base64')}\n`);
