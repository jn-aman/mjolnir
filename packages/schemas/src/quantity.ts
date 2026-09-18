/**
 * Kubernetes resource quantities.
 *
 * The API expresses CPU and memory as suffixed strings ("100m", "1.5", "128Mi",
 * "1e3"). Reading them with parseFloat — which is what most dashboards do —
 * silently turns "128Mi" into 128 and "100m" into 100, so a pod using a tenth
 * of a core renders as using a hundred. These functions implement the actual
 * grammar from apimachinery.
 *
 * @see https://github.com/kubernetes/apimachinery/blob/master/pkg/api/resource/quantity.go
 */

/** Binary suffixes: powers of 1024. */
const BINARY_SI: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};

/** Decimal suffixes: powers of 1000. Note lowercase `k`, and `m` for milli. */
const DECIMAL_SI: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

const QUANTITY = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:([eE][+-]?\d+)|([KMGTPE]i)|([numkKMGTPE]))?$/;

/**
 * Parse a quantity into a plain number in its base unit — cores for CPU,
 * bytes for memory. Returns null for anything unparseable rather than NaN,
 * so callers must decide what to show instead of rendering "NaN".
 */
export function parseQuantity(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;

  const text = input.trim();
  if (text === '') return null;

  const match = QUANTITY.exec(text);
  if (!match) return null;

  const [, mantissa, exponent, binary, decimal] = match;
  const base = Number(mantissa);
  if (!Number.isFinite(base)) return null;

  if (exponent) {
    const value = Number(`${mantissa}${exponent}`);
    return Number.isFinite(value) ? value : null;
  }
  if (binary) {
    const factor = BINARY_SI[binary];
    return factor === undefined ? null : base * factor;
  }
  if (decimal) {
    // `K` is not valid decimal SI in the spec, but real manifests contain it
    // often enough that rejecting it costs users more than accepting it.
    const factor = DECIMAL_SI[decimal] ?? (decimal === 'K' ? 1e3 : undefined);
    return factor === undefined ? null : base * factor;
  }
  return base;
}

/** CPU quantity in cores. "100m" -> 0.1 */
export function parseCpu(input: unknown): number | null {
  return parseQuantity(input);
}

/** Memory quantity in bytes. "128Mi" -> 134217728 */
export function parseMemory(input: unknown): number | null {
  return parseQuantity(input);
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

/** Human-readable bytes. Returns the em dash for null, never "NaN". */
export function formatBytes(bytes: number | null, fractionDigits = 1): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—';
  if (bytes === 0) return '0 B';

  const negative = bytes < 0;
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rendered = unit === 0 ? String(Math.round(value)) : value.toFixed(fractionDigits);
  return `${negative ? '-' : ''}${rendered} ${BYTE_UNITS[unit]}`;
}

/** Human-readable CPU. Sub-core values render as millicores, as kubectl does. */
export function formatCpu(cores: number | null): string {
  if (cores === null || !Number.isFinite(cores)) return '—';
  if (cores === 0) return '0';
  if (Math.abs(cores) < 1) return `${Math.round(cores * 1000)}m`;
  return cores.toFixed(2).replace(/\.?0+$/, '');
}
