import { Router } from 'express';
import { changesBetween, explainChange, resolveResource } from '@mjolnir/k8s';
import type { CrdCatalogue } from '../crds.ts';
import type { FlagStore } from '../flags.ts';
import type { HistoryRecorder } from '../history.ts';
import { HttpError, handle, param, query } from '../http.ts';

/**
 * What an object used to look like, and what changed when.
 *
 * The window is whatever has been recorded since somebody first opened this
 * kind, which is usually not long, and the answer says so. A history page
 * that shows an empty list without explaining that it only started watching a
 * minute ago is a page that reads as "nothing changed".
 */
export function historyRoutes(history: HistoryRecorder, crds: CrdCatalogue, flags: FlagStore): Router {
  const router = Router();

  router.get(
    '/:context/:kind/:name',
    handle(async (req, res) => {
      if (!flags.value('kubernetes.history')) {
        throw new HttpError(404, 'not-found', 'time travel is switched off in this build');
      }

      const contextName = param(req, 'context');
      const kindInput = param(req, 'kind');
      const name = param(req, 'name');
      const namespace = query(req, 'namespace') ?? '';

      const definition = resolveResource(kindInput) ?? (await crds.resolve(contextName, kindInput));
      if (!definition) throw HttpError.badRequest(`unknown resource kind: ${kindInput}`);

      // Opening the history of a kind is the thing that starts recording it,
      // so asking is never wasted even when the answer is empty this time.
      history.follow(contextName, definition, definition.namespaced && namespace ? namespace : undefined);

      const revisions = history.revisions(contextName, definition.kind, name, namespace || undefined);
      const entries = revisions.map((revision, index) => {
        const previous = revisions[index - 1];
        const changes = previous ? changesBetween(previous.object, revision.object) : [];
        return {
          at: new Date(revision.at).toISOString(),
          resourceVersion: revision.resourceVersion,
          kind: revision.kind,
          origin: revision.origin,
          changes: changes.map((change) => ({
            ...change,
            ...(explainChange(change) ? { note: explainChange(change) } : {}),
          })),
        };
      });

      res.json({
        recording: history.following(contextName, definition.kind),
        object: { kind: definition.kind, name, namespace: namespace || null },
        /*
         * Newest first, which is the order somebody reads an incident in: you
         * start from "it is broken now" and walk backwards to the change.
         */
        revisions: [...entries].reverse(),
        /** So the page can say "since you opened this", rather than implying more. */
        since: entries[0]?.at ?? null,
      });
    }),
  );

  router.get(
    '/:context/:kind/:name/at/:index',
    handle(async (req, res) => {
      const contextName = param(req, 'context');
      const kindInput = param(req, 'kind');
      const name = param(req, 'name');
      const namespace = query(req, 'namespace') ?? '';
      const definition = resolveResource(kindInput) ?? (await crds.resolve(contextName, kindInput));
      if (!definition) throw HttpError.badRequest(`unknown resource kind: ${kindInput}`);

      const revisions = history.revisions(contextName, definition.kind, name, namespace || undefined);
      const index = Number(param(req, 'index'));
      const revision = revisions[index];
      if (!revision) throw HttpError.notFound('no such revision');
      res.json({ at: new Date(revision.at).toISOString(), object: revision.object });
    }),
  );

  return router;
}
