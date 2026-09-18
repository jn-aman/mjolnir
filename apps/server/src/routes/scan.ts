import { execFile } from 'node:child_process';
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

const cache = new Map<string, { at: number; report: object }>();

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
      const report = { image, scannedAt: new Date().toISOString(), os: parsed.Metadata?.OS, total: findings.length, bySeverity, fixable: findings.filter((f) => f.fixed).length, findings };
      cache.set(image, { at: Date.now(), report });
      res.json({ cached: false, ...report });
    }),
  );

  return router;
}
