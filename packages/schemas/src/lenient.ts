import type { ZodType } from 'zod';

/**
 * Parsing policy for Kubernetes API objects.
 *
 * The API server returns objects whose shape drifts across versions, across
 * distributions, and across CRD authors. A viewer must therefore never treat a
 * schema mismatch as fatal: one malformed Pod in a list of 500 should cost you
 * that row, not the whole screen. Every parse here is total, it returns a
 * result, it does not throw.
 */

export type ParseOk<T> = { readonly ok: true; readonly data: T };
export type ParseErr = { readonly ok: false; readonly error: string; readonly raw: unknown };
export type ParseResult<T> = ParseOk<T> | ParseErr;

/** Sink for schema mismatches. Wired to the app logger at startup. */
export type Reporter = (message: string, detail: { context: string; raw: unknown }) => void;

let report: Reporter = () => {};

export function setSchemaReporter(reporter: Reporter): void {
  report = reporter;
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
    return issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

/** Parse one object. Never throws; mismatches are reported and returned as errors. */
export function parse<T>(schema: ZodType<T>, input: unknown, context: string): ParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const error = describe(result.error);
  report(`schema mismatch in ${context}: ${error}`, { context, raw: input });
  return { ok: false, error, raw: input };
}

/**
 * Parse a list, dropping only the entries that fail.
 *
 * This is the difference between "the Pods tab is empty" and "498 of 500 Pods,
 * 2 could not be read", the second is a usable screen and an actionable bug
 * report, so it is what we always produce.
 */
export function parseList<T>(
  schema: ZodType<T>,
  input: unknown,
  context: string,
): { items: T[]; skipped: number; errors: string[] } {
  if (!Array.isArray(input)) {
    if (input != null) report(`expected a list in ${context}`, { context, raw: input });
    return { items: [], skipped: 0, errors: input == null ? [] : ['not a list'] };
  }

  const items: T[] = [];
  const errors: string[] = [];
  for (const entry of input) {
    const result = parse(schema, entry, context);
    if (result.ok) items.push(result.data);
    else if (errors.length < 10) errors.push(result.error);
  }
  return { items, skipped: input.length - items.length, errors };
}
