import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cutting a release, from a version number to an app that updates itself.
 *
 *   npm run version -- 0.2.0            set the version everywhere
 *   npm run release                     build and check the DMG
 *   npm run publish                     put it where the app looks
 *
 * Three commands rather than one, because they fail for different reasons and
 * at different times. A build that fails should not have already told the
 * world about a version that does not exist, and a publish that fails should
 * not mean building again.
 *
 * ## What "published" means
 *
 * electron-updater asks a URL for `latest-mac.yml`, reads the version and the
 * archive name out of it, and downloads the archive from the same directory.
 * So publishing is: put the archives and the manifest in
 * `<channel>/<os>/<arch>/`, and write a `latest.json` beside them that the
 * website reads so the download page knows what exists without a redeploy.
 */

const root = new URL('..', import.meta.url).pathname;
const HOST = process.env['MJOLNIR_HOST'] ?? 'ubuntu@vm.aman.wiki';
const KEY = process.env['MJOLNIR_SSH_KEY'] ?? `${process.env['HOME']}/Downloads/ssh-key-2026-02-21.key`;
const SSH = ['-i', KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20'];
/** Inside the container this is /data/updates; on the host it is the volume. */
const REMOTE = '/var/lib/mjolnir/updates';
const CHANNEL = process.env['MJOLNIR_CHANNEL'] ?? 'stable';
const PUBLIC_URL = process.env['MJOLNIR_PUBLIC_URL'] ?? 'https://api.mjolnir.sh';

function step(message: string): void {
  console.log(`\n== ${message}`);
}

function ssh(script: string): string {
  return execFileSync('ssh', [...SSH, HOST, 'bash -s'], { input: script, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

const releaseDir = join(root, 'apps/desktop/release');
const version = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')).version as string;

if (!existsSync(releaseDir)) {
  console.error('\n  Nothing built. Run: npm run release\n');
  process.exit(1);
}

/*
 * Exactly the files a release is made of.
 *
 * Not "everything in the output directory": that directory also holds
 * unpacked app bundles, builder caches and whatever a previous run left
 * behind, and publishing those would put hundreds of megabytes of nothing on
 * a server and make the manifest ambiguous about which archive is the one.
 */
const WANTED = /(^latest-mac\.yml$|^latest\.yml$|\.dmg$|\.zip$|\.blockmap$|\.exe$|\.AppImage$|\.deb$)/;
const files = readdirSync(releaseDir).filter((name) => WANTED.test(name));
const manifest = files.find((name) => name === 'latest-mac.yml' || name === 'latest.yml');

if (!manifest) {
  console.error(
    '\n  No latest-mac.yml in the build.\n' +
      '  electron-builder writes it only when a publish target is configured,\n' +
      '  and without it the app has nothing to ask about updates.\n\n',
  );
  process.exit(1);
}

step(`Publishing ${version} to ${CHANNEL}`);
console.log(files.map((name) => `  ${name}`).join('\n'));

/*
 * One directory per architecture, both fed the same manifest.
 *
 * electron-builder emits one `latest-mac.yml` naming both architectures'
 * archives, and the updater asks for it under the arch it is running on. The
 * archives themselves carry the arch in their filename, so the same directory
 * contents answer both.
 */
const targets = [`${CHANNEL}/mac/arm64`, `${CHANNEL}/mac/x64`];

step('Making room on the server');
ssh(`set -euo pipefail
${targets.map((target) => `sudo install -d -m 755 -o ubuntu -g ubuntu ${REMOTE}/${target}`).join('\n')}
echo ok`);

step('Sending the build');
for (const target of targets) {
  execFileSync(
    'scp',
    [...SSH, ...files.map((name) => join(releaseDir, name)), `${HOST}:${REMOTE}/${target}/`],
    { stdio: 'inherit' },
  );
}

/*
 * What the website reads.
 *
 * Written last, so a publish that fails halfway leaves the previous release
 * as the one the download page offers rather than a version whose files are
 * half there.
 */
step('Marking it as the current release');
const notes = process.env['MJOLNIR_RELEASE_NOTES'] ?? readNotes(version);
const latest = {
  version,
  channel: CHANNEL,
  publishedAt: new Date().toISOString(),
  arm64: `${PUBLIC_URL}/updates/${CHANNEL}/mac/arm64/${files.find((name) => name.endsWith('.dmg') && name.includes('arm64')) ?? ''}`,
  intel: `${PUBLIC_URL}/updates/${CHANNEL}/mac/x64/${files.find((name) => name.endsWith('.dmg') && !name.includes('arm64')) ?? ''}`,
  notes,
};
execFileSync('ssh', [...SSH, HOST, `sudo tee ${REMOTE}/latest.json >/dev/null && sudo chown ubuntu:ubuntu ${REMOTE}/latest.json`], {
  input: `${JSON.stringify(latest, null, 2)}\n`,
  encoding: 'utf8',
});

step('Checking the app can see it');
console.log(
  ssh(`set -euo pipefail
sudo chown -R ubuntu:ubuntu ${REMOTE}
for t in ${targets.join(' ')}; do
  echo "$t: $(ls ${REMOTE}/$t | wc -l | tr -d ' ') files"
done
echo "manifest: $(curl -sS -m 5 http://127.0.0.1:8787/updates/${CHANNEL}/mac/arm64/${manifest} | head -2 | tr '\\n' ' ' || echo unreachable)"
echo "latest.json: $(curl -sS -m 5 http://127.0.0.1:8787/updates/latest.json | head -c 120 || echo unreachable)"
`),
);

console.log(`\nDone. ${PUBLIC_URL}/updates/${CHANNEL}/mac/arm64/${manifest}\n`);

/**
 * Release notes, from the changelog if there is one.
 *
 * Shown in the app when it finds an update, so "Minor bug fixes and
 * improvements" is not good enough: somebody is deciding whether to restart
 * what they are doing.
 */
function readNotes(forVersion: string): string {
  const changelog = join(root, 'CHANGELOG.md');
  if (!existsSync(changelog)) return '';
  const text = readFileSync(changelog, 'utf8');
  const section = new RegExp(`^##\\s*\\[?${forVersion.replace(/\\./g, '\\\\.')}\\]?[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'm').exec(text);
  return section?.[1]?.trim() ?? '';
}

export {};
