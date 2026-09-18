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
 * Client → server: one JSON `start`, then JSON `input` and `resize` frames.
 * Server → client: binary frames are bytes from the container; JSON frames
 * are `exit` and `error`. Bytes stay bytes so a half UTF-8 sequence at a
 * frame boundary reaches xterm intact.
 */
interface StartMessage {
  readonly type: 'start';
  readonly source?: 'kubernetes' | 'docker';
  readonly context: string;
  readonly namespace: string;
  readonly pod: string;
  readonly container?: string;
  readonly command?: string[];
  readonly cols?: number;
  readonly rows?: number;
}

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
      if (message.source === 'docker') {
        const shell = message.command?.length ? message.command : ['/bin/sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'];
        const contextName = message.context;
        void dockerClient(contextName)
          .exec(message.pod, shell, { cols: size.cols, rows: size.rows })
          .then(({ id, socket: stream }) => {
            const client = dockerClient(contextName);
            stream.on('data', (chunk: Buffer) => {
              if (socket.readyState === socket.OPEN) socket.send(chunk, { binary: true });
            });
            stream.on('close', () => {
              send({ type: 'exit', code: null });
              socket.close();
            });
            stdin.on('data', (chunk: Buffer) => stream.write(chunk));
            size.on('resize', () => void client.resizeExec(id, { cols: size.cols, rows: size.rows }));
            handle = { close: () => stream.destroy() };
          })
          .catch((error: unknown) => {
            send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
            socket.close();
          });
        return;
      }
      // bash when the image has it, sh otherwise: what kubectl users type by hand.
      const command = message.command?.length ? message.command : ['/bin/sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'];
      void registry
        .connect(message.context)
        .exec(
          { namespace: message.namespace, pod: message.pod, container: message.container, command, cols: size.cols, rows: size.rows },
          {
            onData: (chunk) => {
              if (socket.readyState === socket.OPEN) socket.send(chunk, { binary: true });
            },
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
        )
        .then((result) => {
          handle = result;
        })
        .catch((error: unknown) => {
          const text = error instanceof Error ? error.message : String(error);
          log.warn('exec failed', { error: text });
          send({ type: 'error', message: text });
          socket.close();
        });
    });

    socket.on('close', () => {
      handle?.close();
      stdin.end();
    });
  });

  return wss;
}
