import { WebSocketServer, type WebSocket } from 'ws';
import type { LogLine } from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from './clusters.ts';
import { demux } from './docker/client.ts';
import { dockerClient } from './docker/contexts.ts';

const log = logger.child('log-socket');

/** Messages the client sends. One `start` per socket; close to stop. */
interface StartMessage {
  readonly type: 'start';
  /** `kubernetes` (default) tails a pod; `docker` tails a container by id. */
  readonly source?: 'kubernetes' | 'docker';
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

export function attachLogSocket(registry: ClusterRegistry): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

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
          if (message.source === 'docker') {
            const only = message.pods[0];
            if (!only) return;
            const client = dockerClient(message.context);
            const inspect = await client.json<{ Config?: { Tty?: boolean }; Name?: string }>('GET', `/containers/${encodeURIComponent(only.name)}/json`);
            socket.send(JSON.stringify({ type: 'started', pods: 1 }));
            const response = await client.raw('GET', `/containers/${encodeURIComponent(only.name)}/logs`, {
              query: { follow: true, stdout: true, stderr: true, timestamps: true, tail: message.tailLines ?? 500 },
            });
            abort.signal.addEventListener('abort', () => response.destroy());
            let seq = 0;
            let rest = '';
            const name = inspect.Name?.replace(/^\//, '') ?? only.name;
            for await (const text of demux(response, inspect.Config?.Tty === true)) {
              rest += text;
              const parts = rest.split('\n');
              rest = parts.pop() ?? '';
              for (const line of parts) {
                const space = line.indexOf(' ');
                const stamp = space > 0 ? new Date(line.slice(0, space)) : new Date(Number.NaN);
                const stamped = space > 0 && !Number.isNaN(stamp.getTime());
                push({ seq: seq++, timestamp: stamped ? stamp : null, message: stamped ? line.slice(space + 1) : line, pod: name, container: name });
              }
            }
            flush();
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'ended' }));
            return;
          }
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
