import { logger } from '@odin/logger';
import { ApiError, type ClusterTransport } from './transport.js';
import { LineSplitter, type LogLine, parseLogLine } from './log-line.js';

const log = logger.child('logs');

export interface LogStreamOptions {
  readonly namespace: string;
  readonly pod: string;
  readonly container?: string;
  /** Hold the connection open and emit lines as they arrive. */
  readonly follow?: boolean;
  /** Lines of history to replay before following. Omit for the server default. */
  readonly tailLines?: number;
  /**
   * Read the logs of the *previous*, terminated instance of the container.
   *
   * This is the first thing anyone wants on a CrashLoopBackOff, because the
   * current container has produced nothing and the one that explained why is
   * already gone.
   */
  readonly previous?: boolean;
  /** Only lines newer than this many seconds. Mutually exclusive with sinceTime. */
  readonly sinceSeconds?: number;
  /** Only lines at or after this RFC3339 instant. */
  readonly sinceTime?: string;
  /** Cap the bytes the server will send. A safety valve against a runaway pod. */
  readonly limitBytes?: number;
  readonly signal?: AbortSignal;
}

function logPath(options: LogStreamOptions): string {
  return `/api/v1/namespaces/${encodeURIComponent(options.namespace)}/pods/${encodeURIComponent(options.pod)}/log`;
}

function logQuery(options: LogStreamOptions): Record<string, string | number | boolean | undefined> {
  return {
    // Always requested, so every line carries a real instant. The viewer
    // decides whether to display it; merging streams requires it regardless.
    timestamps: true,
    container: options.container,
    follow: options.follow ?? false,
    tailLines: options.tailLines,
    previous: options.previous ?? false,
    sinceSeconds: options.sinceSeconds,
    sinceTime: options.sinceTime,
    limitBytes: options.limitBytes,
  };
}

/**
 * Stream one container's logs as parsed lines.
 *
 * Yields rather than buffering, so a caller that stops consuming stops the
 * read. That is what keeps a chatty pod from filling memory when the user
 * switches away from the tab.
 */
export async function* streamPodLogs(
  transport: ClusterTransport,
  options: LogStreamOptions,
): AsyncGenerator<LogLine, void, undefined> {
  const container = options.container ?? '';
  const response = await transport.stream(logPath(options), {
    query: logQuery(options),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const splitter = new LineSplitter();
  let seq = 0;

  try {
    for await (const chunk of response) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      for (const raw of splitter.push(text)) {
        yield parseLogLine(raw, { seq: seq++, pod: options.pod, container });
      }
    }
    for (const raw of splitter.flush()) {
      yield parseLogLine(raw, { seq: seq++, pod: options.pod, container });
    }
  } finally {
    response.destroy();
  }
}

/**
 * Read a finite slice of logs.
 *
 * Distinct from the streaming path because the failure modes differ: a missing
 * previous-container log is a normal answer here ("nothing to show"), not a
 * connection that died.
 */
export async function readPodLogs(
  transport: ClusterTransport,
  options: Omit<LogStreamOptions, 'follow'>,
): Promise<LogLine[]> {
  const lines: LogLine[] = [];
  try {
    for await (const line of streamPodLogs(transport, { ...options, follow: false })) {
      lines.push(line);
    }
  } catch (error) {
    // 400 is what the API returns for "previous terminated container not found".
    // That is an expected answer for a pod that has never restarted.
    if (error instanceof ApiError && options.previous && error.status === 400) {
      log.debug('no previous container logs', { pod: options.pod, container: options.container });
      return [];
    }
    throw error;
  }
  return lines;
}

export interface AggregateTarget {
  readonly namespace: string;
  readonly pod: string;
  readonly container?: string;
}

/**
 * Merge several containers' logs into one stream, Stern-style.
 *
 * Emission is arrival-ordered, not timestamp-ordered. Ordering across sources
 * would mean holding a reorder window, which trades latency for a tidiness
 * nobody watching a live tail actually wants — a line should appear when it
 * arrives. Each line carries its own timestamp, so a caller that wants
 * chronological order for a finite range can sort it.
 *
 * One source failing does not end the others: in a rolling deployment some
 * pods are legitimately terminating while you watch.
 */
export async function* aggregatePodLogs(
  transport: ClusterTransport,
  targets: readonly AggregateTarget[],
  options: Omit<LogStreamOptions, 'namespace' | 'pod' | 'container'> = {},
): AsyncGenerator<LogLine, void, undefined> {
  if (targets.length === 0) return;

  const queue: LogLine[] = [];
  let notify: (() => void) | null = null;
  let live = targets.length;

  const wake = () => {
    notify?.();
    notify = null;
  };

  for (const target of targets) {
    void (async () => {
      try {
        const stream = streamPodLogs(transport, {
          ...options,
          namespace: target.namespace,
          pod: target.pod,
          ...(target.container ? { container: target.container } : {}),
        });
        for await (const line of stream) {
          queue.push(line);
          wake();
        }
      } catch (error) {
        log.warn('log source ended', { pod: target.pod, container: target.container, error });
      } finally {
        live -= 1;
        wake();
      }
    })();
  }

  while (live > 0 || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      continue;
    }
    yield queue.shift() as LogLine;
  }
}
