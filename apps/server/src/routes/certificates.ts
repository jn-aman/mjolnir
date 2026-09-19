import { Router } from 'express';
import {
  inspectCertificates,
  type CaBundleHolder,
  type CertManagerCertificate,
  type IngressObject,
  type TlsSecret,
} from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from '../clusters.ts';
import type { FlagStore } from '../flags.ts';
import { HttpError, handle, param, query } from '../http.ts';

const log = logger.child('certificates');

/**
 * Every certificate in a cluster, and when it stops working.
 *
 * The secrets are read with a field selector, so the API server returns only
 * TLS secrets rather than every secret in the cluster. That is not an
 * optimisation, it is the difference between reading the one kind of secret
 * this feature is about and reading all of them.
 *
 * The private keys come with them, because Kubernetes has no way to ask for
 * part of a secret. Nothing here parses, logs, caches or returns one: the
 * certificate is extracted, the rest of the object is dropped when this
 * function returns. A certificate is public by construction and the key beside
 * it is not.
 */
export function certificateRoutes(registry: ClusterRegistry, flags: FlagStore): Router {
  const router = Router();

  router.get(
    '/:context',
    handle(async (req, res) => {
      if (!flags.value('kubernetes.certificates')) {
        throw new HttpError(404, 'not-found', 'the certificate tool is switched off in this build');
      }

      const contextName = param(req, 'context');
      const namespace = query(req, 'namespace') ?? '';
      const connection = registry.connect(contextName);
      const scope = namespace ? `/api/v1/namespaces/${encodeURIComponent(namespace)}` : '/api/v1';
      const ingressScope = namespace
        ? `/apis/networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}`
        : '/apis/networking.k8s.io/v1';
      const certScope = namespace
        ? `/apis/cert-manager.io/v1/namespaces/${encodeURIComponent(namespace)}`
        : '/apis/cert-manager.io/v1';

      const started = Date.now();
      const [secrets, certificates, ingresses, validating, mutating, apiServices] = await Promise.allSettled([
        connection.json<{ items?: TlsSecret[] }>(`${scope}/secrets?fieldSelector=type%3Dkubernetes.io%2Ftls&limit=500`),
        connection.json<{ items?: CertManagerCertificate[] }>(`${certScope}/certificates?limit=500`),
        connection.json<{ items?: IngressObject[] }>(`${ingressScope}/ingresses?limit=500`),
        // Cluster-scoped, so they are skipped when the question is about one
        // namespace: a namespace's certificates are not the cluster's.
        namespace
          ? Promise.resolve({ items: [] })
          : connection.json<{ items?: CaBundleHolder[] }>('/apis/admissionregistration.k8s.io/v1/validatingwebhookconfigurations?limit=200'),
        namespace
          ? Promise.resolve({ items: [] })
          : connection.json<{ items?: CaBundleHolder[] }>('/apis/admissionregistration.k8s.io/v1/mutatingwebhookconfigurations?limit=200'),
        namespace
          ? Promise.resolve({ items: [] })
          : connection.json<{ items?: CaBundleHolder[] }>('/apis/apiregistration.k8s.io/v1/apiservices?limit=200'),
      ]);

      // A cluster with no cert-manager returns 404 for its API group, which is
      // the normal case rather than an error. Same for a token that may not
      // read webhook configurations.
      const settle = <T,>(result: PromiseSettledResult<{ items?: T[] }>): T[] =>
        result.status === 'fulfilled' ? (result.value.items ?? []) : [];

      const report = inspectCertificates({
        now: Date.now(),
        secrets: settle(secrets),
        certificates: settle(certificates),
        ingresses: settle(ingresses),
        webhooks: [...settle(validating), ...settle(mutating)],
        apiServices: settle<CaBundleHolder>(apiServices).filter((service) => Boolean(service.spec?.caBundle)),
      });

      log.info('certificates inspected', {
        context: contextName,
        found: report.certificates.length,
        expired: report.counts.expired,
        ms: Date.now() - started,
      });
      res.json({ ...report, scope: { namespace: namespace || null } });
    }),
  );

  return router;
}
