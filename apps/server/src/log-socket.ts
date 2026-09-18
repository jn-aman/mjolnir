import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { LogLine } from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from './clusters.ts';

const log = logger.child('log-socket');

/** Messages the client sends. One `start` per socket; close to stop. */
interface StartMessage {
  readonly type: 'start';
  readonly context: string;
  readonly namespace: string;
  /** One pod, or several for an aggregated tail. */
  readonly pods: Array<{ name: string; container?: string }>;
  readonly tailLines?: number;
  readonly previous?: boolean;
  readonly sinceSeconds?: number;
}

/**
 * Batched delivery.
 *
 * A busy pod emits thousands of lines a second. Sending one frame per line
 * saturates the socket and makes the renderer do a React update per line, which
 * is precisely how a log viewer freezes. Batching on a short interval turns
 * that into a handful of updates a second at no cost to perceived latency.
 */
const FLUSH_INTERVAL_MS = 80;
const MAX_BATCH = 500;

function isStartMessage(value: unknown): value is StartMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StartMessage>;
  return (
    candidate.type === 'start' &&
    typeof candidate.context === 'string' &&
    typeof candidate.namespace === 'string' &&
    Array.isArray(candidate.pods) &&
    candidate.pods.length > 0 &&
    candidate.pods.every((pod) => typeof pod?.name === 'string')
  );
}

export function attachLogSocket(server: Server, registry: ClusterRegistry): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws/logs' });

  wss.on('connection', (socket: WebSocket) => {
    const abort = new AbortController();
    let pending: LogLine[] = [];
    let timer: NodeJS.Timeout | null = null;
    let started = false;

    const flush = () => {
      timer = null;
      if (pending.length === 0 || socket.readyState !== socket.OPEN) return;
      const batch = pending;
      pending = [];
      socket.send(JSON.stringify({ type: 'lines', lines: batch }));
    };

    const push = (line: LogLine) => {
      pending.push(line);
      // A very chatty pod can outrun the interval; flush early rather than
      // letting the batch grow without bound.
      if (pending.length >= MAX_BATCH) {
        if (timer) clearTimeout(timer);
        flush();
        return;
      }
      timer ??= setTimeout(flush, FLUSH_INTERVAL_MS);
    };

    const fail = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'error', message }));
      }
      log.warn('log stream failed', { error: message });
    };

    socket.on('message', (raw) => {
      if (started) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'message was not JSON' }));
        return;
      }

      if (!isStartMessage(parsed)) {
        socket.send(JSON.stringify({ type: 'error', message: 'expected a start message' }));
        return;
      }

      started = true;
      const message = parsed;

      void (async () => {
        try {
          const connection = registry.connect(message.context);
          const options = {
            follow: true,
            signal: abort.signal,
            ...(message.tailLines !== undefined ? { tailLines: message.tailLines } : {}),
            ...(message.previous !== undefined ? { previous: message.previous } : {}),
            ...(message.sinceSeconds !== undefined ? { sinceSeconds: message.sinceSeconds } : {}),
          };

          socket.send(JSON.stringify({ type: 'started', pods: message.pods.length }));

          // Multi-pod aggregation is a Pro feature and lands with the cloud
          // work; until then a socket asking for several pods tails the first.
          const only = message.pods[0];
          if (!only) return;
          const stream = connection.streamLogs({
            ...options,
            namespace: message.namespace,
            pod: only.name,
            ...(only.container ? { container: only.container } : {}),
          });
          for await (const line of stream) push(line);

          flush();
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: 'ended' }));
          }
        } catch (error) {
          // An abort is the user closing the tab, not a failure.
          if (!abort.signal.aborted) fail(error);
        }
      })();
    });

    socket.on('close', () => {
      abort.abort();
      if (timer) clearTimeout(timer);
      pending = [];
    });

    socket.on('error', (error) => {
      log.debug('log socket error', { error });
      abort.abort();
    });
  });

  return wss;
}
