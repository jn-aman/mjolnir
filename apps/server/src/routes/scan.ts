import { execFile, spawn } from 'node:child_process';
import { findTool, toolEnv } from '../shell-path.ts';
import { existsSync } from 'node:fs';
import { Router } from 'express';
import { imageInventory, scanTarget, type ImageEntry, type PodObject } from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from '../clusters.ts';
import type { FlagStore } from '../flags.ts';
import { HttpError, handle, param, query } from '../http.ts';

const log = logger.child('scan');

/**
 * How many images to scan at once.
 *
 * Each Trivy run pulls layers and reads a database on disk, so this is bound
 * by network and I/O rather than by CPU. Three keeps the network busy without
 * turning a laptop into a heater, and without a cluster of forty images
 * opening forty connections to a registry that will rate limit for it.
 */
const SCAN_CONCURRENCY = 3;

/**
 * Trivy, from wherever it is installed. `trivy image --format json` gives
 * findings we shape into what the UI shows: counts by severity and every
 * vulnerability with its fixed version. No Trivy: the answer says how to
 * get it, not a fake empty result.
 */
async function trivyPath(): Promise<string | null> {
  const configured = process.env['MJOLNIR_TRIVY'];
  if (configured && existsSync(configured)) return configured;
  return findTool('trivy');
}

interface TrivyResult {
  Target: string;
  Vulnerabilities?: Array<{ VulnerabilityID: string; PkgName: string; InstalledVersion: string; FixedVersion?: string; Severity: string; Title?: string; PrimaryURL?: string }>;
}

const cache = new Map<string, { at: number; report: Report }>();

export function scanRoutes(registry?: ClusterRegistry, flags?: FlagStore): Router {
  const router = Router();

  router.get(
    '/',
    handle(async (_req, res) => {
      const path = await trivyPath();
      res.json({ available: path !== null, path, install: 'brew install trivy (macOS), or https://trivy.dev/latest/getting-started/installation/' });
    }),
  );

  router.post(
    '/image',
    handle(async (req, res) => {
      const body = req.body as { image?: unknown; force?: boolean };
      const image = String(body?.image ?? '').trim();
      if (!image) throw HttpError.badRequest('image is required');
      const path = await trivyPath();
      if (!path) throw new HttpError(503, 'upstream', 'Trivy is not installed. brew install trivy, then scan again.');
      const cached = cache.get(image);
      if (cached && Date.now() - cached.at < 10 * 60_000 && !body.force) {
        res.json({ cached: true, ...cached.report });
        return;
      }
      const env = await toolEnv({ NO_COLOR: '1' });
      const output = await new Promise<string>((resolve, reject) => {
        execFile(path, ['image', '--quiet', '--format', 'json', '--scanners', 'vuln', image], { maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000, env }, (error, stdout, stderr) => {
          if (error) reject(new Error(stderr.trim().split('\n').pop() || error.message));
          else resolve(stdout);
        });
      }).catch((error: Error) => {
        throw new HttpError(502, 'upstream', `trivy failed: ${error.message}`);
      });
      const report = shape(image, output);
      cache.set(image, { at: Date.now(), report });
      res.json({ cached: false, ...report });
    }),
  );

  /**
   * The same scan, streamed.
   *
   * A Trivy run against a fat image takes a minute, most of it spent pulling
   * layers and updating the vulnerability database, and Trivy says so on
   * stderr the whole time. A spinner throws that away and leaves people
   * wondering whether it hung. Server-sent events rather than a WebSocket
   * because this is one-way, short-lived, and reconnects on its own.
   */
  router.get(
    '/stream',
    handle(async (req, res) => {
      const image = String(req.query['image'] ?? '').trim();
      if (!image) throw HttpError.badRequest('image is required');
      const force = req.query['force'] === 'true';
      const path = await trivyPath();

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // The Electron renderer sits behind no proxy, but a dev Vite proxy
        // will hold the stream unless buffering is turned off explicitly.
        'x-accel-buffering': 'no',
      });
      const send = (event: string, data: unknown): void => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      if (!path) {
        send('failed', { message: 'Trivy is not installed. brew install trivy, then scan again.' });
        res.end();
        return;
      }

      const cached = cache.get(image);
      if (cached && Date.now() - cached.at < 10 * 60_000 && !force) {
        send('log', { line: 'Using the result from the last scan of this digest.' });
        send('done', { cached: true, ...cached.report });
        res.end();
        return;
      }

      send('log', { line: `trivy image ${image}` });
      // Trivy shells out further, to a credential helper for the registry it
      // pulls the vulnerability database from. Without the real PATH that
      // fails deep inside Trivy with a message about a binary nobody asked
      // for, and from the outside the scanner simply looks broken.
      const child = spawn(path, ['image', '--format', 'json', '--scanners', 'vuln', image], { env: await toolEnv({ NO_COLOR: '1' }) });

      let out = '';
      let rest = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        out += chunk;
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        const lines = (rest + chunk).split('\n');
        rest = lines.pop() ?? '';
        for (const line of lines) {
          const text = line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim();
          if (text) send('log', { line: text });
        }
      });

      // A closed tab should not leave a trivy process pulling layers.
      const stop = (): void => {
        child.kill('SIGTERM');
      };
      req.on('close', stop);

      child.on('error', (error) => {
        send('failed', { message: error.message });
        res.end();
      });

      child.on('close', (code) => {
        req.off('close', stop);
        if (code !== 0) {
          send('failed', { message: `trivy exited with code ${code ?? 'unknown'}` });
          res.end();
          return;
        }
        try {
          const report = shape(image, out);
          cache.set(image, { at: Date.now(), report });
          send('done', { cached: false, ...report });
        } catch (error) {
          send('failed', { message: `trivy output did not parse: ${error instanceof Error ? error.message : String(error)}` });
        }
        res.end();
      });
    }),
  );

  /**
   * Every image running in a cluster, with whatever has already been scanned.
   *
   * Deliberately starts nothing. Opening a page should not fire off forty
   * Trivy runs, and the inventory on its own is useful: it is the answer to
   * "what are we actually running", which nobody can otherwise produce
   * without a script.
   */
  router.get(
    '/cluster/:context',
    handle(async (req, res) => {
      const { entries, inventory } = await gatherImages(registry, flags, req);
      res.json({
        ...inventory,
        images: entries.map((entry) => ({ ...entry, target: scanTarget(entry), report: cached(entry) })),
        trivy: (await trivyPath()) !== null,
      });
    }),
  );

  /**
   * Scan the whole cluster, streamed.
   *
   * One event per image as it finishes, so the table fills in rather than
   * appearing at the end. A cluster scan takes minutes and a progress bar with
   * nothing behind it is the thing people cancel.
   */
  router.get(
    '/cluster/:context/stream',
    handle(async (req, res) => {
      const { entries } = await gatherImages(registry, flags, req);
      const force = req.query['force'] === 'true';
      const path = await trivyPath();

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const send = (event: string, data: unknown): void => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      if (!path) {
        send('failed', { message: 'Trivy is not installed. brew install trivy, then scan again.' });
        res.end();
        return;
      }

      const todo = force ? entries : entries.filter((entry) => !cached(entry));
      send('start', { total: entries.length, toScan: todo.length, skipped: entries.length - todo.length });
      for (const entry of entries) {
        const report = cached(entry);
        if (report && !force) send('image', { image: entry.image, target: scanTarget(entry), report, cached: true });
      }

      let cancelled = false;
      const stop = (): void => {
        cancelled = true;
      };
      req.on('close', stop);

      let done = 0;
      const queue = [...todo];
      const worker = async (): Promise<void> => {
        for (;;) {
          const entry = queue.shift();
          if (!entry || cancelled) return;
          const target = scanTarget(entry);
          send('scanning', { image: entry.image, target });
          try {
            const report = await runTrivy(path, target);
            cache.set(target, { at: Date.now(), report });
            done += 1;
            send('image', { image: entry.image, target, report, cached: false, done, total: todo.length });
          } catch (error) {
            done += 1;
            // One image that will not scan, usually a private registry with no
            // credentials on this machine, must not end the run. The rest of
            // the cluster is still worth knowing about.
            send('image', {
              image: entry.image,
              target,
              error: error instanceof Error ? error.message : String(error),
              done,
              total: todo.length,
            });
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, Math.max(1, queue.length)) }, worker));
      req.off('close', stop);
      if (!cancelled) send('done', { scanned: done, total: entries.length });
      res.end();
    }),
  );

  /**
   * An SBOM for one image, in CycloneDX.
   *
   * CycloneDX rather than SPDX because it is what the tools that consume these
   * ask for first, and because Trivy emits it natively. It streams straight
   * through: this file has no business parsing a document whose only job is to
   * be handed to something else.
   */
  router.get(
    '/sbom',
    handle(async (req, res) => {
      const image = String(req.query['image'] ?? '').trim();
      if (!image) throw HttpError.badRequest('image is required');
      const path = await trivyPath();
      if (!path) throw new HttpError(503, 'upstream', 'Trivy is not installed. brew install trivy, then try again.');

      const env = await toolEnv({ NO_COLOR: '1' });
      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          path,
          ['image', '--quiet', '--format', 'cyclonedx', image],
          { maxBuffer: 128 * 1024 * 1024, timeout: 10 * 60_000, env },
          (error, stdout, stderr) => {
            if (error) reject(new Error(stderr.trim().split('\n').pop() || error.message));
            else resolve(stdout);
          },
        );
      }).catch((error: Error) => {
        throw new HttpError(502, 'upstream', `trivy failed: ${error.message}`);
      });

      res.type('application/vnd.cyclonedx+json');
      res.setHeader('content-disposition', `attachment; filename="${image.replace(/[^\w.-]+/g, '_')}.cdx.json"`);
      res.send(output);
    }),
  );

  return router;
}

/** The pods of a cluster, reduced to the distinct images they run. */
async function gatherImages(
  registry: ClusterRegistry | undefined,
  flags: FlagStore | undefined,
  req: Parameters<Parameters<Router['get']>[1]>[0],
): Promise<{ entries: ImageEntry[]; inventory: { pods: number; namespaces: number } }> {
  if (!registry) throw new HttpError(503, 'internal', 'no cluster registry is available');
  if (flags && !flags.value('scan.images')) throw new HttpError(404, 'not-found', 'image scanning is switched off in this build');

  const contextName = param(req, 'context');
  const namespace = query(req, 'namespace') ?? '';
  const path = namespace ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?limit=1000` : '/api/v1/pods?limit=1000';
  const response = await registry.connect(contextName).json<{ items?: PodObject[] }>(path);
  const inventory = imageInventory(response.items ?? []);
  log.debug('image inventory', { context: contextName, images: inventory.images.length, pods: inventory.pods });
  return { entries: [...inventory.images], inventory: { pods: inventory.pods, namespaces: inventory.namespaces } };
}

/** A scan already in hand for this exact target, if it is still fresh. */
function cached(entry: ImageEntry): Report | null {
  const hit = cache.get(scanTarget(entry));
  return hit && Date.now() - hit.at < 60 * 60_000 ? hit.report : null;
}

/**
 * One image, with one retry.
 *
 * Three scans at once against one registry produces the occasional timeout,
 * and a whole image missing from a cluster report because a TCP connection
 * dropped is a worse outcome than waiting another thirty seconds. Only
 * transient failures are retried: a reference that does not parse will not
 * parse the second time either.
 */
async function runTrivy(path: string, target: string): Promise<Report> {
  try {
    return await trivyOnce(path, target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!transient(message)) throw error;
    log.debug('retrying a scan that failed transiently', { target, message });
    return trivyOnce(path, target);
  }
}

/** Worth trying again: the network, the registry, or a rate limit. */
export function transient(message: string): boolean {
  return /timeout|timed out|connection reset|EOF|temporary failure|too ?many ?requests|rate limit|429|502|503|504|transport/i.test(message);
}

async function trivyOnce(path: string, target: string): Promise<Report> {
  // The real PATH, not the one a GUI app inherits from launchd. Without it
  // Trivy fails deep inside a registry credential helper, and from the outside
  // the scanner simply looks broken.
  const env = await toolEnv({ NO_COLOR: '1' });
  return new Promise<Report>((resolve, reject) => {
    execFile(
      path,
      ['image', '--quiet', '--format', 'json', '--scanners', 'vuln', target],
      { maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000, env },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(trivyError(stderr) || error.message));
          return;
        }
        try {
          resolve(shape(target, stdout));
        } catch (cause) {
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      },
    );
  });
}

/**
 * What Trivy was actually complaining about.
 *
 * Taking the last line of stderr is wrong, and was: when Trivy panics it
 * prints a Go stack trace, so the last line is a frame like
 * `net/http/transport.go:1995 +0x10e4`, which tells the person reading it
 * nothing at all. The line that matters is the first FATAL or ERROR, with
 * Trivy's timestamp and level prefix taken off.
 */
export function trivyError(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim())
    .filter(Boolean);
  const fatal = lines.find((line) => /\b(FATAL|ERROR)\b/.test(line)) ?? lines[0] ?? '';
  return fatal
    .replace(/^\S+\s+(FATAL|ERROR)\s+/i, '')
    .replace(/^Fatal error\s+/i, '')
    .replace(/^run error:\s*/i, '')
    .trim()
    .slice(0, 300);
}

/** Trivy's JSON, reduced to what the dialog shows. */
function shape(image: string, output: string): Report {
  const parsed = JSON.parse(output) as { Results?: TrivyResult[]; Metadata?: { OS?: { Family?: string; Name?: string } } };
  const findings = (parsed.Results ?? []).flatMap((result) =>
    (result.Vulnerabilities ?? []).map((v) => ({
      id: v.VulnerabilityID,
      package: v.PkgName,
      installed: v.InstalledVersion,
      fixed: v.FixedVersion ?? null,
      severity: v.Severity,
      title: v.Title ?? '',
      url: v.PrimaryURL ?? '',
      target: result.Target,
    })),
  );
  const bySeverity: Record<string, number> = {};
  for (const finding of findings) bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  return {
    image,
    scannedAt: new Date().toISOString(),
    os: parsed.Metadata?.OS,
    total: findings.length,
    bySeverity,
    fixable: findings.filter((finding) => finding.fixed).length,
    findings,
  };
}

interface Report {
  image: string;
  scannedAt: string;
  os?: { Family?: string; Name?: string } | undefined;
  total: number;
  bySeverity: Record<string, number>;
  fixable: number;
  findings: Array<{ id: string; package: string; installed: string; fixed: string | null; severity: string; title: string; url: string; target: string }>;
}
