import type { ResourceDefinition } from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';
import type { ClusterConnection } from './clusters.ts';

const log = logger.child('watch-wait');

/**
 * A watch cache with something in it.
 *
 * Reading `snapshot()` the instant after asking for a watch gives you an empty
 * list, because the first list call has not come back yet. Callers that do not
 * wait get "there is nothing here", which for most features is a wrong answer
 * dressed as a real one.
 *
 * The condition matters and was wrong once. A watch starts at `idle` and
 * becomes `connecting` a tick later, so waiting *while* it is `connecting`
 * returns immediately with an empty cache on the very first call and works on
 * every call after. The bug it produced was the worst kind: the feature looked
 * broken once, then fixed itself, so it never reproduced when anybody went to
 * look. Wait for a state that means it is finished, not for one that means it
 * has started.
 */
export async function warmSnapshot(
  connection: ClusterConnection,
  resource: ResourceDefinition,
  namespace?: string,
  timeoutMs = 4000,
): Promise<{ items: readonly unknown[]; state: string }> {
  const watch = connection.watch(resource, namespace);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const snapshot = watch.snapshot();
    if (snapshot.state === 'synced' || snapshot.state === 'error') {
      return { items: snapshot.items, state: snapshot.state };
    }
    if (Date.now() >= deadline) {
      // A slow cluster is not a reason to hang a request. The caller gets
      // whatever arrived, and the state says it is not the whole story.
      log.debug('watch did not sync in time', { kind: resource.kind, namespace, state: snapshot.state });
      return { items: snapshot.items, state: snapshot.state };
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}
