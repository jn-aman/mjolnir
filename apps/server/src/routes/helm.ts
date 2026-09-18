import { Router } from 'express';
import { resolveResource, decodeHelmReleases, latestHelmReleases, type HelmSecretShape } from '@mjolnir/k8s';
import type { ClusterRegistry } from '../clusters.ts';
import { HttpError, handle, param, query } from '../http.ts';

/** Helm releases from the watch cache of Secrets: nothing to install, nothing to run. */
export function helmRoutes(registry: ClusterRegistry): Router {
  const router = Router();

  const secretsFor = async (contextName: string, namespace?: string): Promise<HelmSecretShape[]> => {
    const resource = resolveResource('Secret');
    if (!resource) throw HttpError.badRequest('no Secret kind');
    const watch = registry.connect(contextName).watch(resource, namespace);
    let snapshot = watch.snapshot();
    for (let tries = 0; snapshot.state === 'connecting' && tries < 20; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      snapshot = watch.snapshot();
    }
    return [...snapshot.items] as unknown as HelmSecretShape[];
  };

  router.get(
    '/:context/releases',
    handle(async (req, res) => {
      const releases = latestHelmReleases(await secretsFor(param(req, 'context'), query(req, 'namespace')));
      res.json({ releases: releases.map(({ manifest: _manifest, values: _values, notes: _notes, ...rest }) => rest) });
    }),
  );

  router.get(
    '/:context/releases/:namespace/:name',
    handle(async (req, res) => {
      const namespace = param(req, 'namespace');
      const name = param(req, 'name');
      const revisions = decodeHelmReleases(await secretsFor(param(req, 'context'), namespace)).filter((r) => r.name === name && r.namespace === namespace);
      if (!revisions.length) throw HttpError.notFound(`no Helm release ${namespace}/${name}`);
      const wanted = query(req, 'revision');
      const chosen = wanted ? revisions.find((r) => String(r.revision) === wanted) : revisions[0];
      if (!chosen) throw HttpError.notFound(`no revision ${wanted}`);
      res.json({
        release: chosen,
        history: revisions.map(({ manifest: _m, values: _v, notes: _n, ...rest }) => rest),
      });
    }),
  );

  return router;
}
