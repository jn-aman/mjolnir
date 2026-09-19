import type { KubeObject } from '@mjolnir/schemas';
import { hours, iso, uid } from './clock.ts';

/**
 * The parts of a cluster the newer tools read.
 *
 * Everything here exists so the demo answers the same questions a real
 * cluster does: which certificates expire and who renews them, what a Service
 * actually points at, and whether a workload still matches the chart that
 * installed it. Without it those pages are correct and empty, which teaches
 * nobody anything and tests nothing.
 */

/**
 * Two real certificates.
 *
 * Really parsed, really self-signed, and valid for ten years so a demo that
 * still runs in 2030 does not open on a page of expired certificates. The
 * interesting expiry states are done with cert-manager objects below, whose
 * dates are computed when the demo starts and so are always relative to now.
 *
 * There is no private key here. A TLS secret in a real cluster has one and
 * nothing in Mjolnir reads it, so the demo carries an obviously fake string
 * instead: a repository is the last place a private key should be, even one
 * that protects nothing.
 */
const PLATFORM_CRT = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURaakNDQWs2Z0F3SUJBZ0lVSTcralQ2QVRWOVlTOVFlajlvRmIzZGtkdjNNd0RRWUpLb1pJaHZjTkFRRUwKQlFBd0pERWlNQ0FHQTFVRUF3d1paM0poWm1GdVlTNXdiR0YwWm05eWJTNXBiblJsY201aGJEQWVGdzB5TmpBNQpNVGt4TURFNU1qaGFGdzB6TmpBNU1UWXhNREU1TWpoYU1DUXhJakFnQmdOVkJBTU1HV2R5WVdaaGJtRXVjR3hoCmRHWnZjbTB1YVc1MFpYSnVZV3d3Z2dFaU1BMEdDU3FHU0liM0RRRUJBUVVBQTRJQkR3QXdnZ0VLQW9JQkFRQ1gKUi9EWDNhRVdCY3U5dm9HYWIxdWNBODFwOVAwQThsdDdKcXJCUlhWbUtlb0NvRklsTm1OemNlcHYwNENXQXlCUwpTSDdyc0tQWG4zS2JQNXBPWDJkeDRGVXIvZlQrenkzNFo3MDN3U05JOU11QXFsQlVaYy84VE1oVWZiSXVOcVJJCmk4SDg0Q3E5c2ZncWtMWU9UR0UveWhpcEVpb3prVGZPRWEvNmVPQ3V0Mnk5bGhBbzhVWmhNazJ4dmFzc25CaUUKUUxLS2VqUjhiUjlmUmxWYnh3UXcrSUNWeXdkcWw5aGVWNEpaaHJzaGh1VmF3T1A1ZVlzZm1keGt1RU5NSm9hOApFUmpDWXluWmhSM3ROK0g2a0VqUUhBbktmRnFkZWRHN1JoU1EybkYvTldkc3RlUFNLaXlnN2JRMTRrRmMwSENMCnpwSFVlNFlqNjBlaU9GWmpvaE81QWdNQkFBR2pnWTh3Z1l3d0hRWURWUjBPQkJZRUZNakwvQ3k3TEZadWFsMTAKZ1pha2gxQjFHdktHTUI4R0ExVWRJd1FZTUJhQUZNakwvQ3k3TEZadWFsMTBnWmFraDFCMUd2S0dNQThHQTFVZApFd0VCL3dRRk1BTUJBZjh3T1FZRFZSMFJCREl3TUlJWlozSmhabUZ1WVM1d2JHRjBabTl5YlM1cGJuUmxjbTVoCmJJSVRLaTV3YkdGMFptOXliUzVwYm5SbGNtNWhiREFOQmdrcWhraUc5dzBCQVFzRkFBT0NBUUVBV3h2OTZsMFgKYUtSWWNwOVJ2K0ZmQTB0cmR1K3JWNXhiTmxQbVlnUGxCTmNISHBCWkxZbHRTQlJLQjRDd1JmL0czV2dZdmxWNgpMcHZRR25EdFg4YkwzTGJkOUNETjBZVStiWDVyTjR5eTRXNmh4dUgwSXdpbGhacU5KcWVFL0dJUVV2TytocWFaCmhQNmUxZ2t1dG1vY0dNajBPK3pGSXVvWHJRS09wZWV2dU8yQjVvdkdvWU5vMWRCWktQdGoxWUFTT2JPQ3VlMFgKMUhWWEZqY1Q2Qmd1cHBZR3ZVdFE4VDZWWjRBYys4ZVBBbWRyYS90OVU1eUJUTXdHV1RMcHNlVS9RWEF0UkhBVgpmNGcwK0JTUWZRajluWWVjRGVnenVabldHMnVqcXZuK0h1WkJ5anpubHFjNHJ3Si9UcW1DQnlFbzJqUC9NNU9QCnBDZ2RsVHl4eTY0MkFRPT0KLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQo=';
const PAYMENTS_CRT = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURRekNDQWl1Z0F3SUJBZ0lVTVZWNTF5M1BPcFFaVzBMNnpiOTdtS3hoOFhrd0RRWUpLb1pJaHZjTkFRRUwKQlFBd0lERWVNQndHQTFVRUF3d1ZZWEJwTG5CaGVXMWxiblJ6TG1sdWRHVnlibUZzTUI0WERUSTJNRGt4T1RFdwpNVGt5T0ZvWERUTTJNRGt4TmpFd01Ua3lPRm93SURFZU1Cd0dBMVVFQXd3VllYQnBMbkJoZVcxbGJuUnpMbWx1CmRHVnlibUZzTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUF6Y0FMVFZQZWd1N1oKQXZvcnU1Sm55Yk0xNTFlVUVMMzdyNkJYZm1MWWpiSWQ3QVZGMS9NNEIwaFAzbnlSVWpybnJVUFl5S3JadmRqawpVUkNkczlwdER4bHFwN1RhQ3dJRWtiakpHaWFsYUZ6Y3NMVXNHQWdPWUNpMWhQbDdCZ3ZTU3ZDRlY3S25HbzVXCkp0c2dlajhIQWl1Vnh6alpBUjNCVW05enRyNVRwQ25kYjdCcTZtRkRYUndpRkZoV3oxZC9JZEdBUURTSVZpRWMKV3FJUUc1RDMyMU16Z3BrbThhYlREZHd1bzFHVjVMSTJNa2JaZ0pXQ2VQYmZ4cWxBRFNDQWZjVlFyeVpYNlV5bQp1VDIxNXJqWko2d1RBb29JSjFBM1d6WEZhb3FDdGUzbUFWVy9RaUdaWlBRMDFhTWNzRU5UTStCOWlINmw3b0FOCkRkYTNUa2JiclFJREFRQUJvM1V3Y3pBZEJnTlZIUTRFRmdRVTVYUlFCaWllZXdPTC9hYTlGL0ExWHdTeU5MZ3cKSHdZRFZSMGpCQmd3Rm9BVTVYUlFCaWllZXdPTC9hYTlGL0ExWHdTeU5MZ3dEd1lEVlIwVEFRSC9CQVV3QXdFQgovekFnQmdOVkhSRUVHVEFYZ2hWaGNHa3VjR0Y1YldWdWRITXVhVzUwWlhKdVlXd3dEUVlKS29aSWh2Y05BUUVMCkJRQURnZ0VCQUxtZ1dmbXU2ZCsvSDNPYXdMeG1UZ2lQczM1bXV1V0tKY0FYUVFYNzRyZDdGOVJrNjd3RHZLd3oKRDdjYXYrVU1IYlEvbzEyTk1YRU9DOTVCbW9PcmRLTHZ0T3l5M1Z6WW5TeUhKUHB6ci94b2xUUmNzUTZjWVhoQQpkam42alNkVGQxOERDOG1rSlVnK2Q5a05FbGIwR0RBdEJ3QVdZdGxlQmVNUXR1QytZdjdNaDlmNHpFZmdqMnJLCkJrUUJSa1Axd1ZjanFsUm9DcjJKTEFsTlVyTTFlakZyaHJ6OFJTTHlXbWlRZkJveTRhUlgyR1pTWmN4eTRyaE4KRHpUc1ovMnh1aTlPLzVzbDVqK2ppK3FiMGRUMDBpbmFBck4xTDBCc1VQeGxKSlZvR2hTcU43QVBSZFkyRHFpcQpoYmZxbEErSG9LM2dyMDZweVIwU1FDZkxmanptOHBVPQotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tCg==';
const FAKE_KEY = 'bm90LWEtcmVhbC1rZXk=';

export const DEMO_TLS_SECRETS: readonly KubeObject[] = [
  {
    apiVersion: 'v1',
    kind: 'Secret',
    type: 'kubernetes.io/tls',
    metadata: { name: 'platform-tls', namespace: 'platform', uid: uid(), creationTimestamp: iso(hours(24 * 30)) },
    data: { 'tls.crt': PLATFORM_CRT, 'tls.key': FAKE_KEY },
  },
  {
    apiVersion: 'v1',
    kind: 'Secret',
    type: 'kubernetes.io/tls',
    metadata: {
      name: 'payments-tls',
      namespace: 'payments',
      uid: uid(),
      creationTimestamp: iso(hours(24 * 60)),
      annotations: { 'cert-manager.io/certificate-name': 'payments-tls' },
    },
    data: { 'tls.crt': PAYMENTS_CRT, 'tls.key': FAKE_KEY },
  },
];

/**
 * cert-manager, with dates worked out when the demo starts.
 *
 * One renewing normally, and one whose issuance is failing while the
 * certificate it already has keeps working. The second is the state worth
 * seeing: everything looks fine until the day it does not, and the window to
 * fix it quietly is now.
 */
const days = (count: number) => new Date(Date.now() + count * 86_400_000).toISOString();

export const DEMO_CERT_MANAGER: readonly KubeObject[] = [
  {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    metadata: { name: 'payments-tls', namespace: 'payments', uid: uid(), creationTimestamp: iso(hours(24 * 60)) },
    spec: { secretName: 'payments-tls', dnsNames: ['api.payments.internal'], issuerRef: { name: 'letsencrypt', kind: 'ClusterIssuer' } },
    status: {
      notBefore: days(-60),
      notAfter: days(21),
      renewalTime: days(7),
      conditions: [{ type: 'Ready', status: 'True', reason: 'Ready', message: 'Certificate is up to date and has not expired' }],
    },
  },
  {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    metadata: { name: 'checkout-tls', namespace: 'payments', uid: uid(), creationTimestamp: iso(hours(24 * 4)) },
    spec: { secretName: 'checkout-tls', dnsNames: ['checkout.payments.internal'], issuerRef: { name: 'letsencrypt', kind: 'ClusterIssuer' } },
    status: {
      conditions: [
        {
          type: 'Ready',
          status: 'False',
          reason: 'Failed',
          message: 'the DNS-01 challenge for checkout.payments.internal did not propagate before the deadline',
        },
      ],
    },
  },
];

/**
 * An Ingress that serves a hostname its certificate does not cover.
 *
 * Nothing in Kubernetes objects to this: the object applies, the controller is
 * happy, and every browser refuses the connection. It is the finding a list of
 * expiry dates cannot give you, so the demo has one.
 */
export const DEMO_INGRESSES: readonly KubeObject[] = [
  {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: { name: 'grafana', namespace: 'platform', uid: uid(), creationTimestamp: iso(hours(24 * 12)) },
    spec: {
      tls: [{ secretName: 'platform-tls', hosts: ['grafana.platform.internal', 'metrics.eu.platform.internal'] }],
      rules: [{ host: 'grafana.platform.internal' }],
    },
    status: {},
  },
  {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: { name: 'api', namespace: 'payments', uid: uid(), creationTimestamp: iso(hours(24 * 20)) },
    spec: { tls: [{ secretName: 'payments-tls', hosts: ['api.payments.internal'] }], rules: [{ host: 'api.payments.internal' }] },
    status: {},
  },
];
