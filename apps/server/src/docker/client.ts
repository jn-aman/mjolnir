import http, { type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/**
 * The Docker Engine API over a unix socket, with nothing between us and it.
 *
 * Every call is a plain HTTP request on the socket; streams (logs, stats,
 * pull progress, exec) come back as the raw response. The multiplexed log
 * format (8-byte frame headers when the container has no TTY) is demuxed
 * here so callers see lines.
 */

export interface DockerRequest {
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export class DockerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'DockerError';
  }
}

function withQuery(path: string, query: DockerRequest['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) params.set(key, String(value));
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export class DockerClient {
  constructor(readonly socketPath: string) {}

  async raw(method: string, path: string, options: DockerRequest = {}): Promise<IncomingMessage> {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          method,
          path: withQuery(path, options.query),
          headers: {
            ...(body !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
            ...options.headers,
          },
        },
        resolve,
      );
      request.on('error', reject);
      if (body !== undefined) request.write(body);
      request.end();
    });
  }

  async json<T = unknown>(method: string, path: string, options: DockerRequest = {}): Promise<T> {
    const response = await this.raw(method, path, options);
    const text = await readAll(response);
    const status = response.statusCode ?? 0;
    if (status >= 400) {
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        // Plain text error; keep it.
      }
      throw new DockerError(status, message.trim() || `${method} ${path} failed with ${status}`);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  /**
   * An exec session: create, then start with the connection hijacked. The
   * returned socket carries the terminal both ways.
   */
  async exec(container: string, command: readonly string[], size: { cols: number; rows: number }): Promise<{ id: string; socket: Duplex }> {
    const created = await this.json<{ Id: string }>('POST', `/containers/${encodeURIComponent(container)}/exec`, {
      body: { AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true, Cmd: [...command] },
    });
    const socket = await new Promise<Duplex>((resolve, reject) => {
      const request = http.request({
        socketPath: this.socketPath,
        method: 'POST',
        path: `/exec/${created.Id}/start`,
        headers: { 'content-type': 'application/json', connection: 'Upgrade', upgrade: 'tcp' },
      });
      request.on('upgrade', (_response, stream) => resolve(stream));
      request.on('response', (response) => {
        void readAll(response).then((text) => reject(new DockerError(response.statusCode ?? 0, text || 'exec start was not upgraded')));
      });
      request.on('error', reject);
      request.end(JSON.stringify({ Detach: false, Tty: true }));
    });
    await this.json('POST', `/exec/${created.Id}/resize`, { query: { h: size.rows, w: size.cols } }).catch(() => undefined);
    return { id: created.Id, socket };
  }

  /**
   * Whether a command starts in the container. No TTY, nothing attached: the
   * exec's own exit code says yes or no, which is how a shell is chosen.
   */
  async canRun(container: string, command: readonly string[]): Promise<boolean> {
    try {
      const created = await this.json<{ Id: string }>('POST', `/containers/${encodeURIComponent(container)}/exec`, {
        body: { AttachStdout: true, AttachStderr: true, Tty: false, Cmd: [...command] },
      });
      const response = await this.raw('POST', `/exec/${created.Id}/start`, { body: { Detach: false, Tty: false } });
      await readAll(response);
      const state = await this.json<{ ExitCode?: number | null }>('GET', `/exec/${created.Id}/json`);
      return state.ExitCode === 0;
    } catch {
      return false;
    }
  }

  async resizeExec(id: string, size: { cols: number; rows: number }): Promise<void> {
    await this.json('POST', `/exec/${id}/resize`, { query: { h: size.rows, w: size.cols } }).catch(() => undefined);
  }
}

export function readAll(stream: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

/**
 * Splits a Docker attach/logs stream into text. With `tty` the bytes are
 * plain; without, each frame is [type, 0, 0, 0, len(4)] then payload.
 */
export async function* demux(stream: IncomingMessage, tty: boolean): AsyncGenerator<string> {
  if (tty) {
    for await (const chunk of stream) yield (chunk as Buffer).toString('utf8');
    return;
  }
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    for (;;) {
      if (buffer.length < 8) break;
      const length = buffer.readUInt32BE(4);
      if (buffer.length < 8 + length) break;
      yield buffer.subarray(8, 8 + length).toString('utf8');
      buffer = buffer.subarray(8 + length);
    }
  }
}
