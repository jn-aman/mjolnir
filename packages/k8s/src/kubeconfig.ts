import { KubeConfig } from '@kubernetes/client-node';
import { logger } from '@mjolnir/logger';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const log = logger.child('kubeconfig');

export interface ClusterContext {
  /** Context name as it appears in the kubeconfig. */
  readonly name: string;
  readonly cluster: string;
  readonly user: string;
  readonly namespace: string;
  /** Absolute path of the kubeconfig file this context came from. */
  readonly source: string;
  /** API server URL, for display and for distinguishing same-named contexts. */
  readonly server: string | null;
  /** Provider inferred from the server URL and auth config, for iconography. */
  readonly provider: Provider;
}

export type Provider = 'eks' | 'aks' | 'gke' | 'kind' | 'minikube' | 'k3s' | 'openshift' | 'other';

/**
 * Infer the provider from a context.
 *
 * Purely cosmetic, it drives an icon and, for EKS, which cloud session Mjolnir
 * offers to bind. It must never gate functionality, because the heuristics are
 * guesses and a wrong guess should cost an icon, not access to a cluster.
 */
export function inferProvider(server: string | null, contextName: string, clusterName: string): Provider {
  const haystack = `${server ?? ''} ${contextName} ${clusterName}`.toLowerCase();

  if (/eks\.amazonaws\.com|arn:aws:eks/.test(haystack)) return 'eks';
  if (/azmk8s\.io|\/managedclusters\//.test(haystack)) return 'aks';
  if (/gke_|container\.googleapis\.com/.test(haystack)) return 'gke';
  if (/^kind-|kind-control-plane/.test(haystack)) return 'kind';
  if (/minikube/.test(haystack)) return 'minikube';
  if (/k3s|k3d/.test(haystack)) return 'k3s';
  if (/openshift|\.ocp\.|api\..*:6443/.test(haystack)) return 'openshift';
  return 'other';
}

/**
 * The kubeconfig files to read, honouring KUBECONFIG.
 *
 * KUBECONFIG may list several files separated by the platform path delimiter,
 * and kubectl merges them left to right. Tools that read only ~/.kube/config
 * silently miss clusters for anyone using that convention, which is common in
 * exactly the multi-account setups Mjolnir targets.
 */
export function kubeconfigPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env['KUBECONFIG'];
  if (configured && configured.trim() !== '') {
    return configured
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(entry)));
  }
  return [path.join(homedir(), '.kube', 'config')];
}

export interface LoadResult {
  readonly config: KubeConfig;
  readonly contexts: ClusterContext[];
  readonly currentContext: string | null;
  /** Files that could not be read, with the reason. Never fatal. */
  readonly failures: Array<{ path: string; error: string }>;
}

/**
 * Load and merge every configured kubeconfig.
 *
 * A single unreadable or malformed file must not cost the user every other
 * cluster, so failures are collected and returned rather than thrown. The app
 * shows what it could load and reports what it could not.
 */
export async function loadKubeconfig(env: NodeJS.ProcessEnv = process.env): Promise<LoadResult> {
  const paths = kubeconfigPaths(env);
  const config = new KubeConfig();
  const failures: Array<{ path: string; error: string }> = [];
  let loadedAny = false;

  for (const file of paths) {
    try {
      const contents = await readFile(file, 'utf8');
      const partial = new KubeConfig();
      partial.loadFromString(contents);
      if (loadedAny) {
        config.mergeConfig(partial);
      } else {
        config.loadFromString(contents);
        loadedAny = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ path: file, error: message });
      log.warn('could not read kubeconfig', { path: file, error: message });
    }
  }

  const contexts: ClusterContext[] = config.getContexts().map((context) => {
    const cluster = config.getCluster(context.cluster);
    const server = cluster?.server ?? null;
    return {
      name: context.name,
      cluster: context.cluster,
      user: context.user,
      namespace: context.namespace ?? 'default',
      source: paths[0] ?? '',
      server,
      provider: inferProvider(server, context.name, context.cluster),
    };
  });

  return {
    config,
    contexts,
    currentContext: loadedAny ? (config.getCurrentContext() ?? null) : null,
    failures,
  };
}

/**
 * A KubeConfig pinned to one context.
 *
 * Every cluster connection gets its own instance rather than mutating a shared
 * one. Switching the current context on a shared config is a data race the
 * moment two clusters are open at once, which is the normal case here.
 */
export function configForContext(config: KubeConfig, contextName: string): KubeConfig {
  const found = config.getContexts().find((context) => context.name === contextName);
  if (!found) {
    throw new Error(`context not found: ${contextName}`);
  }

  const isolated = new KubeConfig();
  isolated.loadFromOptions({
    clusters: config.getClusters(),
    users: config.getUsers(),
    contexts: config.getContexts(),
    currentContext: contextName,
  });
  return isolated;
}
