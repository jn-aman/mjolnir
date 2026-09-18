import { describe, expect, it } from 'vitest';
import { formatBytes, formatCpu, parseCpu, parseMemory, parseQuantity } from './quantity.ts';

describe('parseQuantity', () => {
  it('reads plain numbers', () => {
    expect(parseQuantity('1')).toBe(1);
    expect(parseQuantity('1.5')).toBe(1.5);
    expect(parseQuantity('.5')).toBe(0.5);
    expect(parseQuantity('-2')).toBe(-2);
    expect(parseQuantity(42)).toBe(42);
  });

  it('reads binary SI suffixes as powers of 1024', () => {
    expect(parseQuantity('1Ki')).toBe(1024);
    expect(parseQuantity('128Mi')).toBe(134_217_728);
    expect(parseQuantity('1Gi')).toBe(1_073_741_824);
    expect(parseQuantity('2Ti')).toBe(2 * 2 ** 40);
  });

  it('reads decimal SI suffixes as powers of 1000', () => {
    expect(parseQuantity('1k')).toBe(1000);
    expect(parseQuantity('1M')).toBe(1e6);
    expect(parseQuantity('1G')).toBe(1e9);
  });

  it('reads milli and micro suffixes', () => {
    expect(parseQuantity('100m')).toBeCloseTo(0.1);
    expect(parseQuantity('1500m')).toBeCloseTo(1.5);
    expect(parseQuantity('250u')).toBeCloseTo(0.00025);
    expect(parseQuantity('100n')).toBeCloseTo(1e-7);
  });

  it('reads exponent notation', () => {
    expect(parseQuantity('1e3')).toBe(1000);
    expect(parseQuantity('1.5E2')).toBe(150);
    expect(parseQuantity('2e-3')).toBeCloseTo(0.002);
  });

  it('accepts uppercase K, which appears in real manifests', () => {
    expect(parseQuantity('1K')).toBe(1000);
  });

  it('returns null rather than NaN for junk', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('   ')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('12Xi')).toBeNull();
    expect(parseQuantity('1.2.3')).toBeNull();
    expect(parseQuantity(null)).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
    expect(parseQuantity({})).toBeNull();
    expect(parseQuantity(Number.NaN)).toBeNull();
    expect(parseQuantity(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('does not confuse memory suffixes with bare numbers', () => {
    // The bug this module exists to prevent: parseFloat('128Mi') === 128.
    expect(parseMemory('128Mi')).not.toBe(128);
    expect(parseCpu('100m')).not.toBe(100);
  });
});

describe('formatBytes', () => {
  it('scales to the largest fitting binary unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(134_217_728)).toBe('128.0 MiB');
    expect(formatBytes(1_073_741_824)).toBe('1.0 GiB');
  });

  it('handles negatives and null without producing NaN', () => {
    expect(formatBytes(-1024)).toBe('-1.0 KiB');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatCpu', () => {
  it('renders sub-core values as millicores', () => {
    expect(formatCpu(0.1)).toBe('100m');
    expect(formatCpu(0.5)).toBe('500m');
  });

  it('renders whole cores without trailing zeroes', () => {
    expect(formatCpu(0)).toBe('0');
    expect(formatCpu(1)).toBe('1');
    expect(formatCpu(2.5)).toBe('2.5');
    expect(formatCpu(1.25)).toBe('1.25');
  });

  it('returns a dash for null', () => {
    expect(formatCpu(null)).toBe('—');
    expect(formatCpu(Number.NaN)).toBe('—');
  });
});
