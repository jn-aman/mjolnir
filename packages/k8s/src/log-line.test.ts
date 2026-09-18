import { describe, expect, it } from 'vitest';
import {
  LineSplitter,
  normalizeStructured,
  parseLogLine,
  parseStructured,
  stripAnsi,
} from './log-line.js';

const ESC = '';

describe('LineSplitter', () => {
  it('emits only complete lines', () => {
    const splitter = new LineSplitter();
    expect(splitter.push('one\ntwo\n')).toEqual(['one', 'two']);
  });

  it('carries a partial line across chunks', () => {
    const splitter = new LineSplitter();
    // The bug this prevents: a long stack trace arriving in two packets and
    // being emitted as two corrupted lines.
    expect(splitter.push('java.lang.Null')).toEqual([]);
    expect(splitter.push('PointerException: boom\n')).toEqual([
      'java.lang.NullPointerException: boom',
    ]);
  });

  it('handles a chunk boundary landing exactly on the newline', () => {
    const splitter = new LineSplitter();
    expect(splitter.push('alpha')).toEqual([]);
    expect(splitter.push('\n')).toEqual(['alpha']);
  });

  it('flushes a trailing line with no newline', () => {
    const splitter = new LineSplitter();
    splitter.push('no trailing newline');
    expect(splitter.flush()).toEqual(['no trailing newline']);
    expect(splitter.flush()).toEqual([]);
  });
});

describe('parseLogLine', () => {
  const context = { seq: 1, pod: 'api-0', container: 'api' };

  it('splits an RFC3339 timestamp from the message', () => {
    const line = parseLogLine('2026-09-18T10:00:00.123456789Z hello world', context);
    expect(line.timestamp?.toISOString()).toBe('2026-09-18T10:00:00.123Z');
    expect(line.message).toBe('hello world');
  });

  it('accepts an offset timestamp as well as Z', () => {
    const line = parseLogLine('2026-09-18T10:00:00+05:30 hello', context);
    expect(line.timestamp).not.toBeNull();
    expect(line.message).toBe('hello');
  });

  it('treats a line without a timestamp as all message', () => {
    const line = parseLogLine('plain output', context);
    expect(line.timestamp).toBeNull();
    expect(line.message).toBe('plain output');
  });

  it('does not eat a message that merely starts with digits', () => {
    const line = parseLogLine('200 OK in 5ms', context);
    expect(line.timestamp).toBeNull();
    expect(line.message).toBe('200 OK in 5ms');
  });

  it('carries pod and container through for aggregated views', () => {
    const line = parseLogLine('x', { seq: 7, pod: 'web-1', container: 'nginx' });
    expect(line).toMatchObject({ seq: 7, pod: 'web-1', container: 'nginx' });
  });
});

describe('stripAnsi', () => {
  it('removes colour codes', () => {
    expect(stripAnsi(`${ESC}[31merror${ESC}[0m`)).toBe('error');
  });

  it('removes cursor and erase sequences', () => {
    expect(stripAnsi(`${ESC}[2K${ESC}[1Gprogress`)).toBe('progress');
  });

  it('leaves clean text untouched', () => {
    expect(stripAnsi('no escapes here')).toBe('no escapes here');
  });
});

describe('parseStructured', () => {
  it('recognises a JSON object line', () => {
    expect(parseStructured('{"level":"info","msg":"up"}')).toEqual({ level: 'info', msg: 'up' });
  });

  it('ignores non-objects and plain text', () => {
    expect(parseStructured('[1,2,3]')).toBeNull();
    expect(parseStructured('just text')).toBeNull();
    expect(parseStructured('{broken')).toBeNull();
    expect(parseStructured('42')).toBeNull();
  });
});

describe('normalizeStructured', () => {
  it('finds level, message and time across common spellings', () => {
    const fields = normalizeStructured({ severity: 'WARN', msg: 'slow', ts: '2026-09-18', rid: 'abc' });
    expect(fields.level).toBe('WARN');
    expect(fields.message).toBe('slow');
    expect(fields.time).toBe('2026-09-18');
    expect(fields.rest).toEqual({ rid: 'abc' });
  });

  it('returns nulls rather than guessing when the fields are absent', () => {
    const fields = normalizeStructured({ foo: 'bar' });
    expect(fields.level).toBeNull();
    expect(fields.message).toBeNull();
    expect(fields.rest).toEqual({ foo: 'bar' });
  });
});
