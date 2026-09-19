import { describe, expect, it } from 'vitest';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { ForwardManager } from './forwards.ts';
import type { ClusterRegistry } from './clusters.ts';

/**
 * The forward list, which has to tell the truth about a live socket.
 *
 * This existed and was wrong in a way nothing caught: the record handed to the
 * map was a copy of the one the connection handler mutated, so `connections`
 * was permanently 0 and `lastError` permanently null. A forward whose pod had
 * gone away looked perfectly healthy. The bug is invisible to any test that
 * only starts and stops a forward, so these open a socket and look.
 */

/** A cluster that pipes anything forwarded to it straight back. */
function echoRegistry(options: { fail?: string } = {}): ClusterRegistry {
  return {
    connect: () => ({
      async forward(_namespace: string, _pod: string, _port: number, socket: Duplex) {
        if (options.fail) throw new Error(options.fail);
        socket.on('data', (chunk: Buffer) => socket.write(chunk));
      },
    }),
  } as unknown as ClusterRegistry;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

const connect = (port: number) =>
  new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' }, () => resolve(socket));
    socket.once('error', reject);
  });

describe('what the forward list reports', () => {
  it('counts a socket while it is open and stops counting when it closes', async () => {
    const forwards = new ForwardManager(echoRegistry());
    const record = await forwards.start({ context: 'test', namespace: 'shop', pod: 'api-1', port: 8080 });
    expect(record.localPort).toBeGreaterThan(0);
    expect(forwards.list()[0]?.connections).toBe(0);

    const socket = await connect(record.localPort);
    // The client's connect resolves before the server's handler has run.
    await settle();
    // The list has to see the live count, not a copy taken at start.
    expect(forwards.list()[0]?.connections).toBe(1);

    const second = await connect(record.localPort);
    await settle();
    expect(forwards.list()[0]?.connections).toBe(2);

    await new Promise<void>((resolve) => socket.end(resolve));
    await settle();
    expect(forwards.list()[0]?.connections).toBe(1);

    second.destroy();
    await forwards.stop(record.id);
    expect(forwards.list()).toEqual([]);
  });

  it('carries bytes both ways', async () => {
    const forwards = new ForwardManager(echoRegistry());
    const record = await forwards.start({ context: 'test', namespace: 'shop', pod: 'api-1', port: 8080 });
    const socket = await connect(record.localPort);

    const reply = await new Promise<string>((resolve) => {
      socket.once('data', (chunk: Buffer) => resolve(chunk.toString()));
      socket.write('PING\r\n');
    });

    expect(reply).toBe('PING\r\n');
    socket.destroy();
    await forwards.stop(record.id);
  });

  it('records why a forward broke, so a dead one does not look healthy', async () => {
    const forwards = new ForwardManager(echoRegistry({ fail: 'pod no longer exists' }));
    const record = await forwards.start({ context: 'test', namespace: 'shop', pod: 'gone', port: 8080 });

    const socket = await connect(record.localPort);
    await settle();

    expect(forwards.list()[0]?.lastError).toBe('pod no longer exists');
    socket.destroy();
    await forwards.stop(record.id);
  });

  it('hands back the existing forward rather than opening a second listener', async () => {
    const forwards = new ForwardManager(echoRegistry());
    const first = await forwards.start({ context: 'test', namespace: 'shop', pod: 'api-1', port: 8080 });
    const again = await forwards.start({ context: 'test', namespace: 'shop', pod: 'api-1', port: 8080 });

    expect(again.localPort).toBe(first.localPort);
    expect(forwards.list()).toHaveLength(1);
    await forwards.stop(first.id);
  });
});
