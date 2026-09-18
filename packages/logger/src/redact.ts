/**
 * Redaction for anything on its way out of the process.
 *
 * Mjolnir handles kubeconfigs, bearer tokens, AWS credentials and Secret objects.
 * Those must never reach a log file, a crash report, or a model prompt. The
 * policy here is deliberately blunt: match broadly, accept false positives, and
 * never trade a leak for a prettier log line.
 */

/** Object keys whose values are replaced wholesale, matched case-insensitively. */
const SECRET_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'secretkey',
  'secret_key',
  'secretaccesskey',
  'privatekey',
  'private_key',
  'clientsecret',
  'client_secret',
  'sessiontoken',
  'session_token',
  'authorization',
  'auth',
  'credential',
  'credentials',
  'certificate-authority-data',
  'client-certificate-data',
  'client-key-data',
  'bearertoken',
  'id_token',
  'refresh_token',
];

/** Value-shaped secrets, for strings that arrive without a telltale key. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA…REDACTED'],
  [/\bASIA[0-9A-Z]{16}\b/g, 'ASIA…REDACTED'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, 'jwt…REDACTED'],
  [/\bghp_[A-Za-z0-9]{36}\b/g, 'ghp_…REDACTED'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'PRIVATE KEY REDACTED'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, 'Bearer REDACTED'],
];

export const REDACTED = '[redacted]';

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  return SECRET_KEYS.some((candidate) => normalized.includes(candidate.replace(/[-_]/g, '')));
}

/** Apply value-shaped patterns to a string. */
export function redactString(input: string): string {
  let output = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/**
 * Deep-redact a value for logging.
 *
 * Cycles are replaced with a marker rather than throwing, because a logger that
 * can crash the caller is worse than one that loses detail. Depth is capped for
 * the same reason, Kubernetes objects nest deeply and a managed-fields blob is
 * never what anyone wanted in a log.
 */
export function redact(value: unknown, maxDepth = 8): unknown {
  return walk(value, maxDepth, new WeakSet());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;

  if (seen.has(value)) return '[circular]';
  if (depth <= 0) return '[truncated]';
  seen.add(value);

  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => walk(entry, depth - 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    // Kubernetes stamps every object with managedFields. It is never useful in
    // a log and is frequently larger than the object it describes.
    if (key === 'managedFields') continue;
    output[key] = isSecretKey(key) ? REDACTED : walk(entry, depth - 1, seen);
  }
  return output;
}
