/**
 * Validation, in one place, phrased for the person typing.
 *
 * Every rule returns a sentence or null. The sentence says what is wrong and
 * what would be right, because "invalid" is a verdict, not help. Rules follow
 * what the API server would reject, so a value that passes here applies.
 */
export type Validator = (value: string) => string | null;

const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const QUALIFIED_NAME = /^([A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?)$/;
const LABEL_VALUE = /^([A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?)?$/;
const QUANTITY = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?(Ki|Mi|Gi|Ti|Pi|Ei|n|u|m|k|M|G|T|P|E)?$/;

export const required: Validator = (value) => (value.trim() === '' ? 'Cannot be empty.' : null);

/** Names of namespaced objects: lowercase, digits, dashes; 63 chars at most. */
export const dnsLabel: Validator = (value) => {
  if (value === '') return 'Cannot be empty.';
  if (value.length > 63) return `Too long: ${value.length} characters, 63 at most.`;
  if (!DNS_LABEL.test(value)) return 'Lowercase letters, digits and dashes only, starting and ending with a letter or digit.';
  return null;
};

/** Names that may contain dots (most kinds, Secrets, ConfigMaps): 253 chars. */
export const dnsSubdomain: Validator = (value) => {
  if (value === '') return 'Cannot be empty.';
  if (value.length > 253) return `Too long: ${value.length} characters, 253 at most.`;
  if (!DNS_SUBDOMAIN.test(value)) return 'Lowercase letters, digits, dashes and dots only, each part starting and ending with a letter or digit.';
  return null;
};

export const namespaceName: Validator = dnsLabel;

/** Label and annotation keys: optional prefix/, then a name of 63 chars. */
export const labelKey: Validator = (value) => {
  if (value === '') return 'Cannot be empty.';
  const slash = value.lastIndexOf('/');
  const prefix = slash === -1 ? '' : value.slice(0, slash);
  const name = slash === -1 ? value : value.slice(slash + 1);
  if (prefix) {
    if (prefix.length > 253) return 'The prefix before / is 253 characters at most.';
    if (!DNS_SUBDOMAIN.test(prefix)) return 'The prefix before / must be a DNS name like example.com.';
  }
  if (name.length > 63) return `The name after / is 63 characters at most (${name.length}).`;
  if (!QUALIFIED_NAME.test(name)) return 'Letters, digits, dashes, underscores and dots, starting and ending with a letter or digit.';
  return null;
};

export const labelValue: Validator = (value) => {
  if (value.length > 63) return `Too long: ${value.length} characters, 63 at most.`;
  if (!LABEL_VALUE.test(value)) return 'Letters, digits, dashes, underscores and dots, starting and ending with a letter or digit. Empty is allowed.';
  return null;
};

/** Annotation values can be anything up to 256 KiB across all annotations. */
export const annotationValue: Validator = (value) => (value.length > 262_144 ? 'Annotations are limited to 256 KiB in total.' : null);

/** CPU and memory quantities: 500m, 2, 512Mi, 1.5Gi. */
export const quantity: Validator = (value) => {
  if (value.trim() === '') return 'Cannot be empty.';
  if (!QUANTITY.test(value.trim())) return 'A Kubernetes quantity: 500m, 2, 256Mi, 1.5Gi.';
  return null;
};
export const cpuQuantity: Validator = (value) => {
  const base = quantity(value);
  if (base) return base;
  if (/(Ki|Mi|Gi|Ti|Pi|Ei)$/.test(value.trim())) return 'CPU is in cores or millicores (500m, 2), not bytes.';
  return null;
};
export const memoryQuantity: Validator = (value) => {
  const base = quantity(value);
  if (base) return base;
  if (/m$/.test(value.trim())) return 'Memory is in bytes (256Mi, 1Gi), not millicores.';
  return null;
};

/** A container image reference. */
export const imageRef: Validator = (value) => {
  const v = value.trim();
  if (v === '') return 'Cannot be empty.';
  if (/\s/.test(v)) return 'No spaces in an image reference.';
  if (/[A-Z]/.test(v.split(/[:@]/)[0] ?? '')) return 'The repository part is lowercase.';
  if (!/^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*(:[\w][\w.-]{0,127})?(@sha256:[a-f0-9]{64})?$/.test(v)) return 'Looks like registry/repo:tag or repo@sha256:digest.';
  return null;
};

export const port: Validator = (value) => {
  if (value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return 'A port is a whole number from 1 to 65535.';
  return null;
};

export const nonNegativeInteger: Validator = (value) => {
  if (value.trim() === '') return 'Cannot be empty.';
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return 'A whole number, 0 or more.';
  return null;
};

export const url: Validator = (value) => {
  if (value.trim() === '') return 'Cannot be empty.';
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Starts with http:// or https://.';
    return null;
  } catch {
    return 'A full URL, like http://127.0.0.1:9000.';
  }
};

export const optionalUrl: Validator = (value) => (value.trim() === '' ? null : url(value));

export const filePath: Validator = (value) => {
  const v = value.trim();
  if (v === '') return 'Cannot be empty.';
  if (!/^(~|\/|[A-Za-z]:\\)/.test(v)) return 'An absolute path, or one starting with ~.';
  return null;
};

export const bucketName: Validator = (value) => {
  if (value.length < 3 || value.length > 63) return '3 to 63 characters.';
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value)) return 'Lowercase letters, digits, dots and dashes, starting and ending with a letter or digit.';
  if (/\.\./.test(value)) return 'No two dots in a row.';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) return 'Cannot look like an IP address.';
  return null;
};

export const licenceKey: Validator = (value) => {
  const v = value.trim();
  if (v === '') return 'Paste the key.';
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)) return 'A key is two base64url parts joined by a dot.';
  return null;
};

export const modelName: Validator = (value) => (value.trim() === '' ? 'Name the model, e.g. claude-sonnet-5.' : /\s/.test(value.trim()) ? 'No spaces in a model name.' : null);

export const taintEffect: Validator = (value) => (['NoSchedule', 'PreferNoSchedule', 'NoExecute'].includes(value) ? null : 'NoSchedule, PreferNoSchedule or NoExecute.');

/** Runs several rules; the first sentence wins. */
export function all(...rules: Validator[]): Validator {
  return (value) => {
    for (const rule of rules) {
      const message = rule(value);
      if (message) return message;
    }
    return null;
  };
}
