import { Router } from 'express';
import { EVENTS, type Telemetry } from '../telemetry.ts';
import type { SettingsStore } from '../settings.ts';
import { handle, HttpError } from '../http.ts';

export function telemetryRoutes(telemetry: Telemetry, settings: SettingsStore): Router {
  const router = Router();

  /** The consent state, the catalogue of what can ever be sent, and the queue itself. */
  router.get(
    '/',
    handle(async (_req, res) => {
      res.json({
        consent: settings.get().telemetry,
        catalogue: Object.entries(EVENTS).map(([name, shape]) => ({
          name,
          strings: Object.fromEntries(Object.entries(shape.strings ?? {}).map(([key, values]) => [key, [...values]])),
          numbers: [...(shape.numbers ?? [])],
        })),
        ...telemetry.pending(),
      });
    }),
  );

  router.put(
    '/consent',
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { usage?: unknown; crashes?: unknown };
      if (typeof body.usage !== 'boolean' || typeof body.crashes !== 'boolean') {
        throw HttpError.badRequest('usage and crashes must both be true or false');
      }
      settings.update({ telemetry: { usage: body.usage, crashes: body.crashes, decided: true } });
      // Saying no empties what was already waiting; keeping it would make "no"
      // mean "not yet", which is not what the switch says.
      if (!body.usage && !body.crashes) telemetry.clear();
      res.json({ consent: settings.get().telemetry });
    }),
  );

  router.post(
    '/event',
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { name?: string; props?: Record<string, unknown> };
      telemetry.record(body.name ?? '', body.props ?? {});
      res.json({ ok: true });
    }),
  );

  router.post(
    '/crash',
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { kind?: 'renderer' | 'main' | 'server'; message?: string; stack?: string };
      telemetry.crash(body.kind ?? 'renderer', body.message ?? '', body.stack ?? '');
      res.json({ ok: true });
    }),
  );

  router.post(
    '/flush',
    handle(async (_req, res) => {
      res.json(await telemetry.flush());
    }),
  );

  router.delete(
    '/',
    handle(async (_req, res) => {
      telemetry.clear();
      res.json({ ok: true });
    }),
  );

  return router;
}
