import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Router } from 'express';
import { HttpError, handle } from '../http.ts';

/**
 * Trivy, from wherever it is installed. `trivy image --format json` gives
 * findings we shape into what the UI shows: counts by severity and every
 * vulnerability with its fixed version. No Trivy: the answer says how to
 * get it, not a fake empty result.
 */
const CANDIDATES = ['/opt/homebrew/bin/trivy', '/usr/local/bin/trivy', '/usr/bin/trivy'];

function trivyPath(): string | null {
  const configured = process.env['MJOLNIR_TRIVY'];
  if (configured && existsSync(configured)) return configured;
  for (const candidate of CANDIDATES) if (existsSync(candidate)) return candidate;
  return null;
}

interface TrivyResult {
  Target: string;
  Vulnerabilities?: Array<{ VulnerabilityID: string; PkgName: string; InstalledVersion: string; FixedVersion?: string; Severity: string; Title?: string; PrimaryURL?: string }>;
}

const cache = new Map<string, { at: number; report: Report }>();

export function scanRoutes(): Router {
  const router = Router();

  router.get(
    '/',
    handle(async (_req, res) => {
      const path = trivyPath();
      res.json({ available: path !== null, path, install: 'brew install trivy (macOS), or https://trivy.dev/latest/getting-started/installation/' });
    }),
  );

  router.post(
    '/image',
    handle(async (req, res) => {
      const body = req.body as { image?: unknown; force?: boolean };
      const image = String(body?.image ?? '').trim();
      if (!image) throw HttpError.badRequest('image is required');
      const path = trivyPath();
      if (!path) throw new HttpError(503, 'upstream', 'Trivy is not installed. brew install trivy, then scan again.');
      const cached = cache.get(image);
      if (cached && Date.now() - cached.at < 10 * 60_000 && !body.force) {
        res.json({ cached: true, ...cached.report });
        return;
      }
      const output = await new Promise<string>((resolve, reject) => {
        execFile(path, ['image', '--quiet', '--format', 'json', '--scanners', 'vuln', image], { maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 }, (error, stdout, stderr) => {
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
      const path = trivyPath();

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
      const child = spawn(path, ['image', '--format', 'json', '--scanners', 'vuln', image], { env: { ...process.env, NO_COLOR: '1' } });

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

  return router;
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
