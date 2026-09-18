import { Writable, type Duplex, type Readable } from 'node:stream';
import { Exec, PortForward } from '@kubernetes/client-node';
import type { KubeConfig } from '@kubernetes/client-node';
import {
  ClusterTransport,
  type ClusterContext,
  type LogLine,
  type LogStreamOptions,
  ResourceWatch,
  type ResourceDefinition,
  type WatchSnapshot,
  configForContext,
  loadKubeconfig,
  readPodLogs,
  streamPodLogs,
} from '@mjolnir/k8s';
import { DEMO_CONTEXT, DemoTransport, DemoWatch, demoContainers, streamDemoLogs } from '@mjolnir/demo';
import { logger } from '@mjolnir/logger';

const log = logger.child('clusters');

/**
 * What a route needs from a cluster, real or synthetic.
 *
 * Log streaming lives on the connection rather than beside it so that no route
 * ever asks "is this the demo cluster?". A branch like that starts in one place
 * and ends up in nine, and then the demo drifts from the real thing and stops
 * being worth testing against.
 */
export interface ExecOptions {
  readonly namespace: string;
  readonly pod: string;
  readonly container?: string | undefined;
  readonly command: readonly string[];
  readonly cols: number;
  readonly rows: number;
}

export interface ExecIo {
  /** Bytes from the container, in order. */
  readonly onData: (chunk: Buffer) => void;
  readonly onExit: (status: { code: number | null; message?: string }) => void;
  /** The server reads the user's keystrokes from here. */
  readonly stdin: Readable;
  /** Emits when the user's terminal changes size. */
  readonly size: { readonly cols: number; readonly rows: number; on: (event: 'resize', fn: () => void) => void };
}

export interface ClusterConnection {
  readonly context: ClusterContext;
  json<T = unknown>(path: string): Promise<T>;
  /** PUT a whole object. Returns what the API server stored. */
  replace<T = unknown>(path: string, body: unknown): Promise<T>;
  /** DELETE an object. The API server answers with a Status or the object. */
  remove<T = unknown>(path: string): Promise<T>;
  /** JSON merge patch (RFC 7386): only the fields given change. */
  patch<T = unknown>(path: string, body: unknown): Promise<T>;
  /** POST: a new object into a collection, or a subresource such as eviction. */
  create<T = unknown>(path: string, body: unknown): Promise<T>;
  /** A shell in a container: `kubectl exec -it`. Resolves with a handle to close it. */
  exec(options: ExecOptions, io: ExecIo): Promise<{ close: () => void }>;
  /** Pipes one TCP connection to a pod port, the wire behind `kubectl port-forward`. */
  forward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void>;
  watch(resource: ResourceDefinition, namespace?: string): ResourceSource;
  streamLogs(options: LogStreamOptions): AsyncGenerator<LogLine, void, undefined>;
  readLogs(options: Omit<LogStreamOptions, 'follow'>): Promise<LogLine[]>;
  close(): Promise<void>;
}

/** The watch surface routes depend on. Both the real and demo watches satisfy it. */
export interface ResourceSource {
  snapshot(): WatchSnapshot<never>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

class LiveConnection implements ClusterConnection {
  readonly #transport: ClusterTransport;
  readonly #watches = new Map<string, ResourceWatch>();

  constructor(
    readonly context: ClusterContext,
    readonly config: KubeConfig,
  ) {
    this.#transport = new ClusterTransport(config);
  }

  json<T = unknown>(path: string): Promise<T> {
    return this.#transport.json<T>(path);
  }

  replace<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.json<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  remove<T = unknown>(path: string): Promise<T> {
    return this.#transport.json<T>(path, { method: 'DELETE' });
  }

  patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.json<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
      contentType: 'application/merge-patch+json',
    });
  }

  create<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.json<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      contentType: 'application/json',
    });
  }

  async forward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void> {
    const forwarder = new PortForward(this.config);
    await forwarder.portForward(namespace, pod, [port], socket, null, socket);
  }

  async exec(options: ExecOptions, io: ExecIo): Promise<{ close: () => void }> {
    // client-node forwards terminal size when stdout looks like a TTY:
    // it reads `columns`/`rows` and listens for 'resize'. This stream is that.
    const stdout = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        io.onData(chunk);
        callback();
      },
    }) as Writable & { columns: number; rows: number };
    stdout.columns = io.size.cols;
    stdout.rows = io.size.rows;
    io.size.on('resize', () => {
      stdout.columns = io.size.cols;
      stdout.rows = io.size.rows;
      stdout.emit('resize');
    });
    const runner = new Exec(this.config);
    const ws = await runner.exec(
      options.namespace,
      options.pod,
      options.container ?? '',
      [...options.command],
      stdout,
      stdout,
      io.stdin,
      true,
      (status) => {
        const code = status.status === 'Success' ? 0 : Number(status.details?.causes?.find((c) => c.reason === 'ExitCode')?.message ?? 1);
        io.onExit({ code, ...(status.message ? { message: status.message } : {}) });
      },
    );
    ws.on('close', () => io.onExit({ code: null }));
    return { close: () => ws.close() };
  }

  /**
   * One watch per kind, shared.
   *
   * Two screens showing pods must not open two watches against the same
   * collection: the API server tracks every watch, and a UI that opens one per
   * component is how a dashboard gets itself rate-limited on a large cluster.
   */
  watch(resource: ResourceDefinition, namespace?: string): ResourceSource {
    const key = `${resource.kind}/${namespace ?? '*'}`;
    const existing = this.#watches.get(key);
    if (existing) return existing as unknown as ResourceSource;

    const created = new ResourceWatch({
      config: this.config,
      transport: this.#transport,
      resource,
      ...(namespace ? { namespace } : {}),
    });
    this.#watches.set(key, created);
    void created.start();
    return created as unknown as ResourceSource;
  }

  streamLogs(options: LogStreamOptions): AsyncGenerator<LogLine, void, undefined> {
    return streamPodLogs(this.#transport, options);
  }

  readLogs(options: Omit<LogStreamOptions, 'follow'>): Promise<LogLine[]> {
    return readPodLogs(this.#transport, options);
  }

  async close(): Promise<void> {
    await Promise.all([...this.#watches.values()].map((watch) => watch.stop()));
    this.#watches.clear();
  }
}

/**
 * The demo cluster's shell: a few commands, a prompt, honest about what it is.
 * Enough to see that a terminal in the dock types, echoes, resizes and exits.
 */
function demoShell(options: ExecOptions, io: ExecIo): { close: () => void } {
  const prompt = `\x1b[32m${options.pod}\x1b[0m:\x1b[34m/app\x1b[0m$ `;
  let line = '';
  const write = (text: string) => io.onData(Buffer.from(text));
  write('\x1b[2mMjolnir demo shell. This container is imaginary; the terminal is real.\x1b[0m\r\n');
  write(prompt);
  const answer = (input: string): string => {
    const [cmd, ...args] = input.trim().split(/\s+/);
    switch (cmd) {
      case '': return '';
      case 'ls': return 'app.js  node_modules  package.json  config\r\n';
      case 'pwd': return '/app\r\n';
      case 'whoami': return 'app\r\n';
      case 'hostname': return `${options.pod}\r\n`;
      case 'env': return `HOSTNAME=${options.pod}\r\nNAMESPACE=${options.namespace}\r\nNODE_ENV=production\r\nPORT=8080\r\n`;
      case 'ps': return 'PID   USER     COMMAND\r\n    1 app      node app.js\r\n   17 app      sh\r\n';
      case 'cat': return args[0] === '/etc/os-release' ? 'NAME="Alpine Linux"\r\nVERSION_ID=3.20.3\r\n' : `cat: ${args[0] ?? ''}: No such file or directory\r\n`;
      case 'uptime': return ' 21:14:02 up 2:11,  load average: 0.42, 0.37, 0.29\r\n';
      case 'echo': return `${args.join(' ')}\r\n`;
      case 'clear': return '\x1b[2J\x1b[H';
      case 'exit': return '\x00exit';
      default: return `sh: ${cmd}: not found\r\n`;
    }
  };
  const onInput = (chunk: Buffer) => {
    for (const ch of chunk.toString()) {
      if (ch === '\r' || ch === '\n') {
        write('\r\n');
        const out = answer(line);
        line = '';
        if (out === '\x00exit') {
          io.onExit({ code: 0 });
          return;
        }
        write(out + prompt);
      } else if (ch === '\x7f' || ch === '\b') {
        if (line.length) {
          line = line.slice(0, -1);
          write('\b \b');
        }
      } else if (ch === '\x03') {
        line = '';
        write('^C\r\n' + prompt);
      } else if (ch >= ' ') {
        line += ch;
        write(ch);
      }
    }
  };
  io.stdin.on('data', onInput);
  return { close: () => io.stdin.off('data', onInput) };
}

class DemoConnection implements ClusterConnection {
  readonly context: ClusterContext = {
    name: DEMO_CONTEXT,
    cluster: DEMO_CONTEXT,
    user: DEMO_CONTEXT,
    namespace: 'payments',
    source: '(built in)',
    server: 'https://demo.mjolnir.local',
    provider: 'other',
  };

  readonly #transport = new DemoTransport();
  readonly #watches = new Map<string, DemoWatch>();

  json<T = unknown>(path: string): Promise<T> {
    return this.#transport.json<T>(path);
  }

  // Writes land in the demo store, so what you did is what you see next.
  replace<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.replace<T>(path, body);
  }

  remove<T = unknown>(path: string): Promise<T> {
    return this.#transport.remove<T>(path);
  }

  patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.patch<T>(path, body);
  }

  create<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.#transport.create<T>(path, body);
  }

  async exec(options: ExecOptions, io: ExecIo): Promise<{ close: () => void }> {
    return demoShell(options, io);
  }

  async forward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void> {
    // The demo pod answers every request with one page, so the forward can be
    // opened in a browser and seen to work.
    socket.once('data', () => {
      const body = `<!doctype html><title>${pod}</title><body style="font:14px system-ui;padding:32px"><h1>${pod}:${port}</h1><p>Forwarded from the Mjolnir demo cluster (${namespace}).</p></body>`;
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    });
  }

  watch(resource: ResourceDefinition, namespace?: string): ResourceSource {
    const key = `${resource.kind}/${namespace ?? '*'}`;
    const existing = this.#watches.get(key);
    if (existing) return existing as unknown as ResourceSource;

    const created = new DemoWatch({ resource, ...(namespace ? { namespace } : {}) });
    this.#watches.set(key, created);
    void created.start();
    return created as unknown as ResourceSource;
  }

  streamLogs(options: LogStreamOptions): AsyncGenerator<LogLine, void, undefined> {
    const containers = demoContainers(options.namespace, options.pod);
    return streamDemoLogs({
      namespace: options.namespace,
      pod: options.pod,
      container: options.container ?? containers[0] ?? '',
      ...(options.follow !== undefined ? { follow: options.follow } : {}),
      ...(options.previous !== undefined ? { previous: options.previous } : {}),
      ...(options.tailLines !== undefined ? { tailLines: options.tailLines } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  async readLogs(options: Omit<LogStreamOptions, 'follow'>): Promise<LogLine[]> {
    const lines: LogLine[] = [];
    for await (const line of this.streamLogs({ ...options, follow: false })) lines.push(line);
    return lines;
  }

  async close(): Promise<void> {
    await Promise.all([...this.#watches.values()].map((watch) => watch.stop()));
    this.#watches.clear();
  }
}

/**
 * Every cluster the user has open.
 *
 * Connections are lazy, a kubeconfig with forty contexts must not open forty
 * connections, because most are clusters nobody is looking at and some are
 * VPN-only endpoints that would each cost a timeout.
 */
export class ClusterRegistry {
  #contexts: ClusterContext[] = [];
  #current: string | null = null;
  #failures: Array<{ path: string; error: string }> = [];
  #kubeconfig: KubeConfig | null = null;
  readonly #connections = new Map<string, ClusterConnection>();

  async reload(): Promise<void> {
    const result = await loadKubeconfig();
    this.#kubeconfig = result.config;
    this.#failures = result.failures;

    // The demo cluster is always present. Someone evaluating the app should
    // never have to point it at production to find out whether it is any good.
    const demo = new DemoConnection();
    this.#contexts = [demo.context, ...result.contexts];
    this.#current = result.currentContext ?? DEMO_CONTEXT;

    const names = new Set(this.#contexts.map((context) => context.name));
    for (const [name, connection] of this.#connections) {
      if (!names.has(name)) {
        this.#connections.delete(name);
        void connection.close();
      }
    }

    log.info('kubeconfig loaded', {
      contexts: result.contexts.length,
      current: this.#current,
      failures: this.#failures.length,
    });
  }

  get contexts(): readonly ClusterContext[] {
    return this.#contexts;
  }

  get currentContext(): string | null {
    return this.#current;
  }

  get failures(): ReadonlyArray<{ path: string; error: string }> {
    return this.#failures;
  }

  connect(contextName: string): ClusterConnection {
    const existing = this.#connections.get(contextName);
    if (existing) return existing;

    if (contextName === DEMO_CONTEXT) {
      const demo = new DemoConnection();
      this.#connections.set(contextName, demo);
      return demo;
    }

    if (!this.#kubeconfig) throw new Error('kubeconfig has not been loaded');
    const context = this.#contexts.find((entry) => entry.name === contextName);
    if (!context) throw new Error(`unknown context: ${contextName}`);

    const connection = new LiveConnection(context, configForContext(this.#kubeconfig, contextName));
    this.#connections.set(contextName, connection);
    log.info('connected to cluster', { context: contextName, provider: context.provider });
    return connection;
  }

  async disconnect(contextName: string): Promise<void> {
    const connection = this.#connections.get(contextName);
    if (!connection) return;
    this.#connections.delete(contextName);
    await connection.close();
  }

  async shutdown(): Promise<void> {
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    await Promise.all(connections.map((connection) => connection.close()));
  }
}
