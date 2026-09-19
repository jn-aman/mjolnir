import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  /** Where published builds are, so the download page can read what exists. */
  readonly updatesDir?: string | undefined;
}

export function wwwRoutes(options: WwwOptions): Router {
  const router = Router();

  /** The current release, as the publish step left it. Null before the first. */
  const published = async (): Promise<DownloadInfo | null> => {
    const path = join(options.updatesDir ?? '/data/updates', 'latest.json');
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(await readFile(path, 'utf8')) as DownloadInfo;
    } catch (error) {
      // A half-written manifest must not take the website down with it.
      log.warn('latest.json did not parse', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };

  // Cached hard: it is a static mark and it changes when the app does.
  router.get('/favicon.svg', (_req, res) => {
    res.type('image/svg+xml').set('cache-control', 'public, max-age=86400').send(markSvg({ size: 32, tile: true }));
  });

  router.get('/', async (_req, res) => {
    res.type('html').send(landing((await published())?.version ?? options.release?.version ?? options.version));
  });

  router.get('/pricing', (_req, res) => res.type('html').send(pricing()));
  router.get('/legal', (_req, res) => res.type('html').send(legal()));

  /*
   * The download page reads what is actually published.
   *
   * From the file the release script writes, not from the environment this
   * process started with, so publishing a build does not need the site
   * restarted before it will admit the build exists.
   */
  router.get('/download', async (_req, res) => {
    res.type('html').send(download((await published()) ?? options.release ?? { version: options.version }));
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
