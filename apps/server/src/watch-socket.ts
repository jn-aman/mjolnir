import { WebSocketServer, type WebSocket } from 'ws';
import { RESOURCES, resolveResource } from '@mjolnir/k8s';
import type { CrdCatalogue } from './crds.ts';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from './clusters.ts';

const log = logger.child('watch-socket');

/**
 * Live lists over one WebSocket at /ws/watch.
 *
 * The client sends `subscribe` with an id, a context, a kind and maybe a
 * namespace; the server subscribes to that kind's watch cache and pushes a
 * snapshot every time it changes (coalesced to at most one frame per 120ms
 * per subscription). A `counts` subscription watches every kind at once and
 * pushes {kind: length}, which is what the sidebar shows. Nothing polls.
 */
interface SubscribeMessage {
  type: 'subscribe';
  id: string;
  context: string;
  kind?: string;
  namespace?: string;
  counts?: boolean;
}

const FRAME_INTERVAL_MS = 120;

export function attachWatchSocket(registry: ClusterRegistry, crds: CrdCatalogue): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (socket: WebSocket) => {
    const subscriptions = new Map<string, () => void>();
    const send = (message: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    /** One frame per interval per subscription, with the latest snapshot. */
    const throttled = (fn: () => void) => {
      let timer: NodeJS.Timeout | null = null;
      let pending = false;
      const run = () => {
        timer = null;
        if (!pending) return;
        pending = false;
        fn();
        timer = setTimeout(run, FRAME_INTERVAL_MS);
      };
      return () => {
        pending = true;
        if (!timer) {
          run();
        }
      };
    };

    socket.on('message', (raw) => {
      void (async () => {
      let message: Partial<Omit<SubscribeMessage, 'type'>> & { type?: string; id?: string };
      try {
        message = JSON.parse(raw.toString()) as typeof message;
      } catch {
        return;
      }
      if (message.type === 'unsubscribe' && message.id) {
        subscriptions.get(message.id)?.();
        subscriptions.delete(message.id);
        return;
      }
      if (message.type !== 'subscribe' || !message.id || !message.context) return;
      const id = message.id;
      subscriptions.get(id)?.();
      try {
        const contextName = message.context;
        const connection = registry.connect(contextName);
        if (message.counts) {
          const counts: Record<string, number> = {};
          const push = throttled(() => send({ type: 'counts', id, counts }));
          const stops = RESOURCES.map((resource) =>
            connection.watch(resource, undefined).subscribe((snapshot) => {
              counts[resource.kind] = snapshot.items.length;
              push();
            }),
          );
          subscriptions.set(id, () => stops.forEach((stop) => stop()));
          return;
        }
        // Built-in first, then this cluster's own custom kinds, so a live
        // list of Argo Applications watches exactly like a list of pods.
        const resource = resolveResource(message.kind ?? '') ?? (await crds.resolve(contextName, message.kind ?? ''));
        if (!resource) {
          send({ type: 'error', id, message: `unknown kind ${message.kind ?? ''}` });
          return;
        }
        const watch = connection.watch(resource, resource.namespaced ? message.namespace : undefined);
        let latest = watch.snapshot();
        const push = throttled(() => send({ type: 'snapshot', id, kind: resource.kind, state: latest.state, error: latest.error, updatedAt: latest.updatedAt, items: latest.items }));
        const stop = watch.subscribe((snapshot) => {
          latest = snapshot;
          push();
        });
        subscriptions.set(id, stop);
      } catch (error) {
        send({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
      }
      })();
    });

    socket.on('close', () => {
      for (const stop of subscriptions.values()) stop();
      subscriptions.clear();
    });
    socket.on('error', (error) => log.debug('watch socket error', { error }));
  });

  return wss;
}
