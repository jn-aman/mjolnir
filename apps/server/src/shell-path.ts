import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { logger } from '@mjolnir/logger';

const log = logger.child('path');
const run = promisify(execFile);

/**
 * The PATH a person actually has, which a double-clicked app does not.
 *
 * An app launched from the Dock inherits `launchd`'s environment, which is
 * roughly `/usr/bin:/bin:/usr/sbin:/sbin` and nothing a developer has
 * installed. Everything this app shells out to lives outside that: trivy,
 * helm, kubectl, docker, and the credential helpers those tools shell out to
 * in turn.
 *
 * The failure is not a missing binary error, which would at least be legible.
 * It is Trivy reporting `exec: "docker-credential-osxkeychain": executable
 * file not found in $PATH` from inside its own image pull, three layers down,
 * about a program the person never asked for. From the outside it looks like
 * the scanner is broken.
 *
 * So the login shell is asked once what PATH it has, the way every serious
 * Mac developer tool does it, and the answer is used for every spawn. It is
 * an interactive login shell (`-ilc`) because that is what reads the profile
 * where `PATH` is actually set.
 */

/** Where things end up even when the shell says nothing useful. */
const FALLBACKS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  join(homedir(), '.docker', 'bin'),
  join(homedir(), '.local', 'bin'),
  join(homedir(), 'bin'),
  // Docker Desktop keeps its credential helpers here and puts nothing on the
  // system path until a terminal has sourced its shim.
  '/Applications/Docker.app/Contents/Resources/bin',
  '/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin/bin',
];

let resolved: string | null = null;
let inflight: Promise<string> | null = null;

/**
 * The PATH to spawn with. Resolved once, then instant.
 *
 * Never throws and never blocks anything important: a shell that hangs or a
 * platform without one falls back to the list above, which is worse than the
 * real answer and far better than what launchd provides.
 */
export async function shellPath(): Promise<string> {
  if (resolved !== null) return resolved;
  if (inflight) return inflight;

  inflight = (async () => {
    const parts = new Set<string>();
    for (const entry of (process.env['PATH'] ?? '').split(':')) if (entry) parts.add(entry);

    if (process.platform !== 'win32') {
      const shell = process.env['SHELL'] ?? '/bin/zsh';
      try {
        // A timeout because a profile that waits on something interactive
        // would otherwise hang the first scan forever.
        const { stdout } = await run(shell, ['-ilc', 'command -p echo "__MJOLNIR_PATH__$PATH"'], {
          timeout: 4000,
          killSignal: 'SIGKILL',
          env: { ...process.env, TERM: 'dumb' },
        });
        const found = /__MJOLNIR_PATH__(.*)/.exec(stdout)?.[1]?.trim();
        for (const entry of (found ?? '').split(':')) if (entry) parts.add(entry);
      } catch (error) {
        log.debug('could not read the login shell PATH', { error: error instanceof Error ? error.message : String(error) });
      }
    }

    for (const entry of FALLBACKS) if (existsSync(entry)) parts.add(entry);

    resolved = [...parts].join(':');
    log.info('resolved the tool path', { entries: parts.size });
    return resolved;
  })();

  return inflight;
}

/** The environment to spawn an external tool with. */
export async function toolEnv(extra: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, PATH: await shellPath(), ...extra };
}

/** Whether a tool is on that path at all, for a message worth reading. */
export async function findTool(name: string): Promise<string | null> {
  const path = await shellPath();
  for (const directory of path.split(':')) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
