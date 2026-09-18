import { Router } from 'express';
import { RESOURCES, collectionPath, resolveResource } from '@odin/k8s';
import type { ClusterRegistry } from '../clusters.ts';
import { HttpError, handle, param, query } from '../http.ts';

export function resourceRoutes(registry: ClusterRegistry): Router {
  const router = Router();

  /** The kinds this build knows about, so the client never hard-codes them. */
  router.get(
    '/kinds',
    handle(async (_req, res) => {
      res.json({ resources: RESOURCES });
    }),
  );

  /**
   * List a kind, served from the watch cache.
   *
   * The first request for a kind starts a watch and may return an empty list
   * while it syncs; `state` tells the client which it is, so a syncing cache
   * renders a spinner and a genuinely empty namespace renders an empty state.
   * Conflating those two is the most common way a cluster UI lies to you.
   */
  router.get(
    '/:context/:kind',
    handle(async (req, res) => {
      const contextName = param(req, 'context');
      const kindInput = param(req, 'kind');
      const namespace = query(req, 'namespace');

      const resource = resolveResource(kindInput);
      if (!resource) throw HttpError.badRequest(`unknown resource kind: ${kindInput}`);

      const connection = registry.connect(contextName);
      const watch = connection.watch(resource, resource.namespaced ? namespace : undefined);
      const snapshot = watch.snapshot();

      res.json({
        kind: resource.kind,
        namespaced: resource.namespaced,
        state: snapshot.state,
        error: snapshot.error,
        updatedAt: snapshot.updatedAt,
        items: snapshot.items,
      });
    }),
  );

  /**
   * Fetch one object directly rather than from the cache.
   *
   * A detail view asks for the freshest copy: the cache is fine for a list, but
   * someone looking at a single object is usually about to act on it, and
   * acting on a stale resourceVersion fails the write.
   */
  router.get(
    '/:context/:kind/:name',
    handle(async (req, res) => {
      const contextName = param(req, 'context');
      const kindInput = param(req, 'kind');
      const name = param(req, 'name');
      const namespace = query(req, 'namespace');

      const resource = resolveResource(kindInput);
      if (!resource) throw HttpError.badRequest(`unknown resource kind: ${kindInput}`);
      if (resource.namespaced && !namespace) {
        throw HttpError.badRequest(`${resource.kind} is namespaced; namespace is required`);
      }

      const connection = registry.connect(contextName);
      const path = `${collectionPath(resource, namespace)}/${encodeURIComponent(name)}`;
      const object = await connection.transport.json(path);
      res.json(object);
    }),
  );

  return router;
}
