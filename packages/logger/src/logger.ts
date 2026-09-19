import { appendFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
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

  /**
   * Adds a transport to this logger and to every child it has already made.
   *
   * Children share the array rather than copying it, so a file opened once the
   * app knows where its data lives still catches everything logged by modules
   * that took their logger at import time. Without this the desktop could only
   * log its own lines, and the server's, which are the interesting ones when a
   * launch fails, would go to a console nobody is attached to.
   */
  attach(transport: Transport): void {
    this.#transports.push(transport);
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
      // A failing transport must never take down the caller, a full disk is
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

/**
 * Writes every record to a file, so a packaged app can say what went wrong.
 *
 * A desktop app that fails to start and prints nothing is a support ticket
 * that cannot be answered. There is no console attached to a double-clicked
 * `.app`, so without this the only evidence of a failed launch is that
 * nothing happened. The file is capped and rolled once, because a log that
 * fills someone's disk is its own bug.
 *
 * Records are already redacted by the time a transport sees them.
 */
export function fileTransport(path: string, maxBytes = 2 * 1024 * 1024): Transport {
  let written = 0;
  let checked = false;

  return (record) => {
    const line = `${JSON.stringify(record)}\n`;
    if (!checked) {
      checked = true;
      try {
        written = statSync(path).size;
      } catch {
        written = 0;
      }
    }
    if (written + line.length > maxBytes) {
      try {
        renameSync(path, `${path}.1`);
      } catch {
        // A failed roll is not a reason to stop logging; truncate instead.
        try {
          writeFileSync(path, '');
        } catch {
          /* intentionally ignored */
        }
      }
      written = 0;
    }
    appendFileSync(path, line);
    written += line.length;
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
  transports: [consoleTransport(), ...(process.env['MJOLNIR_LOG_FILE'] ? [fileTransport(process.env['MJOLNIR_LOG_FILE'])] : [])],
});
