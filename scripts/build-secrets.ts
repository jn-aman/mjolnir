/**
 * Write the release-only values into packages/endpoints/src/build.ts.
 *
 * Run before packaging, and `git checkout packages/endpoints/src/build.ts`
 * after, so the secret exists in the artefact and never in a commit.
 *
 *   MJOLNIR_UNLEASH_TOKEN=... npm run build:secrets
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'packages/endpoints/src/build.ts');

const token = process.env['MJOLNIR_UNLEASH_TOKEN'] ?? '';
const channel = process.env['MJOLNIR_CHANNEL'] ?? 'stable';

if (!token) {
  process.stdout.write('\n  MJOLNIR_UNLEASH_TOKEN is not set, so the build would ship without a flag token.\n  Set it, or accept that flags fall back to the compiled defaults.\n\n');
}

const source = readFileSync(target, 'utf8')
  .replace(/flagsToken: '[^']*'/, `flagsToken: '${token.replace(/'/g, "\\'")}'`)
  .replace(/channel: '[^']*'/, `channel: '${channel.replace(/'/g, "\\'")}'`);
writeFileSync(target, source);

process.stdout.write(`\n  build.ts written: token ${token ? 'set' : 'empty'}, channel ${channel}.\n  Remember: git checkout packages/endpoints/src/build.ts when the build is done.\n\n`);
