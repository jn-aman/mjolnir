import { Router } from 'express';
import { load as parseYaml } from 'js-yaml';
import { RESOURCES, collectionPath, resolveResource } from '@mjolnir/k8s';
import type { ResourceDefinition } from '@mjolnir/k8s';
import type { ClusterRegistry } from '../clusters.ts';
import type { CrdCatalogue } from '../crds.ts';
import { HttpError, handle, param, query } from '../http.ts';

export function resourceRoutes(registry: ClusterRegistry, crds: CrdCatalogue): Router {
  const router = Router();

  /**
   * Built-in kinds first, then whatever this cluster serves.
   *
   * Built-ins win on a name clash because a cluster that defines its own
   * `Deployment` should not be able to redirect the Workloads section, and
   * because the built-in table carries categories and aliases that a CRD does
   * not. Everything downstream treats the two identically.
   */
  const resolve = async (contextName: string, input: string): Promise<ResourceDefinition> => {
    const builtin = resolveResource(input);
    if (builtin) return builtin;
    const custom = await crds.resolve(contextName, input);
    if (custom) return custom;
    throw HttpError.badRequest(`unknown resource kind: ${input}`);
  };

  /** The kinds this build knows about, so the client never hard-codes them. */
  router.get(
    '/kinds',
    handle(async (_req, res) => {
      res.json({ resources: RESOURCES });
    }),
  );

  /**
   * The kinds one cluster serves: the built-ins plus its own custom resources.
   *
   * Separate from `/kinds` because the answer is per cluster. A build talks to
   * a bare kind cluster and an Argo-and-Crossplane cluster in the same window,
   * and the sidebar has to differ between them.
   */
  router.get(
    '/kinds/:context',
    handle(async (req, res) => {
      const contextName = param(req, 'context');
      const custom = await crds.list(contextName, { fresh: query(req, 'fresh') === 'true' });
      res.json({ resources: RESOURCES, custom });
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

      const resource = await resolve(contextName, kindInput);

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

      const resource = await resolve(contextName, kindInput);
      if (resource.namespaced && !namespace) {
        throw HttpError.badRequest(`${resource.kind} is namespaced; namespace is required`);
      }

      const connection = registry.connect(contextName);
      const path = `${collectionPath(resource, namespace)}/${encodeURIComponent(name)}`;
      const object = await connection.json(path);
      res.json(object);
    }),
  );

  /**
   * Replace an object from edited YAML.
   *
   * Parsed here rather than in the renderer so a malformed document is refused
   * with the parser's own message and line, and nothing half-formed reaches the
   * API server. The object's name and namespace in the body must match the
   * path, a YAML tab is not the place to quietly rename something.
   */
  /**
   * Create an object from YAML, `kubectl create -f`. The namespace comes from
   * the document, falling back to the query, so a manifest pasted from
   * elsewhere lands where it says it belongs.
   */
  router.post(
    '/:context/:kind',
    handle(async (req, res) => {
      const contextName = param(req, 'context');
      const kindInput = param(req, 'kind');
      const resource = await resolve(contextName, kindInput);

      const text = (req.body as { yaml?: unknown })?.yaml;
      if (typeof text !== 'string' || text.trim() === '') throw HttpError.badRequest('expected a yaml field');
      let object: unknown;
      try {
        object = parseYaml(text);
      } catch (error) {
        throw HttpError.badRequest(`YAML did not parse: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!object || typeof object !== 'object') throw HttpError.badRequest('YAML must describe an object');
      const meta = (object as { kind?: unknown; metadata?: { name?: unknown; namespace?: unknown } });
      if (meta.kind !== resource.kind) throw HttpError.badRequest(`kind must be ${resource.kind}`);
      if (typeof meta.metadata?.name !== 'string' || !meta.metadata.name) throw HttpError.badRequest('metadata.name is required');
      const namespace =
        typeof meta.metadata.namespace === 'string' ? meta.metadata.namespace : query(req, 'namespace');
      if (resource.namespaced && !namespace) throw HttpError.badRequest(`${resource.kind} is namespaced; set metadata.namespace`);
      if (resource.namespaced && meta.metadata.namespace === undefined) {
        (object as { metadata: Record<string, unknown> }).metadata['namespace'] = namespace;
      }

      const connection = registry.connect(contextName);
      res.status(201).json(await connection.create(collectionPath(resource, resource.namespaced ? namespace : undefined), object));
    }),
  );

  /**
   * Evict a pod, what `kubectl drain` does per pod. Goes through the Eviction
   * API rather than DELETE so PodDisruptionBudgets are honoured.
   */
  router.post(
    '/:context/Pod/:name/evict',
    handle(async (req, res) => {
      const contextName = param(req, 'context');
      const name = param(req, 'name');
      const namespace = query(req, 'namespace');
      if (!namespace) throw HttpError.badRequest('namespace is required');
      const resource = await resolve(contextName, 'Pod');
      const connection = registry.connect(contextName);
      const path = `${collectionPath(resource, namespace)}/${encodeURIComponent(name)}/eviction`;
      res.json(
        await connection.create(path, {
          apiVersion: 'policy/v1',
          kind: 'Eviction',
          metadata: { name, namespace },
        }),
      );
    }),
  );

  router.put(
    '/:context/:kind/:name',
    handle(async (req, res) => {
      const contextName = param(req, 'context');
      const kindInput = param(req, 'kind');
      const name = param(req, 'name');
      const namespace = query(req, 'namespace');

      const resource = await resolve(contextName, kindInput);

      const text = (req.body as { yaml?: unknown })?.yaml;
      if (typeof text !== 'string' || text.trim() === '') {
        throw HttpError.badRequest('expected a yaml field with the document to apply');
      }

      let object: unknown;
      try {
        object = parseYaml(text);
      } catch (error) {
        throw HttpError.badRequest(`YAML did not parse: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!object || typeof object !== 'object') throw HttpError.badRequest('YAML must describe an object');

      const meta = (object as { metadata?: { name?: unknown; namespace?: unknown } }).metadata;
      if (meta?.name !== name) throw HttpError.badRequest(`metadata.name must be ${name}`);
      if (resource.namespaced && namespace && meta?.namespace !== namespace) {
        throw HttpError.badRequest(`metadata.namespace must be ${namespace}`);
      }

      const connection = registry.connect(contextName);
      const path = `${collectionPath(resource, namespace)}/${encodeURIComponent(name)}`;
      res.json(await connection.replace(path, object));
    }),
  );

  /**
   * Merge-patch an object. The body is the patch itself, so a label edit is
   * `{ metadata: { labels: { team: "payments" } } }` and a removal sets the key
   * to null, exactly the shape kubectl sends for `kubectl label`.
   */
  router.patch(
    '/:context/:kind/:name',
    handle(async (req, res) => {
      const contextName = param(req, 'context');
      const kindInput = param(req, 'kind');
      const name = param(req, 'name');
      const namespace = query(req, 'namespace');

      const resource = await resolve(contextName, kindInput);
      if (resource.namespaced && !namespace) {
        throw HttpError.badRequest(`${resource.kind} is namespaced; namespace is required`);
      }
      const body: unknown = req.body;
      if (!body || typeof body !== 'object') throw HttpError.badRequest('expected a JSON merge patch');

      const connection = registry.connect(contextName);
      const path = `${collectionPath(resource, namespace)}/${encodeURIComponent(name)}`;
      res.json(await connection.patch(path, body));
    }),
  );

  router.delete(
    '/:context/:kind/:name',
    handle(async (req, res) => {
      const contextName = param(req, 'context');
      const kindInput = param(req, 'kind');
      const name = param(req, 'name');
      const namespace = query(req, 'namespace');

      const resource = await resolve(contextName, kindInput);
      if (resource.namespaced && !namespace) {
        throw HttpError.badRequest(`${resource.kind} is namespaced; namespace is required`);
      }

      const connection = registry.connect(contextName);
      const path = `${collectionPath(resource, namespace)}/${encodeURIComponent(name)}`;
      res.json(await connection.remove(path));
    }),
  );

  return router;
}
