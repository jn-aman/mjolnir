/**
 * One command to run Mjolnir from source.
 *
 * `npm run dev` used to be `node --experimental-strip-types src/index.ts & vite`,
 * which died the moment the server used a class the type stripper cannot erase,
 * and died quietly because the shell had already backgrounded it. This
 * supervises the three things a dev loop actually needs, prints one banner, and
 * takes them all down together on Ctrl-C:
 *
 *   1. tsc --build --watch   packages and the server, compiled to dist
 *   2. node --watch          the API, restarted whenever dist changes
 *   3. vite                  the UI, with /api and /ws proxied to the API
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiPort = Number(process.env['MJOLNIR_PORT'] ?? 7845);
const webPort = Number(process.env['MJOLNIR_WEB_PORT'] ?? 5273);
const serverEntry = join(root, 'apps/server/dist/index.js');

const ESC = String.fromCharCode(27);
const dim = (text: string): string => `${ESC}[2m${text}${ESC}[0m`;
const bold = (text: string): string => `${ESC}[1m${text}${ESC}[0m`;
const tint = (code: number, text: string): string => `${ESC}[38;5;${code}m${text}${ESC}[0m`;
const NOISE = new RegExp(`${ESC}\\[(2K|0G|1G)`, 'g');

const children = new Set<ChildProcess>();
let stopping = false;

/** Pipe a child's output through, one prefixed line at a time. */
function pipe(stream: NodeJS.ReadableStream | null, label: string): void {
  if (!stream) return;
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) {
      const text = line.replace(NOISE, '').trimEnd();
      if (text.length > 0) process.stdout.write(`${label} ${text}\n`);
    }
  });
}

function run(label: string, command: string, args: readonly string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  const child = spawn(command, [...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  pipe(child.stdout, label);
  pipe(child.stderr, label);
  child.on('exit', (code) => {
    children.delete(child);
    if (stopping) return;
    if (code !== 0 && code !== null) {
      process.stdout.write(`${label} exited with code ${code}\n`);
      stop(code);
    }
  });
  return child;
}

function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 400).unref();
}

/** Ask the OS whether a port is free, so a busy one reads as a sentence and not a stack trace. */
async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function waitForBuild(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(serverEntry)) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function main(): Promise<void> {
  for (const [name, port, variable] of [
    ['the API', apiPort, 'MJOLNIR_PORT'],
    ['the UI', webPort, 'MJOLNIR_WEB_PORT'],
  ] as const) {
    if (!(await portIsFree(port))) {
      process.stdout.write(
        `\n  Port ${port} is already in use, so ${name} cannot start.\n` +
          `  Stop the other process, or pick another port:\n\n` +
          `    ${variable}=${port + 10} npm run dev\n\n`,
      );
      process.exit(1);
    }
  }

  const tscLabel = tint(140, 'tsc ');
  const apiLabel = tint(75, 'api ');
  const webLabel = tint(114, 'web ');

  process.stdout.write(`\n  ${bold('Mjolnir')} ${dim('dev')}\n  ${dim('compiling packages and the server, then starting both halves')}\n\n`);

  run(tscLabel, 'npx', ['tsc', '--build', 'apps/server', '--watch', '--preserveWatchOutput'], root);

  if (!(await waitForBuild(120_000))) {
    process.stdout.write('\n  The server never compiled. Read the tsc output above.\n\n');
    stop(1);
    return;
  }

  run(apiLabel, 'node', ['--watch', '--watch-path', 'apps/server/dist', serverEntry], root, { MJOLNIR_PORT: String(apiPort) });
  run(webLabel, 'npx', ['vite', '--port', String(webPort), '--strictPort'], join(root, 'apps/web'));

  setTimeout(() => {
    process.stdout.write(
      `\n  ${bold('Open')} ${tint(75, `http://127.0.0.1:${webPort}`)}\n` +
        `  ${dim(`API on 127.0.0.1:${apiPort}, Ctrl-C stops everything`)}\n\n`,
    );
  }, 2500).unref();
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

await main();
