import { useCallback, useEffect, useRef, useState } from 'react';
import { api, logSocketUrl, type LogLineWire } from './api.ts';

export interface StreamedLine {
  readonly seq: number;
  readonly timestamp: Date | null;
  readonly message: string;
  readonly pod: string;
  readonly container: string;
}

export type StreamState = 'idle' | 'connecting' | 'streaming' | 'ended' | 'error';

interface Options {
  /** `docker` tails a container by id; default tails a pod. */
  readonly source?: 'kubernetes' | 'docker' | undefined;
  readonly context: string;
  readonly namespace: string;
  readonly pod: string;
  readonly container?: string;
  readonly previous?: boolean;
  readonly follow?: boolean;
  readonly tailLines?: number;
  /** Lines kept in memory. Older ones are dropped, oldest first. */
  readonly buffer?: number;
}

const wire = (line: LogLineWire): StreamedLine => ({
  seq: line.seq,
  timestamp: line.timestamp ? new Date(line.timestamp) : null,
  message: line.message,
  pod: line.pod,
  container: line.container,
});

/**
 * Live container logs.
 *
 * Batched frames from the server are appended in one state update, one update
 * per frame rather than per line, because a React render per log line is
 * precisely how a viewer freezes on a chatty pod.
 *
 * The buffer is bounded. An unbounded log view is a memory leak with a nice
 * font.
 */
export function useLogStream(options: Options | null) {
  const [lines, setLines] = useState<StreamedLine[]>([]);
  const [state, setState] = useState<StreamState>('idle');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const key = options
    ? `${options.context}|${options.namespace}|${options.pod}|${options.container ?? ''}|${
        options.previous ? 'prev' : 'cur'
      }|${options.follow ? 'follow' : 'once'}`
    : null;

  useEffect(() => {
    if (!options || !key) return;

    let cancelled = false;
    setLines([]);
    setError(null);
    setState('connecting');

    const limit = options.buffer ?? 5_000;

    // Previous-container logs are finite and never stream: the container is
    // gone. Asking for a follow socket would hang waiting for a writer.
    if (options.previous || !options.follow) {
      void (async () => {
        try {
          const response = await api.logs(options.context, options.namespace, options.pod, {
            ...(options.container ? { container: options.container } : {}),
            ...(options.previous ? { previous: true } : {}),
            ...(options.tailLines !== undefined ? { tailLines: options.tailLines } : {}),
          });
          if (cancelled) return;
          setLines(response.lines.map(wire));
          setState('ended');
        } catch (cause) {
          if (cancelled) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setState('error');
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const socket = new WebSocket(logSocketUrl());
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'start',
          ...(options.source ? { source: options.source } : {}),
          context: options.context,
          namespace: options.namespace,
          pods: [{ name: options.pod, ...(options.container ? { container: options.container } : {}) }],
          tailLines: options.tailLines ?? 500,
        }),
      );
    });

    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data)) as
        | { type: 'lines'; lines: LogLineWire[] }
        | { type: 'started' }
        | { type: 'ended' }
        | { type: 'error'; message: string };

      if (payload.type === 'started') setState('streaming');
      else if (payload.type === 'ended') setState('ended');
      else if (payload.type === 'error') {
        setError(payload.message);
        setState('error');
      } else {
        setLines((current) => {
          const next = current.concat(payload.lines.map(wire));
          return next.length > limit ? next.slice(next.length - limit) : next;
        });
      }
    });

    socket.addEventListener('error', () => {
      if (!cancelled) setState('error');
    });

    return () => {
      cancelled = true;
      socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const clear = useCallback(() => setLines([]), []);

  return { lines, state, error, clear };
}
