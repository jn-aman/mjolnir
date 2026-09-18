import { Router } from 'express';
import type { ClusterRegistry } from '../clusters.ts';
import { handle, param, query, queryBoolean, queryNumber } from '../http.ts';

export function logRoutes(registry: ClusterRegistry): Router {
  const router = Router();

  /**
   * A finite slice of logs.
   *
   * The streaming path is a WebSocket; this exists for the initial render and
   * for anything that wants a bounded read, a download, a crash-log peek, a
   * copy to clipboard.
   */
  router.get(
    '/:context/:namespace/:pod',
    handle(async (req, res) => {
      const connection = registry.connect(param(req, 'context'));
      const container = query(req, 'container');
      const sinceTime = query(req, 'sinceTime');
      const tailLines = queryNumber(req, 'tailLines');
      const sinceSeconds = queryNumber(req, 'sinceSeconds');
      const limitBytes = queryNumber(req, 'limitBytes');

      const lines = await connection.readLogs({
        namespace: param(req, 'namespace'),
        pod: param(req, 'pod'),
        previous: queryBoolean(req, 'previous'),
        ...(container ? { container } : {}),
        ...(tailLines !== undefined ? { tailLines } : {}),
        ...(sinceSeconds !== undefined ? { sinceSeconds } : {}),
        ...(sinceTime ? { sinceTime } : {}),
        ...(limitBytes !== undefined ? { limitBytes } : {}),
      });

      res.json({ lines });
    }),
  );

  return router;
}
