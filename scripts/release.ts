import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build a release, then check that the thing we built actually works.
 *
 * Packaging a desktop app is where a project quietly breaks: the source is
 * fine, the dev server is fine, and the artefact is missing a workspace
 * package because a symlink did not exist when electron-builder walked the
 * tree. That is not hypothetical here. The DMG built this morning shipped
 * without `@mjolnir/endpoints` and `@mjolnir/flags`, so the copy someone would
 * have downloaded could not read a flag at all, and nothing in the build said
 * so: it exited zero and produced a 137 MB file.
 *
 * So this script does the whole thing in one place and then opens the artefact
 * and asserts. The secret is written before the build and restored afterwards
 * in a `finally`, so a failure part way through cannot leave a token sitting
 * in the working tree.
 *
 *   MJOLNIR_UNLEASH_TOKEN=... npm run release
 *   MJOLNIR_UNLEASH_TOKEN=... npm run release -- --dir      (no DMG, much faster)
 *   npm run release:verify                                  (check what is already built)
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const buildFile = join(root, 'packages/endpoints/src/build.ts');

/** Every workspace package the desktop app needs at runtime, found by walking the manifests. */
function runtimePackages(): string[] {
  const seen = new Set<string>();
  const walk = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const folder = name.replace('@mjolnir/', '');
    const candidates = [join(root, 'packages', folder, 'package.json'), join(root, 'apps', folder, 'package.json')];
    const manifest = candidates.find((path) => existsSync(path));
    if (!manifest) return;
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { dependencies?: Record<string, string> };
    for (const dependency of Object.keys(parsed.dependencies ?? {})) {
      if (dependency.startsWith('@mjolnir/')) walk(dependency);
    }
  };
  walk('@mjolnir/desktop');
  seen.delete('@mjolnir/desktop');
  return [...seen].sort();
}

/**
 * The child's environment, without the parent npm's opinions.
 *
 * `npm run release` exports an `npm_config_*` variable for every flag it was
 * given, and a nested `npm run build --workspaces` reads them back as its own
 * configuration and exits 2 with nothing on stdout. Stripping them is what
 * makes running the same command by hand and running it from a script mean
 * the same thing.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('npm_config_') || key.startsWith('npm_package_') || key === 'npm_command') continue;
    env[key] = value;
  }
  return env;
}

function run(command: string, args: string[], cwd = root): void {
  process.stdout.write(`\n  $ ${command} ${args.join(' ')}\n`);
  try {
    execFileSync(command, args, { cwd, stdio: 'inherit', env: childEnv() });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 1;
    process.stdout.write(`\n  ${command} ${args.join(' ')} exited ${status}.\n\n`);
    throw new ReleaseFailure(`${command} exited ${status}`);
  }
}

/** A failure with a sentence, not a stack trace: this runs in a terminal. */
class ReleaseFailure extends Error {}

function capture(command: string, args: string[]): string {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: childEnv() });
}

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Open the packaged app and look inside it.
 *
 * Every check here is one that has already been wrong, or would be silent if
 * it were. "It built" is not the same as "it runs on a machine that is not
 * this one".
 */
function verify(appPath: string): Check[] {
  const checks: Check[] = [];
  const asar = join(appPath, 'Contents/Resources/app.asar');

  if (!existsSync(asar)) {
    return [{ name: 'app.asar', ok: false, detail: `not found at ${asar}` }];
  }

  const listing = capture('npx', ['--no-install', 'asar', 'list', asar]).split('\n');
  const packaged = new Set(
    listing.flatMap((line) => {
      const match = /^\/node_modules\/(@mjolnir\/[a-z0-9-]+)$/.exec(line.trim());
      return match?.[1] ? [match[1]] : [];
    }),
  );

  for (const name of runtimePackages()) {
    checks.push({
      name: `packaged ${name}`,
      ok: packaged.has(name),
      detail: packaged.has(name) ? 'present' : 'MISSING: the app will fail to start',
    });
  }

  // The built client is an extraResource, not in the asar.
  const web = join(appPath, 'Contents/Resources/web/index.html');
  checks.push({ name: 'web client', ok: existsSync(web), detail: existsSync(web) ? 'present' : `missing ${web}` });

  // The flag token has to survive into the artefact or the whole remote flag
  // story is dead on a customer's machine and nothing says so.
  const scratch = mkdtempSync(join(tmpdir(), 'mjolnir-verify-'));
  try {
    capture('npx', ['--no-install', 'asar', 'extract-file', asar, 'node_modules/@mjolnir/endpoints/dist/build.js']);
    const built = readFileSync(join(root, 'build.js'), 'utf8');
    rmSync(join(root, 'build.js'), { force: true });
    const token = /flagsToken:\s*['"]([^'"]*)['"]/.exec(built)?.[1] ?? '';
    const channel = /channel:\s*['"]([^'"]*)['"]/.exec(built)?.[1] ?? '';
    checks.push({
      name: 'flag token',
      ok: token.length > 0,
      detail: token.length > 0 ? `${token.length} characters, channel ${channel || 'unset'}` : 'EMPTY: flags will fall back to compiled defaults',
    });
  } catch (error) {
    checks.push({ name: 'flag token', ok: false, detail: `could not read build.js: ${String(error).slice(0, 120)}` });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // A signed build is the difference between "open it" and "right click,
  // open, are you sure". Unsigned is allowed; being told is not optional.
  try {
    const signature = capture('codesign', ['-dv', '--verbose=2', appPath]);
    const authority = /Authority=(.+)/.exec(signature)?.[1] ?? 'ad hoc';
    checks.push({ name: 'signature', ok: !authority.includes('ad hoc'), detail: authority.trim() });
  } catch {
    checks.push({ name: 'signature', ok: false, detail: 'not signed: Gatekeeper will warn on another machine' });
  }

  return checks;
}

function findApp(): string | undefined {
  for (const folder of ['mac-arm64', 'mac', 'mac-x64']) {
    const candidate = join(root, 'apps/desktop/release', folder, 'Mjolnir.app');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function report(checks: readonly Check[]): void {
  process.stdout.write('\n');
  for (const check of checks) {
    process.stdout.write(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(30)} ${check.detail}\n`);
  }
  const failed = checks.filter((check) => !check.ok);
  process.stdout.write(`\n  ${checks.length - failed.length} of ${checks.length} checks passed.\n\n`);
  if (failed.length > 0) process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--verify-only')) {
    const app = findApp();
    if (!app) {
      process.stdout.write('\n  Nothing built yet. Run: npm run release\n\n');
      process.exit(1);
    }
    process.stdout.write(`\n  Checking ${app}\n`);
    report(verify(app));
    return;
  }

  if (!process.env['MJOLNIR_UNLEASH_TOKEN']) {
    process.stdout.write(
      '\n  MJOLNIR_UNLEASH_TOKEN is not set.\n' +
        '  The build would ship with no flag token, so every install would fall\n' +
        '  back to the compiled defaults and the flag server would do nothing.\n\n' +
        '  Pass it, or use --allow-no-token if that is genuinely what you want.\n\n',
    );
    if (!args.includes('--allow-no-token')) process.exit(1);
  }

  const before = readFileSync(buildFile, 'utf8');
  try {
    run('npm', ['run', 'build:secrets']);
    run('npm', ['run', 'build', '--workspaces', '--if-present']);
    const builderArgs = ['electron-builder', '--mac'];
    if (args.includes('--dir')) builderArgs.push('--dir');
    if (args.includes('--arm64')) builderArgs.push('--arm64');
    run('npx', builderArgs, join(root, 'apps/desktop'));
  } finally {
    // Written back from what was read, not `git checkout`: restoring from git
    // would silently throw away an uncommitted edit to this file, which is
    // exactly the change someone is most likely to be making when they are
    // also cutting a release.
    writeFileSync(buildFile, before);
    const after = readFileSync(buildFile, 'utf8');
    process.stdout.write(`\n  build.ts restored: ${after === before ? 'clean' : 'CHANGED, check it by hand'}\n`);
  }

  const app = findApp();
  if (!app) {
    process.stdout.write('\n  Built, but no Mjolnir.app to check.\n\n');
    process.exit(1);
  }
  process.stdout.write(`\n  Checking ${app}\n`);
  report(verify(app));
}

try {
  await main();
} catch (error) {
  if (error instanceof ReleaseFailure) {
    process.stdout.write(`  Release stopped: ${error.message}\n\n`);
    process.exit(1);
  }
  throw error;
}
