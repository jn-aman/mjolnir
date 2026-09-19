import { Router } from 'express';
import { markSvg } from '@mjolnir/brand';
import { logger } from '@mjolnir/logger';
import { devicePage, download, landing, legal, pricing, type DownloadInfo } from './pages.ts';

const log = logger.child('www');

/**
 * mjolnir.sh.
 *
 * Mounted on the same process as the API, which means one thing to deploy and
 * one tunnel route. `/device` is the page that matters: everything else here
 * can be wrong for a day and cost nothing, and that one has a person sitting
 * in front of it with a code in their hand.
 */
export interface WwwOptions {
  readonly version: string;
  /** Where the built app lives, filled in by the release flow. */
  readonly release?: DownloadInfo | undefined;
}

export function wwwRoutes(options: WwwOptions): Router {
  const router = Router();

  // Cached hard: it is a static mark and it changes when the app does.
  router.get('/favicon.svg', (_req, res) => {
    res.type('image/svg+xml').set('cache-control', 'public, max-age=86400').send(markSvg({ size: 32, tile: true }));
  });

  router.get('/', (_req, res) => {
    res.type('html').send(landing(options.release?.version ?? options.version));
  });

  router.get('/pricing', (_req, res) => res.type('html').send(pricing()));
  router.get('/legal', (_req, res) => res.type('html').send(legal()));

  router.get('/download', (_req, res) => {
    res.type('html').send(download(options.release ?? { version: options.version }));
  });

  /**
   * Where a sign-in finishes.
   *
   * `?code=` comes from the app's `verification_uri_complete`, so somebody who
   * can click has nothing to type. Somebody who cannot, because the app is on
   * a server and the browser is on their phone, types eight characters.
   */
  router.get('/device', (req, res) => {
    const code = String(req.query['code'] ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, 9);
    log.debug('device page opened', { prefilled: code.length > 0 });
    res.type('html').set('cache-control', 'no-store').send(devicePage(code));
  });

  return router;
}
