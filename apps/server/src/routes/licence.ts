import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Router } from 'express';
import { verifyLicense, type LicenseStatus } from '@mjolnir/licensing';
import type { SettingsStore } from '../settings.ts';
import { HttpError, handle } from '../http.ts';

/**
 * Licence activation. The key is verified here against the public key and
 * stored in settings; the tier it grants is what the client asks for.
 *
 * The public key comes from MJOLNIR_LICENCE_PUBLIC_KEY or
 * ~/.mjolnir/licence-public.pem (what `npm run licence -- --init` writes).
 * Release builds embed it. With no key configured, every licence is reported
 * as unconfigured rather than invalid, so a build mistake reads as one.
 */
function publicKeyPem(): string | null {
  const fromEnv = process.env['MJOLNIR_LICENCE_PUBLIC_KEY'];
  if (fromEnv) return fromEnv.replace(/\\n/g, '\n');
  const path = join(homedir(), '.mjolnir', 'licence-public.pem');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function describe(status: LicenseStatus | null): unknown {
  if (!status) return { kind: 'unconfigured', tier: 'free', reason: 'no licence public key configured on this build' };
  switch (status.kind) {
    case 'none':
      return { kind: 'none', tier: 'free' };
    case 'invalid':
      return { kind: 'invalid', tier: 'free', reason: status.reason };
    case 'expired':
      return { kind: 'expired', tier: 'free', email: status.claims.email, plan: status.claims.plan, expiresAt: status.claims.expiresAt ? new Date(status.claims.expiresAt * 1000).toISOString() : null };
    default:
      return {
        kind: status.kind,
        tier: status.tier,
        email: status.claims.email,
        plan: status.claims.plan,
        expiresAt: status.claims.expiresAt ? new Date(status.claims.expiresAt * 1000).toISOString() : null,
        ...(status.kind === 'grace' ? { graceEndsAt: status.graceEndsAt.toISOString() } : {}),
      };
  }
}

export function licenceRoutes(settings: SettingsStore): Router {
  const router = Router();
  const status = (key: string) => {
    const pem = publicKeyPem();
    if (!key) return describe({ kind: 'none', tier: 'free' });
    if (!pem) return describe(null);
    return describe(verifyLicense(key, { publicKeyPem: pem }));
  };

  router.get('/', handle(async (_req, res) => res.json(status(settings.get().licence.key))));

  router.post(
    '/',
    handle(async (req, res) => {
      const key = String((req.body as { key?: unknown })?.key ?? '').trim();
      if (!key) throw HttpError.badRequest('paste the licence key');
      const pem = publicKeyPem();
      if (!pem) throw HttpError.badRequest('this build has no licence public key configured');
      const result = verifyLicense(key, { publicKeyPem: pem });
      if (result.tier !== 'pro') {
        throw HttpError.badRequest(result.kind === 'invalid' ? `the key is not valid: ${result.reason}` : 'the key has expired');
      }
      settings.update({ licence: { key } });
      res.json(describe(result));
    }),
  );

  router.delete(
    '/',
    handle(async (_req, res) => {
      settings.update({ licence: { key: '' } });
      res.json(describe({ kind: 'none', tier: 'free' }));
    }),
  );

  return router;
}
