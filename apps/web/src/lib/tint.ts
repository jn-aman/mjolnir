/**
 * Deterministic tints for names.
 *
 * A namespace, a node or an owner gets the same hue every time it appears, so
 * the eye learns "payments is blue" once and then finds it without reading.
 * Colour goes on a mark, a dot, a chip border, an icon, and never on the
 * text itself: five hues of body text is noise, five hues of dot is a key.
 *
 * The hues are the validated chart series plus one, so they stay legible in
 * both themes and distinct from the status colours, which mean something.
 */
const TINTS = [
  'var(--series-1)',
  'var(--series-3)',
  'var(--series-2)',
  'var(--log-pod-b)',
  'var(--series-4)',
] as const;

export function tintFor(name: string | undefined): string {
  if (!name) return 'var(--text-tertiary)';
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return TINTS[hash % TINTS.length] as string;
}

/** A fixed tint per navigation category, so sections read as groups. */
export const CATEGORY_TINT: Record<string, string> = {
  cluster: 'var(--series-1)',
  workloads: 'var(--series-3)',
  config: 'var(--series-4)',
  network: 'var(--series-2)',
  storage: 'var(--log-pod-b)',
  access: 'var(--status-error)',
  custom: 'var(--series-5)',
};
