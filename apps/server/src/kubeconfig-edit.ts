import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dump, load } from 'js-yaml';

/**
 * Removes a context from a kubeconfig file, and the cluster and user it
 * referenced when nothing else does. The file is backed up first, beside
 * itself, because "remove cluster" is the one settings action that can lock
 * you out of production if it goes wrong.
 */
interface Kubeconfig {
  'current-context'?: string;
  contexts?: Array<{ name: string; context?: { cluster?: string; user?: string } }>;
  clusters?: Array<{ name: string }>;
  users?: Array<{ name: string }>;
  [key: string]: unknown;
}

export function removeContextFromFile(path: string, contextName: string): { backup: string } {
  const doc = load(readFileSync(path, 'utf8')) as Kubeconfig | undefined;
  if (!doc || !Array.isArray(doc.contexts)) throw new Error(`${path} is not a kubeconfig`);
  const target = doc.contexts.find((entry) => entry.name === contextName);
  if (!target) throw new Error(`${path} has no context ${contextName}`);

  const remaining = doc.contexts.filter((entry) => entry.name !== contextName);
  const stillUsed = (key: 'cluster' | 'user', name: string | undefined) => !!name && remaining.some((entry) => entry.context?.[key] === name);
  const next: Kubeconfig = {
    ...doc,
    contexts: remaining,
    clusters: (doc.clusters ?? []).filter((c) => c.name !== target.context?.cluster || stillUsed('cluster', c.name)),
    users: (doc.users ?? []).filter((u) => u.name !== target.context?.user || stillUsed('user', u.name)),
  };
  if (doc['current-context'] === contextName) next['current-context'] = remaining[0]?.name ?? '';

  const backup = `${path}.mjolnir-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(path, backup);
  writeFileSync(path, dump(next, { lineWidth: 0, noRefs: true }), { mode: 0o600 });
  return { backup };
}
