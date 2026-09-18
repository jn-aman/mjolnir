import { redact } from './redact.ts';

export const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
export type Level = (typeof LEVELS)[number];

const SEVERITY: Record<Level, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };

export interface LogRecord {
  readonly time: string;
  readonly level: Level;
  readonly scope: string;
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

export type Transport = (record: LogRecord) => void;

export interface LoggerOptions {
  level?: Level;
  scope?: string;
  transports?: Transport[];
  fields?: Record<string, unknown>;
}

/**
 * A scoped, structured logger.
 *
 * Every field passed in is redacted before it reaches a transport, so callers
 * cannot leak a token by logging an object they did not fully inspect. That is
 * the whole reason this exists rather than `console.log`.
 */
export class Logger {
  readonly #level: Level;
  readonly #scope: string;
  readonly #transports: Transport[];
  readonly #fields: Record<string, unknown>;

  constructor(options: LoggerOptions = {}) {
    this.#level = options.level ?? 'info';
    this.#scope = options.scope ?? 'mjolnir';
    this.#transports = options.transports ?? [consoleTransport()];
    this.#fields = options.fields ?? {};
  }

  /** A logger that inherits transports and level, with a narrower scope. */
  child(scope: string, fields: Record<string, unknown> = {}): Logger {
    return new Logger({
      level: this.#level,
      scope: `${this.#scope}:${scope}`,
      transports: this.#transports,
      fields: { ...this.#fields, ...fields },
    });
  }

  isEnabled(level: Level): boolean {
    return SEVERITY[level] >= SEVERITY[this.#level];
  }

  trace(message: string, fields?: Record<string, unknown>): void { this.#log('trace', message, fields); }
  debug(message: string, fields?: Record<string, unknown>): void { this.#log('debug', message, fields); }
  info(message: string, fields?: Record<string, unknown>): void { this.#log('info', message, fields); }
  warn(message: string, fields?: Record<string, unknown>): void { this.#log('warn', message, fields); }
  error(message: string, fields?: Record<string, unknown>): void { this.#log('error', message, fields); }

  #log(level: Level, message: string, fields?: Record<string, unknown>): void {
    if (!this.isEnabled(level)) return;

    const merged = { ...this.#fields, ...fields };
    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      scope: this.#scope,
      message,
      fields: redact(merged) as Record<string, unknown>,
    };

    for (const transport of this.#transports) {
      // A failing transport must never take down the caller — a full disk is
      // not a reason for the app to stop working.
      try {
        transport(record);
      } catch {
        /* intentionally ignored */
      }
    }
  }
}

const CONSOLE_METHOD: Record<Level, 'debug' | 'info' | 'warn' | 'error'> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

/** Human-readable in development, single-line JSON in production. */
export function consoleTransport(pretty = process.env['NODE_ENV'] !== 'production'): Transport {
  return (record) => {
    const method = CONSOLE_METHOD[record.level];
    if (!pretty) {
      console[method](JSON.stringify(record));
      return;
    }
    const detail = Object.keys(record.fields).length > 0 ? record.fields : undefined;
    const prefix = `${record.level.toUpperCase().padEnd(5)} ${record.scope}`;
    if (detail) console[method](prefix, record.message, detail);
    else console[method](prefix, record.message);
  };
}

/** Keeps the last N records in memory, for attaching to a crash report. */
export function ringBufferTransport(capacity = 500): Transport & { records: () => LogRecord[] } {
  const buffer: LogRecord[] = [];
  const transport = ((record: LogRecord) => {
    buffer.push(record);
    if (buffer.length > capacity) buffer.shift();
  }) as Transport & { records: () => LogRecord[] };
  transport.records = () => [...buffer];
  return transport;
}

export const logger = new Logger({
  level: (process.env['MJOLNIR_LOG_LEVEL'] as Level | undefined) ?? 'info',
});
