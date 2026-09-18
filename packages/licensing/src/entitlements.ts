/**
 * What each tier is allowed to do.
 *
 * Everything gated lives in this one table. Scattering `if (isPro)` through the
 * UI is how a free tier ends up accidentally crippled in one screen and
 * accidentally generous in another — and how you discover it from a review
 * rather than a test.
 */

export type Tier = 'free' | 'pro';

export const FEATURES = [
  // Free — a complete single-user Kubernetes client.
  'clusters.unlimited',
  'resources.browse',
  'resources.edit',
  'resources.delete',
  'logs.stream',
  'logs.search',
  'logs.previous',
  'logs.structured',
  'logs.download',
  'terminal',
  'portForward',
  'dashboard',
  'topology',
  'helm.browse',
  'argocd.browse',
  'customResources',
  'menuBar.health',
  'savedViews',
  'cloud.singleAccount',

  // Pro.
  'cloud.multiAccount',
  'cloud.roleChaining',
  'cloud.ssoIntegration',
  'cloud.clusterBinding',
  'logs.aggregate',
  'security.scan',
  'security.rbacAudit',
  'argocd.operate',
  'assistant',
  'monitoring.background',
  'monitoring.alerts',
  'workspace.sync',
] as const;

export type Feature = (typeof FEATURES)[number];

const PRO_ONLY: ReadonlySet<Feature> = new Set<Feature>([
  'cloud.multiAccount',
  'cloud.roleChaining',
  'cloud.ssoIntegration',
  'cloud.clusterBinding',
  'logs.aggregate',
  'security.scan',
  'security.rbacAudit',
  'argocd.operate',
  'assistant',
  'monitoring.background',
  'monitoring.alerts',
  'workspace.sync',
]);

export function isProFeature(feature: Feature): boolean {
  return PRO_ONLY.has(feature);
}

export function allows(tier: Tier, feature: Feature): boolean {
  return tier === 'pro' || !PRO_ONLY.has(feature);
}

/** Features a given tier can use, for rendering an upgrade comparison. */
export function featuresFor(tier: Tier): Feature[] {
  return FEATURES.filter((feature) => allows(tier, feature));
}

export const PRO_FEATURES: readonly Feature[] = FEATURES.filter(isProFeature);
