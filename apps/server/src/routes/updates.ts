import { Router } from 'express';
import { ENDPOINTS } from '@mjolnir/endpoints';
import { desktopBridge } from '../desktop-bridge.ts';
import type { SettingsStore } from '../settings.ts';
import { handle, HttpError } from '../http.ts';
import { APP_VERSION } from '../version.ts';

export function updateRoutes(settings: SettingsStore): Router {
  const router = Router();

  router.get(
    '/',
    handle(async (_req, res) => {
      const bridge = desktopBridge();
      res.json({
        version: APP_VERSION,
        feed: `${ENDPOINTS.updates}/${settings.get().updates.channel}`,
        preferences: settings.get().updates,
        state: bridge ? bridge.updateState() : { status: 'unsupported' },
      });
    }),
  );

  router.put(
    '/preferences',
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Partial<{ channel: 'stable' | 'beta'; automatic: boolean; checkOnLaunch: boolean; skipped: string }>;
      if (body.channel !== undefined && body.channel !== 'stable' && body.channel !== 'beta') {
        throw HttpError.badRequest('channel is stable or beta');
      }
      settings.update({ updates: body });
      desktopBridge()?.applyPreferences(settings.get().updates);
      res.json({ preferences: settings.get().updates });
    }),
  );

  router.post(
    '/check',
    handle(async (_req, res) => {
      const bridge = desktopBridge();
      if (!bridge) {
        res.json({ state: { status: 'unsupported' }, message: 'This build does not update itself. Download the current version from mjolnir.sh.' });
        return;
      }
      await bridge.check(false);
      res.json({ state: bridge.updateState() });
    }),
  );

  router.post(
    '/install',
    handle(async (_req, res) => {
      const bridge = desktopBridge();
      if (!bridge) throw HttpError.badRequest('This build does not update itself.');
      res.json({ ok: true });
      // Answer first: quitAndInstall tears the process down under us.
      setTimeout(() => bridge.installNow(), 150);
    }),
  );

  return router;
}
