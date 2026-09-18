/**
 * Log line parsing.
 *
 * Streaming introduces a problem the source app never had: a chunk from the
 * socket can end mid-line, and the next chunk continues it. Splitting each
 * chunk on newlines independently corrupts exactly those lines — usually the
 * long ones, which are usually the stack traces. `LineSplitter` holds the
 * remainder between chunks so that never happens.
 */

export interface LogLine {
  /** Monotonic id, unique within a stream. Stable key for virtualized lists. */
  readonly seq: number;
  /** Timestamp from the API when requested and parseable, else null. */
  readonly timestamp: Date | null;
  readonly message: string;
  readonly pod: string;
  readonly container: string;
}

/** Splits a byte stream into complete lines, carrying partial lines across chunks. */
export class LineSplitter {
  #remainder = '';

  /** Feed a chunk; returns only the lines that are now complete. */
  push(chunk: string): string[] {
    const combined = this.#remainder + chunk;
    const parts = combined.split('\n');
    // The last element is either an empty string (chunk ended on a newline) or
    // a partial line. Either way it is not ready to emit.
    this.#remainder = parts.pop() ?? '';
    return parts;
  }

  /** Emit whatever is left when the stream ends. */
  flush(): string[] {
    if (this.#remainder === '') return [];
    const last = this.#remainder;
    this.#remainder = '';
    return [last];
  }
}

const RFC3339_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s/;

/**
 * Split a `timestamps: true` line into its timestamp and message.
 *
 * The API prepends an RFC3339 timestamp and a single space. If the line does
 * not start with one — which happens when a container writes a partial line
 * before its first newline — the whole line is the message.
 */
export function parseLogLine(
  raw: string,
  context: { seq: number; pod: string; container: string },
): LogLine {
  const match = RFC3339_PREFIX.exec(raw);
  if (!match?.[1]) {
    return {
      seq: context.seq,
      timestamp: null,
      message: raw,
      pod: context.pod,
      container: context.container,
    };
  }

  const parsed = new Date(match[1]);
  const valid = !Number.isNaN(parsed.getTime());
  return {
    seq: context.seq,
    timestamp: valid ? parsed : null,
    message: valid ? raw.slice(match[0].length) : raw,
    pod: context.pod,
    container: context.container,
  };
}

// Covers SGR colour codes plus cursor movement, erase and the OSC title
// sequence, which some loggers emit and which render as visible junk.
// Built from char codes rather than written literally: raw control bytes in
// source get mangled by editors, diffs and copy-paste.
const ESC = String.fromCharCode(0x1b);
const CSI = String.fromCharCode(0x9b);
const BEL = String.fromCharCode(0x07);
const ANSI = new RegExp(
  `[${ESC}${CSI}][[\\]()#;?]*` +
    `(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?${BEL}` +
    `|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~])`,
  'g',
);

export function stripAnsi(input: string): string {
  return input.replace(ANSI, '');
}

export function hasAnsi(input: string): boolean {
  ANSI.lastIndex = 0;
  return ANSI.test(input);
}

/**
 * Detect a JSON log line and return its fields.
 *
 * Most services log JSON, and both Lens and Freelens render it as an
 * undifferentiated wall of text. Recognising it is what lets the viewer offer
 * real columns. Only objects count — a bare array or number on its own line is
 * far more likely to be application output than a structured record.
 */
export function parseStructured(message: string): Record<string, unknown> | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Common spellings of the level, message and timestamp fields across loggers. */
const LEVEL_FIELDS = ['level', 'severity', 'lvl', 'loglevel', 'log_level', '@level'];
const MESSAGE_FIELDS = ['message', 'msg', 'text', 'event', '@message'];
const TIME_FIELDS = ['time', 'timestamp', 'ts', '@timestamp', 'datetime'];

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}

export interface StructuredFields {
  readonly level: string | null;
  readonly message: string | null;
  readonly time: string | null;
  /** Everything that is not level, message or time. */
  readonly rest: Record<string, unknown>;
}

/** Normalise a structured record into the three fields every log viewer shows. */
export function normalizeStructured(record: Record<string, unknown>): StructuredFields {
  const known = new Set([...LEVEL_FIELDS, ...MESSAGE_FIELDS, ...TIME_FIELDS]);
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!known.has(key)) rest[key] = value;
  }
  return {
    level: firstString(record, LEVEL_FIELDS),
    message: firstString(record, MESSAGE_FIELDS),
    time: firstString(record, TIME_FIELDS),
    rest,
  };
}
