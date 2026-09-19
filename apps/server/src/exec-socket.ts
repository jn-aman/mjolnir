import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from './clusters.ts';
import { dockerClient } from './docker/contexts.ts';

const log = logger.child('exec-socket');

/**
 * A terminal over a WebSocket at /ws/exec.
 *
 * Client to server: one JSON `start`, then JSON `input` and `resize` frames.
 * Server to client: binary frames are bytes from the container; JSON frames
 * are `shell` (which one we found), `exit` and `error`. Bytes stay bytes, so
 * a half UTF-8 sequence at a frame boundary reaches xterm intact.
 */
interface StartMessage {
  readonly type: 'start';
  readonly source?: 'kubernetes' | 'docker';
  readonly context: string;
  readonly namespace: string;
  /** A pod name, or a container id when the source is docker. */
  readonly pod: string;
  readonly container?: string;
  readonly command?: string[];
  readonly cols?: number;
  readonly rows?: number;
}

/**
 * Shells to try, in order.
 *
 * Most images have bash; Alpine and busybox have ash or a bare sh; distroless
 * images have none of them, and that is worth saying plainly rather than
 * hanging on a terminal that will never speak. Each candidate is probed with
 * a non-interactive `-c exit 0`, whose exit status is unambiguous, before the
 * real session is opened on the first one that runs.
 */
export const SHELL_CANDIDATES: ReadonlyArray<readonly string[]> = [
  ['/bin/bash'],
  ['/usr/bin/bash'],
  ['/bin/zsh'],
  ['/usr/bin/zsh'],
  ['/bin/ash'],
  ['/bin/sh'],
  ['/usr/bin/sh'],
  ['/busybox/sh'],
  ['/bin/dash'],
  ['/bin/fish'],
  ['/usr/bin/fish'],
];

export const NO_SHELL_MESSAGE =
  'No shell in this container. Tried bash, zsh, ash, sh, dash, fish and busybox; a distroless image has none of them. Read its logs, or attach an ephemeral debug container.';

export function attachExecSocket(registry: ClusterRegistry): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (socket: WebSocket) => {
    const stdin = new PassThrough();
    const size = Object.assign(new EventEmitter(), { cols: 80, rows: 24 });
    let handle: { close: () => void } | null = null;
    let started = false;

    const send = (message: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const forward = (chunk: Buffer) => {
      if (socket.readyState === socket.OPEN) socket.send(chunk, { binary: true });
    };

    socket.on('message', (raw) => {
      let message: Partial<Omit<StartMessage, 'type'>> & { type?: string; data?: string };
      try {
        message = JSON.parse(raw.toString()) as typeof message;
      } catch {
        return;
      }

      if (message.type === 'input' && typeof message.data === 'string') {
        stdin.write(message.data);
        return;
      }
      if (message.type === 'resize' && typeof message.cols === 'number' && typeof message.rows === 'number') {
        size.cols = Math.max(2, Math.floor(message.cols));
        size.rows = Math.max(2, Math.floor(message.rows));
        size.emit('resize');
        return;
      }
      if (message.type !== 'start' || started) return;
      if (typeof message.context !== 'string' || typeof message.namespace !== 'string' || typeof message.pod !== 'string') {
        send({ type: 'error', message: 'start needs context, namespace and pod' });
        return;
      }

      started = true;
      size.cols = message.cols ?? 80;
      size.rows = message.rows ?? 24;
      const asked = message.command?.length ? [message.command] : null;
      const { context, namespace, pod, container } = message;

      if (message.source === 'docker') {
        void (async () => {
          const client = dockerClient(context);
          let shell: readonly string[] | null = null;
          if (asked) shell = asked[0] ?? null;
          else {
            for (const candidate of SHELL_CANDIDATES) {
              if (await client.canRun(pod, [...candidate, '-c', 'exit 0'])) {
                shell = candidate;
                break;
              }
            }
          }
          if (!shell) {
            send({ type: 'error', message: NO_SHELL_MESSAGE });
            socket.close();
            return;
          }
          try {
            const { id, socket: stream } = await client.exec(pod, shell, { cols: size.cols, rows: size.rows });
            send({ type: 'shell', shell: shell[0] });
            stream.on('data', forward);
            stream.on('close', () => {
              send({ type: 'exit', code: null });
              socket.close();
            });
            stdin.on('data', (chunk: Buffer) => stream.write(chunk));
            size.on('resize', () => void client.resizeExec(id, { cols: size.cols, rows: size.rows }));
            handle = { close: () => stream.destroy() };
          } catch (error) {
            send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
            socket.close();
          }
        })();
        return;
      }

      void (async () => {
        const connection = registry.connect(context);
        let shell: readonly string[] | null = null;
        if (asked) shell = asked[0] ?? null;
        else {
          for (const candidate of SHELL_CANDIDATES) {
            if (await connection.canRun(namespace, pod, container, [...candidate, '-c', 'exit 0'])) {
              shell = candidate;
              break;
            }
          }
        }
        if (!shell) {
          send({ type: 'error', message: NO_SHELL_MESSAGE });
          socket.close();
          return;
        }
        try {
          handle = await connection.exec(
            { namespace, pod, container, command: shell, cols: size.cols, rows: size.rows },
            {
              onData: forward,
              onExit: (status) => {
                send({ type: 'exit', ...status });
                socket.close();
              },
              stdin,
              size: {
                get cols() {
                  return size.cols;
                },
                get rows() {
                  return size.rows;
                },
                on: (event, fn) => void size.on(event, fn),
              },
            },
          );
          send({ type: 'shell', shell: shell[0] });
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          log.warn('exec failed', { error: text });
          send({ type: 'error', message: text });
          socket.close();
        }
      })();
    });

    socket.on('close', () => {
      handle?.close();
      stdin.end();
    });
    socket.on('error', (error) => log.debug('exec socket error', { error }));
  });

  return wss;
}
