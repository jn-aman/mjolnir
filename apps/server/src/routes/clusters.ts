import { Router } from 'express';
import type { ClusterRegistry } from '../clusters.ts';
import { handle, param } from '../http.ts';

export function clusterRoutes(registry: ClusterRegistry): Router {
  const router = Router();

  router.get(
    '/',
    handle(async (_req, res) => {
      res.json({
        contexts: registry.contexts,
        currentContext: registry.currentContext,
        // Surfaced rather than swallowed: if one kubeconfig in KUBECONFIG is
        // unreadable, the user should be told which, not silently shown fewer
        // clusters than they have.
        failures: registry.failures,
      });
    }),
  );

  router.post(
    '/reload',
    handle(async (_req, res) => {
      await registry.reload();
      res.json({ contexts: registry.contexts, currentContext: registry.currentContext });
    }),
  );

  /**
   * Reachability for one cluster.
   *
   * Deliberately cheap — `/version` needs no RBAC beyond being authenticated,
   * so it distinguishes "cannot reach" from "reached but not allowed", which a
   * pod list cannot.
   */
  router.get(
    '/:context/status',
    handle(async (req, res) => {
      const name = param(req, 'context');
      const connection = registry.connect(name);
      const startedAt = Date.now();
      try {
        const version = await connection.transport.json<{ gitVersion?: string }>('/version');
        res.json({
          reachable: true,
          version: version.gitVersion ?? null,
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        res.json({
          reachable: false,
          error: error instanceof Error ? error.message : String(error),
          latencyMs: Date.now() - startedAt,
        });
      }
    }),
  );

  router.delete(
    '/:context',
    handle(async (req, res) => {
      await registry.disconnect(param(req, 'context'));
      res.status(204).end();
    }),
  );

  return router;
}
