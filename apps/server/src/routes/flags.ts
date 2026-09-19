import { Router } from 'express';
import { fetchFeatures } from '@mjolnir/flags';
import { hostRefusal } from '@mjolnir/endpoints';
import type { FlagStore } from '../flags.ts';
import type { SettingsStore } from '../settings.ts';
import { handle, HttpError } from '../http.ts';

export function flagRoutes(flags: FlagStore, settings: SettingsStore): Router {
  const router = Router();

  router.get(
    '/',
    handle(async (_req, res) => {
      res.json({ flags: flags.statesCounted(), remote: flags.status(), context: flags.context() });
    }),
  );

  /** Move one switch. `value: null` hands the flag back to the remote or the build. */
  router.put(
    '/:id',
    handle(async (req, res) => {
      const id = String(req.params.id ?? '');
      const body = (req.body ?? {}) as { value?: boolean | null };
      if (body.value !== null && typeof body.value !== 'boolean') {
        throw HttpError.badRequest('value must be true, false, or null to clear the override');
      }
      if (!flags.states().some((state) => state.id === id)) throw HttpError.notFound(`no flag called ${id}`);
      res.json({ flags: flags.override(id, body.value ?? null) });
    }),
  );

  router.post(
    '/refresh',
    handle(async (_req, res) => {
      const status = await flags.refresh();
      res.json({ flags: flags.states(), remote: status });
    }),
  );

  /**
   * Try a connection before saving it, so a wrong token is a sentence on the
   * settings page rather than a flag that quietly never changes.
   */
  router.post(
    '/test',
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { url?: string; token?: string; environment?: string };
      const url = body.url ?? settings.get().flags.remote.url;
      const refusal = hostRefusal(url);
      if (refusal) throw HttpError.badRequest(refusal);
      const token = body.token && body.token !== 'set' ? body.token : settings.get().flags.remote.token;
      try {
        const features = await fetchFeatures({
          url,
          token,
          appName: 'mjolnir',
          environment: body.environment ?? settings.get().flags.remote.environment,
          instanceId: settings.installId(),
        });
        const known = new Set(flags.states().map((state) => state.id));
        res.json({
          ok: true,
          count: features.length,
          matched: features.filter((feature) => known.has(feature.name)).map((feature) => feature.name),
          ignored: features.filter((feature) => !known.has(feature.name)).map((feature) => feature.name),
        });
      } catch (error) {
        res.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }),
  );

  return router;
}
