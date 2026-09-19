import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One version number, in every place that claims to know it.
 *
 *   npm run version -- 0.2.0
 *
 * There are four: the root manifest, the desktop app's, the VERSION file that
 * the build stamps into the binary, and the changelog. They have drifted
 * before, and a build whose About box disagrees with its update manifest is a
 * build nobody can reason about.
 */

const root = new URL('..', import.meta.url).pathname;
const next = process.argv[2];

if (!next || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) {
  console.error('\n  Usage: npm run version -- 1.2.3\n');
  process.exit(1);
}

const manifests = ['package.json', 'apps/desktop/package.json'];
for (const relative of manifests) {
  const path = join(root, relative);
  const text = readFileSync(path, 'utf8');
  // Edited as text rather than parsed and re-serialised, so the file keeps its
  // key order and its formatting and the diff is one line.
  const updated = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);
  if (updated === text) {
    console.error(`\n  ${relative} has no version field to set.\n`);
    process.exit(1);
  }
  writeFileSync(path, updated);
  console.log(`  ${relative} -> ${next}`);
}

writeFileSync(join(root, 'VERSION'), `${next}\n`);
console.log(`  VERSION -> ${next}`);

/*
 * A changelog entry, started rather than finished.
 *
 * The notes are shown in the app when it offers the update, so somebody is
 * reading them to decide whether to restart what they are doing. A generated
 * list of commit subjects is not that, and "minor bug fixes and improvements"
 * is worse. This writes the heading and the commits since the last tag, to be
 * edited into sentences before publishing.
 */
const changelogPath = join(root, 'CHANGELOG.md');
let changelog = '';
try {
  changelog = readFileSync(changelogPath, 'utf8');
} catch {
  changelog = '# Changelog\n\nWhat changed, in the words somebody deciding whether to update would want.\n';
}

let commits = '';
try {
  const lastTag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: root, encoding: 'utf8' }).trim();
  commits = execFileSync('git', ['log', `${lastTag}..HEAD`, '--pretty=format:- %s'], { cwd: root, encoding: 'utf8' });
} catch {
  commits = execFileSync('git', ['log', '-20', '--pretty=format:- %s'], { cwd: root, encoding: 'utf8' });
}

const entry = `\n## ${next}\n\n${commits.trim() || '- (nothing recorded)'}\n`;
const at = changelog.indexOf('\n## ');
writeFileSync(changelogPath, at === -1 ? `${changelog.trimEnd()}\n${entry}` : changelog.slice(0, at) + entry + changelog.slice(at));
console.log(`  CHANGELOG.md -> a draft entry for ${next}`);

console.log(`\n  Now edit the changelog into sentences, then:\n    npm run release\n    npm run publish\n`);

export {};
