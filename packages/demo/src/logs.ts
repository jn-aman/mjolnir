import type { LogLine } from '@mjolnir/k8s';

/**
 * Synthetic container output.
 *
 * Real enough to exercise everything the viewer does: mixed levels, a JSON
 * stream for the structured table, ANSI escapes, a stack trace whose frames
 * must dim rather than shout, and lines long enough to cross a chunk boundary.
 */

const ESC = String.fromCharCode(0x1b);

interface Source {
  /** Lines replayed as history, oldest first. */
  readonly history: readonly string[];
  /** Drawn from in order, repeating, to produce the live tail. */
  readonly live: readonly string[];
  /** Milliseconds between live lines. */
  readonly intervalMs: number;
}

const paymentsApi: Source = {
  history: [
    'listening on :8080 (commit 9f2a1c4, go1.23.4)',
    'connected to postgres://payments-primary:5432 pool=25',
    'GET /v1/health 200 in 1.2ms',
    'POST /v1/charges 201 in 84ms merchant=mrc_8812 amount=4999',
    'DEBUG idempotency key ik_4f2a9 cached for 24h',
    'WARN acquirer timeout after 3000ms, retrying (1/3) acquirer=stripe-eu',
    'WARN acquirer timeout after 3000ms, retrying (2/3) acquirer=stripe-eu',
    'ERROR acquirer timeout after 3000ms, giving up acquirer=stripe-eu charge=ch_71bd',
    'ERROR POST /v1/charges 502 in 9014ms merchant=mrc_5530 amount=22000',
    'circuit breaker half-open for acquirer=stripe-eu',
    'circuit breaker closed for acquirer=stripe-eu',
    `${ESC}[32mINFO${ESC}[0m reconciliation complete, 1,204 charges, 0 mismatches`,
  ],
  live: [
    'POST /v1/charges 201 in 78ms merchant=mrc_8812 amount=3400',
    'GET /v1/balance 200 in 12ms merchant=mrc_2274',
    'DEBUG ledger write batched, 9 entries, flush in 200ms',
    'POST /v1/charges 201 in 91ms merchant=mrc_2274 amount=1250',
    'GET /v1/health 200 in 0.9ms',
    'WARN ledger lag 420ms above target 250ms',
    'POST /v1/refunds 201 in 66ms charge=ch_6a20 amount=1500',
    'DEBUG webhook queued evt_9d31 -> https://mrc-8812.example.com/hooks',
    'POST /v1/charges 201 in 80ms merchant=mrc_7723 amount=9900',
    'GET /v1/charges?limit=50 200 in 31ms merchant=mrc_5530',
  ],
  intervalMs: 700,
};

const istioProxy: Source = {
  history: [
    'envoy config applied, 14 clusters, 6 listeners',
    'upstream payments-ledger healthy after 2 probes',
  ],
  live: [
    'metrics scrape 200 in 3ms',
    'upstream payments-ledger healthy after 2 probes',
    'WARN upstream reset: connection termination, 1 of 40 requests',
  ],
  intervalMs: 2_100,
};

/** JSON output, so the structured table has something real to discover. */
const checkoutWeb: Source = {
  history: [
    '{"level":"info","msg":"server started","service":"checkout-web","port":3000}',
    '{"level":"info","msg":"cart created","service":"checkout-web","trace_id":"18bb5c3f9902","user_id":"usr_77120","duration_ms":41}',
    '{"level":"error","msg":"payment authorisation declined by acquirer","service":"checkout-web","trace_id":"4b1f8e2c9a7d","duration_ms":3104,"user_id":"usr_88213","acquirer":"stripe-eu","decline_code":"insufficient_funds","retryable":false}',
    '{"level":"warn","msg":"tax service slow, using cached rate","service":"checkout-web","trace_id":"b7cc10e4498a","duration_ms":4011,"user_id":"usr_31760"}',
    '{"level":"error","msg":"address validation upstream returned 503","service":"checkout-web","trace_id":"ce9910ad4472","duration_ms":5002,"user_id":"usr_66512","retryable":true}',
  ],
  live: [
    '{"level":"info","msg":"cart updated","service":"checkout-web","trace_id":"a02c74f1bb63","user_id":"usr_41007","duration_ms":38}',
    '{"level":"info","msg":"checkout completed","service":"checkout-web","trace_id":"7d3e01ca8815","user_id":"usr_10394","duration_ms":812}',
    '{"level":"error","msg":"inventory reservation failed, sku out of stock","service":"checkout-web","trace_id":"f4410d22ae08","duration_ms":733,"user_id":"usr_23845","sku":"SKU-4417","retryable":false}',
    '{"level":"debug","msg":"session refreshed","service":"checkout-web","trace_id":"31c7ff0a6e92","user_id":"usr_60553","duration_ms":11}',
  ],
  intervalMs: 900,
};

/**
 * The crashed worker. This is the *previous* container's output — the current
 * one has written nothing, which is the whole point of the fixture.
 */
const ingestWorkerPrevious: Source = {
  history: [
    'batch 8821 claimed, 50,000 events',
    'decoding avro payloads, schema v14',
    'WARN heap 384Mi of 512Mi after batch 8821',
    'batch 8822 claimed, 50,000 events',
    'WARN heap 447Mi of 512Mi after batch 8822',
    'WARN gc pause 412ms, 3 collections in last 10s',
    'batch 8823 claimed, 50,000 events',
    'WARN heap 498Mi of 512Mi after batch 8823',
    'ERROR allocation stalled 2,104ms waiting on gc',
    'ERROR java.lang.OutOfMemoryError: Java heap space',
    '        at io.ingest.avro.RecordDecoder.decodeAll(RecordDecoder.java:184)',
    '        at io.ingest.avro.RecordDecoder.decodeBatch(RecordDecoder.java:96)',
    '        at io.ingest.worker.BatchProcessor.run(BatchProcessor.java:212)',
    '        at io.ingest.worker.BatchProcessor.lambda$start$0(BatchProcessor.java:88)',
    '        at java.base/java.lang.Thread.run(Thread.java:1583)',
    'ERROR batch 8823 abandoned, will be redelivered',
    'shutdown hook running, flushing 0 pending',
    'worker stopped',
  ],
  live: [],
  intervalMs: 0,
};

const SOURCES: Record<string, Source> = {
  'payments/api-7d9f4b8c6-x2mqz/api': paymentsApi,
  'payments/api-7d9f4b8c6-x2mqz/istio-proxy': istioProxy,
  'payments/api-7d9f4b8c6-k8lpw/api': paymentsApi,
  'payments/api-7d9f4b8c6-k8lpw/istio-proxy': istioProxy,
  'checkout/web-5c8b9d774-lk4pn/web': checkoutWeb,
};

const PREVIOUS_SOURCES: Record<string, Source> = {
  'ingest/worker-6bb4f9c2d-zt8rw/worker': ingestWorkerPrevious,
};

const EMPTY: Source = { history: [], live: [], intervalMs: 0 };

function sourceFor(namespace: string, pod: string, container: string, previous: boolean): Source {
  const key = `${namespace}/${pod}/${container}`;
  if (previous) return PREVIOUS_SOURCES[key] ?? EMPTY;
  // A crash-looping container that has not started has produced nothing. This
  // is not an error state — it is the answer, and the UI should say so.
  return SOURCES[key] ?? EMPTY;
}

export interface DemoLogOptions {
  readonly namespace: string;
  readonly pod: string;
  readonly container: string;
  readonly follow?: boolean;
  readonly previous?: boolean;
  readonly tailLines?: number;
  readonly signal?: AbortSignal;
}

function levelOf(message: string): string {
  const match = /^(WARN|ERROR|DEBUG|INFO)\b/.exec(message);
  return match?.[1] ?? 'INFO';
}

/** Strip a leading level word — the real API does not repeat it as a field. */
function render(message: string): string {
  return message;
}

export async function* streamDemoLogs(
  options: DemoLogOptions,
): AsyncGenerator<LogLine, void, undefined> {
  const source = sourceFor(options.namespace, options.pod, options.container, options.previous ?? false);
  let seq = 0;

  const history = options.tailLines
    ? source.history.slice(-options.tailLines)
    : source.history;

  const base = Date.now() - history.length * 1_000;
  for (const [index, message] of history.entries()) {
    if (options.signal?.aborted) return;
    yield {
      seq: seq++,
      timestamp: new Date(base + index * 1_000),
      message: render(message),
      pod: options.pod,
      container: options.container,
    };
  }

  if (!options.follow || source.live.length === 0) return;

  let index = 0;
  while (!options.signal?.aborted) {
    await new Promise<void>((resolve) => setTimeout(resolve, source.intervalMs));
    if (options.signal?.aborted) return;
    const message = source.live[index % source.live.length] as string;
    index += 1;
    yield {
      seq: seq++,
      timestamp: new Date(),
      message: render(message),
      pod: options.pod,
      container: options.container,
    };
  }
}

/** Container names the demo cluster can serve logs for. */
export function demoContainers(namespace: string, pod: string): string[] {
  const prefix = `${namespace}/${pod}/`;
  const names = Object.keys(SOURCES)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
  if (names.length > 0) return names;
  // A pod with no live source still has containers; the crash-looper is the case.
  return Object.keys(PREVIOUS_SOURCES)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

export { levelOf };
