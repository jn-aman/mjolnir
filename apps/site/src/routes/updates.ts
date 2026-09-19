import { createReadStream, existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { Router } from 'express';
import { logger } from '@mjolnir/logger';

const log = logger.child('updates');

/**
 * The update feed, served from the same process as everything else.
 *
 * electron-updater wants a directory per channel, platform and architecture,
 * holding a `latest-mac.yml` and the archives it names. That is a static file
 * server with two rules, so it is one here rather than a second deployment, a
 * second certificate and a second thing to be down while the first is fine.
 *
 * It is deliberately not `express.static`. The files are the thing an app
 * downloads and runs, so the path handling is written out and read rather
 * than configured: a traversal here hands somebody an arbitrary file off the
 * host, and the fix for that should be visible in the diff.
 */
export interface UpdateOptions {
  /** Where the published builds live on disk. */
  readonly directory: string;
}

/** Only what a release is made of. An update feed serves nothing else. */
const SERVABLE = new Map<string, string>([
  ['.yml', 'text/yaml; charset=utf-8'],
  ['.yaml', 'text/yaml; charset=utf-8'],
  ['.zip', 'application/zip'],
  ['.dmg', 'application/x-apple-diskimage'],
  ['.blockmap', 'application/octet-stream'],
  ['.exe', 'application/vnd.microsoft.portable-executable'],
  ['.AppImage', 'application/octet-stream'],
  ['.deb', 'application/vnd.debian.binary-package'],
]);

export function updateRoutes(options: UpdateOptions): Router {
  const router = Router();
  const root = resolve(options.directory);

  /**
   * What the newest build is, for anything that is not electron-updater.
   *
   * The website reads this rather than being told at deploy time, so
   * publishing a release does not need the site restarted to admit it exists.
   */
  router.get('/latest.json', async (_req, res) => {
    const manifest = join(root, 'latest.json');
    if (!existsSync(manifest)) {
      res.status(404).json({ error: 'not_published', error_description: 'no build has been published yet' });
      return;
    }
    res.set('cache-control', 'no-cache').type('json').send(await readFile(manifest, 'utf8'));
  });

  /** Everything published, for a human checking what is on the server. */
  router.get('/', async (_req, res) => {
    if (!existsSync(root)) {
      res.json({ published: [] });
      return;
    }
    const walk = async (directory: string, prefix = ''): Promise<string[]> => {
      const entries = await readdir(directory, { withFileTypes: true });
      const found: string[] = [];
      for (const entry of entries) {
        const next = `${prefix}${entry.name}`;
        if (entry.isDirectory()) found.push(...(await walk(join(directory, entry.name), `${next}/`)));
        else if (SERVABLE.has(extension(entry.name))) found.push(next);
      }
      return found;
    };
    res.json({ published: (await walk(root)).sort() });
  });

  router.get('/{*path}', (req, res) => {
    const requested = Array.isArray(req.params['path']) ? req.params['path'].join('/') : String(req.params['path'] ?? '');

    /*
     * The two rules.
     *
     * Resolve the whole path and check it is still inside the root, rather
     * than looking for `..` in the string: `%2e%2e`, a symlink and a Windows
     * separator are all the same attack and only one of them looks like one.
     * Then check the extension against a list of what a release is made of,
     * so a file that somehow lands in the directory is not served because it
     * is there.
     */
    const target = resolve(root, normalize(requested));
    if (target !== root && !target.startsWith(root + sep)) {
      log.warn('refused a path outside the update directory', { requested });
      res.status(400).json({ error: 'invalid_path' });
      return;
    }

    const type = SERVABLE.get(extension(target));
    if (!type) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const size = statSync(target).size;
    res.set({
      'content-type': type,
      'content-length': String(size),
      // An archive at a version is that archive forever; a manifest is the
      // question "is there something newer", which must never be cached.
      'cache-control': type === 'text/yaml; charset=utf-8' ? 'no-cache' : 'public, max-age=31536000, immutable',
      // electron-updater asks for ranges when resuming a download.
      'accept-ranges': 'bytes',
    });
    createReadStream(target).pipe(res);
  });

  return router;
}

function extension(name: string): string {
  const at = name.lastIndexOf('.');
  return at === -1 ? '' : name.slice(at);
}
