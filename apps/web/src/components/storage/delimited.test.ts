import { describe, expect, it } from 'vitest';
import { parseDelimited, sniffDelimiter } from './TableView.tsx';

describe('parseDelimited', () => {
  it('keeps a delimiter that lives inside quotes', () => {
    expect(parseDelimited('a,"b,c",d', ',')).toEqual([['a', 'b,c', 'd']]);
  });

  it('keeps a newline that lives inside quotes', () => {
    expect(parseDelimited('a,"line one\nline two"\nb,c', ',')).toEqual([
      ['a', 'line one\nline two'],
      ['b', 'c'],
    ]);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseDelimited('"he said ""no"""', ',')).toEqual([['he said "no"']]);
  });

  it('survives CRLF', () => {
    expect(parseDelimited('a,b\r\nc,d\r\n', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps empty fields, because a gap is data', () => {
    expect(parseDelimited('a,,c', ',')).toEqual([['a', '', 'c']]);
  });
});

describe('sniffDelimiter', () => {
  it('finds tabs', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('finds the semicolons a European export uses', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('defaults to a comma', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
  });
});
