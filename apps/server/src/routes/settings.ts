import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import type { SettingsStore } from '../settings.ts';
import { handle } from '../http.ts';

export function settingsRoutes(settings: SettingsStore): Router {
  const router = Router();

  router.get(
    '/',
    handle(async (_req, res) => {
      // The stdio MCP entry point, as a command an agent config can launch.
      const here = dirname(fileURLToPath(import.meta.url));
      const stdio = join(here, '..', 'mcp', 'stdio.js');
      res.json({ settings: settings.redacted(), path: settings.path, mcpCommand: `${process.execPath} ${stdio}` });
    }),
  );

  router.put(
    '/',
    handle(async (req, res) => {
      const patch = (req.body ?? {}) as Record<string, unknown>;
      const mcp = patch['mcp'] as Record<string, unknown> | undefined;
      // Turning HTTP MCP on without a token mints one; a bare local port that
      // any process could drive is not something to hand out by default.
      if (mcp?.['http'] === true && !settings.get().mcp.token && !mcp['token']) {
        mcp['token'] = randomBytes(24).toString('base64url');
      }
      settings.update(patch);
      res.json({ settings: settings.redacted() });
    }),
  );

  /** The token, shown once so it can be pasted into an agent's config. */
  router.post(
    '/mcp-token',
    handle(async (_req, res) => {
      const token = randomBytes(24).toString('base64url');
      settings.update({ mcp: { token } });
      res.json({ token });
    }),
  );

  return router;
}
