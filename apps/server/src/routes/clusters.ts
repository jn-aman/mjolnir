import { Router } from 'express';
import type { ClusterRegistry } from '../clusters.ts';
import { HttpError, handle, param, query } from '../http.ts';
import type { SettingsStore } from '../settings.ts';
import { removeContextFromFile } from '../kubeconfig-edit.ts';

export function clusterRoutes(registry: ClusterRegistry, settings: SettingsStore): Router {
  const router = Router();
  const visible = () => {
    const hidden = new Set(settings.get().clusters.hidden);
    return registry.contexts.filter((context) => !hidden.has(context.name));
  };

  router.get(
    '/',
    handle(async (_req, res) => {
      res.json({
        contexts: visible(),
        hidden: settings.get().clusters.hidden,
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
      res.json({ contexts: visible(), hidden: settings.get().clusters.hidden, currentContext: registry.currentContext });
    }),
  );

  /**
   * Reachability for one cluster.
   *
   * Deliberately cheap, `/version` needs no RBAC beyond being authenticated,
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
        const version = await connection.json<{ gitVersion?: string }>('/version');
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

  /**
   * Remove a cluster. `scope=hide` (default) drops it from Mjolnir and keeps
   * the kubeconfig untouched; `scope=kubeconfig` removes the context from the
   * file it came from, after a backup beside it. The demo cannot be removed.
   */
  router.delete(
    '/:context',
    handle(async (req, res) => {
      const name = param(req, 'context');
      const scope = query(req, 'scope') ?? 'hide';
      if (name === 'demo') throw HttpError.badRequest('the demo cluster is built in');
      await registry.disconnect(name);
      if (scope === 'kubeconfig') {
        const context = registry.contexts.find((entry) => entry.name === name);
        if (!context) throw HttpError.notFound(`unknown context ${name}`);
        const { backup } = removeContextFromFile(context.source, name);
        await registry.reload();
        res.json({ removed: name, backup });
        return;
      }
      const hidden = new Set(settings.get().clusters.hidden);
      hidden.add(name);
      settings.update({ clusters: { hidden: [...hidden] } });
      res.json({ hidden: [...hidden] });
    }),
  );

  /** Bring a hidden cluster back. */
  router.post(
    '/:context/unhide',
    handle(async (req, res) => {
      const name = param(req, 'context');
      settings.update({ clusters: { hidden: settings.get().clusters.hidden.filter((entry) => entry !== name) } });
      res.json({ hidden: settings.get().clusters.hidden });
    }),
  );

  return router;
}
