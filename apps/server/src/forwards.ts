import net from 'node:net';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from './clusters.ts';

const log = logger.child('forwards');

/**
 * Port forwards, kept alive by the app rather than a terminal you must not
 * close.
 *
 * Each forward is a local listener on 127.0.0.1. Every connection to it is
 * piped to the pod through the cluster's port-forward endpoint, the same
 * wire `kubectl port-forward` uses, so nothing is exposed beyond this
 * machine. The listener outlives the pod: if the pod goes, connections fail
 * until it is back, and the forward stays listed so it can be retried.
 */

/** The live record is written to; what leaves this module is read-only. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface ForwardRecord {
  readonly id: string;
  readonly context: string;
  readonly namespace: string;
  readonly pod: string;
  readonly port: number;
  readonly localPort: number;
  readonly startedAt: string;
  connections: number;
  lastError: string | null;
}

interface ForwardRequest {
  readonly context: string;
  readonly namespace: string;
  readonly pod: string;
  readonly port: number;
  readonly localPort?: number | undefined;
}

export class ForwardManager {
  readonly #registry: ClusterRegistry;
  readonly #forwards = new Map<string, { record: ForwardRecord; server: net.Server }>();

  constructor(registry: ClusterRegistry) {
    this.#registry = registry;
  }

  list(): ForwardRecord[] {
    return [...this.#forwards.values()].map((entry) => entry.record);
  }

  async start(request: ForwardRequest): Promise<ForwardRecord> {
    const id = `${request.context}/${request.namespace}/${request.pod}:${request.port}`;
    const existing = this.#forwards.get(id);
    if (existing) return existing.record;

    const connection = this.#registry.connect(request.context);
    /*
     * One object, mutated in place, and it is the one the map holds.
     *
     * This was a `ForwardRecord` that got spread into a second object once the
     * local port was known, and the connection handler kept incrementing the
     * first one. The result: `connections` was always 0 and `lastError` was
     * always null, so a forward whose pod had gone away looked perfectly
     * healthy in the list. Nothing below may copy this.
     */
    const record: Mutable<ForwardRecord> = {
      id,
      context: request.context,
      namespace: request.namespace,
      pod: request.pod,
      port: request.port,
      localPort: 0,
      startedAt: new Date().toISOString(),
      connections: 0,
      lastError: null,
    };

    const server = net.createServer((socket) => {
      record.connections += 1;
      socket.on('close', () => {
        record.connections = Math.max(0, record.connections - 1);
      });
      socket.on('error', (error) => {
        record.lastError = error.message;
      });
      connection.forward(request.namespace, request.pod, request.port, socket).catch((error: unknown) => {
        record.lastError = error instanceof Error ? error.message : String(error);
        log.warn('port forward failed', { id, error: record.lastError });
        socket.destroy();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(request.localPort ?? 0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    record.localPort = typeof address === 'object' && address ? address.port : (request.localPort ?? 0);
    this.#forwards.set(id, { record, server });
    log.info('port forward started', { id, localPort: record.localPort });
    return record;
  }

  async stop(id: string): Promise<boolean> {
    const entry = this.#forwards.get(id);
    if (!entry) return false;
    this.#forwards.delete(id);
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
    log.info('port forward stopped', { id });
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#forwards.keys()].map((id) => this.stop(id)));
  }
}
