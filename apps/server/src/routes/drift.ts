import { Router } from 'express';
import { loadAll as parseYamlAll } from 'js-yaml';
import {
  decodeHelmReleases,
  detectDrift,
  findInManifest,
  lastApplied,
  resolveResource,
  type DriftSource,
  type HelmSecretShape,
} from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from '../clusters.ts';
import type { CrdCatalogue } from '../crds.ts';
import type { FlagStore } from '../flags.ts';
import { HttpError, handle, param, query } from '../http.ts';
import { warmSnapshot } from '../watch-wait.ts';

const log = logger.child('drift');

/**
 * What the cluster is running against what somebody said it should run.
 *
 * The work here is finding the desired state, because Kubernetes does not
 * store it. Three places have a claim on it, and they are tried in the order
 * of how much they are worth believing:
 *
 * 1. **The Helm release that owns the object**, found through the annotations
 *    Helm writes on everything it installs. This is the strongest answer,
 *    because the next `helm upgrade` will reassert exactly this, so drift
 *    against it is drift that will be undone whether anybody meant it or not.
 * 2. **The `last-applied-configuration` annotation**, which is what somebody
 *    last ran `kubectl apply` with. Drift against it is somebody having used
 *    `kubectl edit`, `kubectl scale` or the API directly since.
 * 3. **Nothing**, which is the honest answer for an object a controller made.
 *    A ReplicaSet has no desired state anybody wrote down, and inventing one
 *    would be worse than saying so.
 */
export function driftRoutes(registry: ClusterRegistry, crds: CrdCatalogue, flags: FlagStore): Router {
  const router = Router();

  router.get(
    '/:context/:kind/:name',
    handle(async (req, res) => {
      if (!flags.value('kubernetes.drift')) {
        throw new HttpError(404, 'not-found', 'the drift tool is switched off in this build');
      }

      const contextName = param(req, 'context');
      const kindInput = param(req, 'kind');
      const name = param(req, 'name');
      const namespace = query(req, 'namespace') ?? '';
      const connection = registry.connect(contextName);

      const definition = resolveResource(kindInput) ?? (await crds.resolve(contextName, kindInput));
      if (!definition) throw HttpError.badRequest(`unknown resource kind: ${kindInput}`);

      const path = definition.namespaced && namespace
        ? `${prefix(definition)}/namespaces/${encodeURIComponent(namespace)}/${definition.plural}/${encodeURIComponent(name)}`
        : `${prefix(definition)}/${definition.plural}/${encodeURIComponent(name)}`;
      const live = await connection.json<Record<string, unknown>>(path);
      const kind = String(live['kind'] ?? definition.kind);

      const found = await desiredState(registry, contextName, live, { kind, name, namespace });
      if (!found) {
        res.json({
          available: false,
          object: { kind, name, namespace: namespace || null },
          /*
           * Said plainly rather than shown as an empty diff. "No differences"
           * and "nothing to compare against" look identical and mean opposite
           * things, and conflating them is how a drift page quietly reassures
           * somebody about an object it never checked.
           */
          reason: reasonFor(live, kind),
        });
        return;
      }

      const report = detectDrift({ live, desired: found.desired, source: found.source, against: found.against });
      log.info('drift checked', { context: contextName, kind, name, source: found.source, changes: report.changes.length });
      res.json({ available: true, ...report });
    }),
  );

  return router;
}

function prefix(definition: { group?: string; version: string }): string {
  return definition.group ? `/apis/${definition.group}/${definition.version}` : `/api/${definition.version}`;
}

interface Desired {
  readonly desired: Record<string, unknown>;
  readonly source: DriftSource;
  readonly against: string;
}

async function desiredState(
  registry: ClusterRegistry,
  contextName: string,
  live: Record<string, unknown>,
  target: { kind: string; name: string; namespace: string },
): Promise<Desired | null> {
  const metadata = (live['metadata'] ?? {}) as { annotations?: Record<string, string> };
  const annotations = metadata.annotations ?? {};
  const release = annotations['meta.helm.sh/release-name'];
  const releaseNamespace = annotations['meta.helm.sh/release-namespace'];

  if (release && releaseNamespace) {
    const manifest = await helmManifest(registry, contextName, release, releaseNamespace);
    const document = manifest ? findInManifest(manifest, { kind: target.kind, name: target.name, namespace: target.namespace }) : null;
    // A release whose manifest we cannot read, or which no longer renders this
    // object, falls through to the annotation rather than reporting nothing.
    if (document) {
      return { desired: document, source: 'helm', against: `the ${release} chart` };
    }
  }

  const applied = lastApplied(live);
  if (applied) return { desired: applied, source: 'last-applied', against: 'the last kubectl apply' };

  return null;
}

/** The manifest Helm recorded for a release's current revision. */
async function helmManifest(
  registry: ClusterRegistry,
  contextName: string,
  release: string,
  namespace: string,
): Promise<Array<Record<string, unknown>> | null> {
  const resource = resolveResource('Secret');
  if (!resource) return null;
  const snapshot = await warmSnapshot(registry.connect(contextName), resource, namespace);

  const revisions = decodeHelmReleases([...snapshot.items] as unknown as HelmSecretShape[]).filter(
    (entry) => entry.name === release && entry.namespace === namespace,
  );
  const current = revisions[0];
  if (!current?.manifest) return null;

  try {
    // A chart's manifest is many documents in one string, and empty ones are
    // normal: a template guarded by an `if` renders to nothing at all.
    return parseYamlAll(current.manifest).filter(
      (document): document is Record<string, unknown> => typeof document === 'object' && document !== null,
    );
  } catch (error) {
    log.debug('a helm manifest did not parse', { release, error: String(error) });
    return null;
  }
}

/** Why there is nothing to compare against, in words for the panel. */
function reasonFor(live: Record<string, unknown>, kind: string): string {
  const metadata = (live['metadata'] ?? {}) as { ownerReferences?: Array<{ kind?: string; name?: string }> };
  const owner = metadata.ownerReferences?.[0];
  if (owner?.kind) {
    return `${kind} ${owner.name ? `is made by ${owner.kind} ${owner.name}` : `is made by a ${owner.kind}`}, so its desired state is that object's, not something anybody wrote. Check the ${owner.kind} instead.`;
  }
  return `Nothing recorded what this ${kind.toLowerCase()} should look like. It was not installed by Helm, and it has no last-applied annotation, which means it was created by something other than kubectl apply: server-side apply, a controller, or the API directly.`;
}
