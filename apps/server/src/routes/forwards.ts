import { Router } from 'express';
import type { ForwardManager } from '../forwards.ts';
import { HttpError, handle, param } from '../http.ts';

export function forwardRoutes(forwards: ForwardManager): Router {
  const router = Router();

  router.get(
    '/',
    handle(async (_req, res) => {
      res.json({ forwards: forwards.list() });
    }),
  );

  router.post(
    '/',
    handle(async (req, res) => {
      const body = req.body as Partial<{ context: string; namespace: string; pod: string; port: number; localPort: number }>;
      for (const key of ['context', 'namespace', 'pod'] as const) {
        if (typeof body[key] !== 'string' || !body[key]) throw HttpError.badRequest(`${key} is required`);
      }
      const port = Number(body.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw HttpError.badRequest('port must be 1–65535');
      const localPort = body.localPort === undefined ? undefined : Number(body.localPort);
      if (localPort !== undefined && (!Number.isInteger(localPort) || localPort < 0 || localPort > 65535)) {
        throw HttpError.badRequest('localPort must be 0–65535');
      }
      const record = await forwards.start({
        context: body.context as string,
        namespace: body.namespace as string,
        pod: body.pod as string,
        port,
        ...(localPort ? { localPort } : {}),
      });
      res.status(201).json(record);
    }),
  );

  router.delete(
    '/:id',
    handle(async (req, res) => {
      const id = decodeURIComponent(param(req, 'id'));
      if (!(await forwards.stop(id))) throw HttpError.notFound(`no forward ${id}`);
      res.json({ ok: true });
    }),
  );

  return router;
}
