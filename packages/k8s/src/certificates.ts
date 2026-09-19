import { X509Certificate } from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * Certificates, and when they stop working.
 *
 * This is the cheapest outage in Kubernetes to prevent and the most common one
 * to have. A TLS secret somebody created by hand two years ago has no
 * controller watching it, nothing renews it, nothing warns about it, and the
 * first anyone hears is a browser error on a Sunday.
 *
 * The distinction this page exists to draw is **whether something will renew
 * it**. A cert-manager Certificate renews itself and needs no attention; a
 * hand-made secret needs a person, and knowing which is which is the entire
 * difference between a list of dates and a warning.
 *
 * Three sources, because certificates hide in three places:
 *
 * - **TLS secrets**, which is where most of them are.
 * - **cert-manager Certificates**, which say what they intend and when they
 *   will renew, and can be failing to do it.
 * - **Webhook and API service CA bundles**, which are the ones nobody looks
 *   at. An expired admission webhook CA does not break a website, it breaks
 *   the cluster: every create is rejected by a webhook nobody can reach.
 *
 * Reading a TLS secret means the private key passes through this process.
 * Nothing here parses, stores, logs or returns it. A certificate is public by
 * construction; the key beside it is not, and the only correct thing to do
 * with it is ignore it.
 */

/** Under a week is somebody's weekend. Under thirty days is a renewal to plan. */
export const CRITICAL_DAYS = 7;
export const SOON_DAYS = 30;

export type CertificateState = 'expired' | 'critical' | 'soon' | 'ok' | 'not-yet-valid';

export interface CertificateUse {
  readonly kind: string;
  readonly name: string;
  readonly namespace?: string | undefined;
  /** The hostnames this user needs the certificate to cover. */
  readonly hosts?: readonly string[] | undefined;
}

export interface CertificateSummary {
  readonly id: string;
  readonly source: 'secret' | 'cert-manager' | 'webhook' | 'api-service';
  readonly name: string;
  readonly namespace?: string | undefined;
  /** The common name, or the first host when there is no useful CN. */
  readonly subject: string;
  readonly issuer: string;
  readonly hosts: readonly string[];
  readonly notBefore: string;
  readonly notAfter: string;
  /** Negative once it has expired. Whole days, rounded down. */
  readonly daysLeft: number;
  readonly state: CertificateState;
  readonly selfSigned: boolean;
  /** True when a controller renews this without anyone doing anything. */
  readonly managed: boolean;
  /** cert-manager's issuer, when there is one. */
  readonly issuerRef?: string | undefined;
  /** cert-manager's own plan for renewing it. */
  readonly renewAt?: string | undefined;
  readonly serial: string;
  /** "RSA 2048" or "EC P-256", for the one question a reviewer always asks. */
  readonly keyType: string;
  readonly chainLength: number;
  readonly usedBy: readonly CertificateUse[];
  /** What this means, in a sentence. */
  readonly detail: string;
  readonly fix?: string | undefined;
  /** Problems that are not about the date at all. */
  readonly problems: readonly CertificateProblem[];
}

export interface CertificateProblem {
  readonly kind: 'host-not-covered' | 'chain-incomplete' | 'not-yet-valid' | 'unreadable' | 'renewal-failing' | 'expires-before-renewal';
  readonly detail: string;
  readonly severity: 'critical' | 'warning' | 'info';
}

export interface CertificateReport {
  readonly certificates: readonly CertificateSummary[];
  readonly counts: { expired: number; critical: number; soon: number; ok: number };
  /** One sentence for the top of the page. */
  readonly summary: string;
  /** The nearest expiry that nothing will renew. The number that matters. */
  readonly nextUnmanaged?: { name: string; namespace?: string | undefined; daysLeft: number } | undefined;
}

// ---------------------------------------------------------------------------

export interface TlsSecret {
  readonly metadata?: { name?: string; namespace?: string; annotations?: Record<string, string>; labels?: Record<string, string> };
  readonly type?: string;
  readonly data?: Record<string, string>;
}

export interface CertManagerCertificate {
  readonly metadata?: { name?: string; namespace?: string };
  readonly spec?: {
    readonly secretName?: string;
    readonly dnsNames?: readonly string[];
    readonly issuerRef?: { name?: string; kind?: string };
  };
  readonly status?: {
    readonly notAfter?: string;
    readonly notBefore?: string;
    readonly renewalTime?: string;
    readonly conditions?: ReadonlyArray<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
}

export interface IngressObject {
  readonly metadata?: { name?: string; namespace?: string };
  readonly spec?: {
    readonly tls?: ReadonlyArray<{ secretName?: string; hosts?: readonly string[] }>;
    readonly rules?: ReadonlyArray<{ host?: string }>;
  };
}

export interface CaBundleHolder {
  readonly metadata?: { name?: string };
  /** Webhook configurations carry one bundle per webhook. */
  readonly webhooks?: ReadonlyArray<{ name?: string; clientConfig?: { caBundle?: string } }>;
  /** API services carry one. */
  readonly spec?: { caBundle?: string; service?: { name?: string; namespace?: string } };
}

export interface CertificateInput {
  readonly now?: number;
  readonly secrets?: readonly TlsSecret[];
  readonly certificates?: readonly CertManagerCertificate[];
  readonly ingresses?: readonly IngressObject[];
  readonly webhooks?: readonly CaBundleHolder[];
  readonly apiServices?: readonly CaBundleHolder[];
}

const DAY = 86_400_000;

export function inspectCertificates(input: CertificateInput): CertificateReport {
  const now = input.now ?? Date.now();
  const summaries: CertificateSummary[] = [];

  // Who needs which secret, and for what hostnames. Built first so each
  // certificate can be checked against what actually depends on it.
  const uses = new Map<string, CertificateUse[]>();
  for (const ingress of input.ingresses ?? []) {
    const namespace = ingress.metadata?.namespace;
    const ruleHosts = (ingress.spec?.rules ?? []).map((rule) => rule.host).filter((host): host is string => Boolean(host));
    for (const tls of ingress.spec?.tls ?? []) {
      if (!tls.secretName) continue;
      const key = `${namespace}/${tls.secretName}`;
      const hosts = tls.hosts && tls.hosts.length > 0 ? tls.hosts : ruleHosts;
      uses.set(key, [
        ...(uses.get(key) ?? []),
        { kind: 'Ingress', name: ingress.metadata?.name ?? 'unknown', namespace, hosts },
      ]);
    }
  }

  // cert-manager, by the secret it writes, so a secret can say who renews it.
  const managed = new Map<string, CertManagerCertificate>();
  for (const certificate of input.certificates ?? []) {
    const secretName = certificate.spec?.secretName;
    if (secretName) managed.set(`${certificate.metadata?.namespace}/${secretName}`, certificate);
  }

  for (const secret of input.secrets ?? []) {
    const pem = decode(secret.data?.['tls.crt']);
    const key = `${secret.metadata?.namespace}/${secret.metadata?.name}`;
    const summary = summarise({
      pem,
      id: `secret:${key}`,
      source: 'secret',
      name: secret.metadata?.name ?? 'unknown',
      namespace: secret.metadata?.namespace,
      usedBy: uses.get(key) ?? [],
      certificate: managed.get(key),
      now,
    });
    if (summary) summaries.push(summary);
  }

  /*
   * cert-manager Certificates with no readable secret of their own.
   *
   * A Certificate whose secret does not exist is the interesting case: it
   * means issuance is failing, which is invisible if you only list secrets.
   */
  for (const certificate of input.certificates ?? []) {
    const secretName = certificate.spec?.secretName ?? '';
    const hasSecret = (input.secrets ?? []).some(
      (secret) => secret.metadata?.name === secretName && secret.metadata?.namespace === certificate.metadata?.namespace,
    );
    if (hasSecret) continue;
    summaries.push(fromCertManagerAlone(certificate, now));
  }

  for (const holder of input.webhooks ?? []) {
    for (const webhook of holder.webhooks ?? []) {
      const pem = decode(webhook.clientConfig?.caBundle);
      const summary = summarise({
        pem,
        id: `webhook:${holder.metadata?.name}/${webhook.name}`,
        source: 'webhook',
        name: webhook.name ?? holder.metadata?.name ?? 'unknown',
        usedBy: [{ kind: 'WebhookConfiguration', name: holder.metadata?.name ?? 'unknown' }],
        now,
      });
      if (summary) summaries.push(summary);
    }
  }

  for (const service of input.apiServices ?? []) {
    const pem = decode(service.spec?.caBundle);
    const summary = summarise({
      pem,
      id: `apiservice:${service.metadata?.name}`,
      source: 'api-service',
      name: service.metadata?.name ?? 'unknown',
      usedBy: service.spec?.service?.name
        ? [{ kind: 'Service', name: service.spec.service.name, namespace: service.spec.service.namespace }]
        : [],
      now,
    });
    if (summary) summaries.push(summary);
  }

  // Soonest first, and an expired certificate is not "very soon", it is worse
  // than anything still working.
  const sorted = [...summaries].sort((a, b) => a.daysLeft - b.daysLeft);
  const counts = {
    expired: sorted.filter((entry) => entry.state === 'expired').length,
    critical: sorted.filter((entry) => entry.state === 'critical').length,
    soon: sorted.filter((entry) => entry.state === 'soon').length,
    ok: sorted.filter((entry) => entry.state === 'ok' || entry.state === 'not-yet-valid').length,
  };

  const nextUnmanaged = sorted.find((entry) => !entry.managed && entry.daysLeft >= 0);

  return {
    certificates: sorted,
    counts,
    summary: describe(sorted, counts, nextUnmanaged),
    ...(nextUnmanaged
      ? { nextUnmanaged: { name: nextUnmanaged.name, namespace: nextUnmanaged.namespace, daysLeft: nextUnmanaged.daysLeft } }
      : {}),
  };
}

/**
 * The headline.
 *
 * It leads on what nothing will renew, because a cert-manager certificate
 * twelve days from expiry is not news and a hand-made one twelve days from
 * expiry is the whole point of the page.
 */
function describe(
  certificates: readonly CertificateSummary[],
  counts: CertificateReport['counts'],
  nextUnmanaged: CertificateSummary | undefined,
): string {
  const expired = certificates.filter((entry) => entry.state === 'expired');
  if (expired.length > 0) {
    const first = expired[0]!;
    return expired.length === 1
      ? `${first.name} expired ${Math.abs(first.daysLeft)} day${Math.abs(first.daysLeft) === 1 ? '' : 's'} ago.`
      : `${expired.length} certificates have expired, the oldest ${Math.abs(first.daysLeft)} days ago.`;
  }
  if (nextUnmanaged && nextUnmanaged.daysLeft <= SOON_DAYS) {
    return `${nextUnmanaged.name} expires in ${nextUnmanaged.daysLeft} day${nextUnmanaged.daysLeft === 1 ? '' : 's'} and nothing is set up to renew it.`;
  }
  if (counts.critical > 0) {
    const first = certificates.find((entry) => entry.state === 'critical')!;
    return `${first.name} expires in ${first.daysLeft} day${first.daysLeft === 1 ? '' : 's'}.`;
  }
  const problems = certificates.filter((entry) => entry.problems.some((problem) => problem.severity === 'critical'));
  if (problems.length > 0) return `${problems[0]!.name}: ${problems[0]!.problems[0]!.detail}`;
  if (certificates.length === 0) return 'No certificates found in this cluster.';
  if (nextUnmanaged) {
    return `Nothing expires soon. The next one nobody renews automatically is ${nextUnmanaged.name}, in ${nextUnmanaged.daysLeft} days.`;
  }
  return 'Nothing expires soon, and everything here renews itself.';
}

interface SummariseInput {
  readonly pem: string;
  readonly id: string;
  readonly source: CertificateSummary['source'];
  readonly name: string;
  readonly namespace?: string | undefined;
  readonly usedBy: readonly CertificateUse[];
  readonly certificate?: CertManagerCertificate | undefined;
  readonly now: number;
}

function summarise(input: SummariseInput): CertificateSummary | null {
  if (!input.pem.includes('BEGIN CERTIFICATE')) return null;
  const chain = parseChain(input.pem);
  const leaf = chain[0];
  if (!leaf) {
    return {
      id: input.id,
      source: input.source,
      name: input.name,
      namespace: input.namespace,
      subject: input.name,
      issuer: 'unknown',
      hosts: [],
      notBefore: '',
      notAfter: '',
      daysLeft: 0,
      state: 'ok',
      selfSigned: false,
      managed: false,
      serial: '',
      keyType: 'unknown',
      chainLength: 0,
      usedBy: input.usedBy,
      detail: 'This looks like a certificate but could not be read.',
      problems: [{ kind: 'unreadable', detail: 'The PEM data did not parse as an X.509 certificate.', severity: 'warning' }],
    };
  }

  const notBefore = validFrom(leaf);
  const notAfter = validTo(leaf);
  const daysLeft = Math.floor((notAfter.getTime() - input.now) / DAY);
  const selfSigned = leaf.subject === leaf.issuer;
  const managed = Boolean(input.certificate);
  const hosts = hostsOf(leaf);
  const problems: CertificateProblem[] = [];

  if (notBefore.getTime() > input.now) {
    problems.push({
      kind: 'not-yet-valid',
      severity: 'critical',
      detail: `It is not valid until ${notBefore.toISOString()}. Either it was issued for the future, or a clock somewhere is wrong.`,
    });
  }

  /*
   * A host the certificate does not cover.
   *
   * An Ingress can name a hostname its certificate says nothing about, and
   * nothing in Kubernetes objects to it: the object applies, the controller is
   * happy, and every browser refuses the connection. `checkHost` applies the
   * real rules, including the one where a wildcard covers exactly one label
   * and only the leftmost.
   */
  for (const use of input.usedBy) {
    for (const host of use.hosts ?? []) {
      if (!leaf.checkHost(host)) {
        problems.push({
          kind: 'host-not-covered',
          severity: 'critical',
          detail: `${use.kind} ${use.name} serves ${host}, which this certificate does not cover. It covers ${hosts.join(', ') || 'nothing this could match'}.`,
        });
      }
    }
  }

  // A leaf whose issuer is not in the bundle and is not itself. Fine when the
  // issuer is a public CA the client already trusts, a broken chain when it is
  // an internal one, and only the person looking can tell which.
  if (!selfSigned && chain.length === 1 && input.source === 'secret') {
    problems.push({
      kind: 'chain-incomplete',
      severity: 'info',
      detail: `The secret holds only the leaf certificate, with nothing from ${issuerName(leaf)}. Clients that do not already trust that issuer will reject it.`,
    });
  }

  const renewAt = input.certificate?.status?.renewalTime;
  if (renewAt && Date.parse(renewAt) > notAfter.getTime()) {
    problems.push({
      kind: 'expires-before-renewal',
      severity: 'critical',
      detail: `cert-manager plans to renew this at ${renewAt}, which is after it expires. It will lapse before anything acts.`,
    });
  }

  const failing = input.certificate?.status?.conditions?.find((condition) => condition.type === 'Ready' && condition.status !== 'True');
  if (failing) {
    problems.push({
      kind: 'renewal-failing',
      severity: 'critical',
      detail: `cert-manager cannot issue this: ${failing.message ?? failing.reason ?? 'no reason given'}. The current certificate keeps working until it expires, and then it does not.`,
    });
  }

  return {
    id: input.id,
    source: managed ? 'cert-manager' : input.source,
    name: input.name,
    namespace: input.namespace,
    subject: commonName(leaf.subject) ?? hosts[0] ?? input.name,
    issuer: issuerName(leaf),
    hosts,
    notBefore: notBefore.toISOString(),
    notAfter: notAfter.toISOString(),
    daysLeft,
    state: stateOf(daysLeft, notBefore.getTime() > input.now),
    selfSigned,
    managed,
    ...(input.certificate?.spec?.issuerRef?.name
      ? { issuerRef: `${input.certificate.spec.issuerRef.kind ?? 'Issuer'}/${input.certificate.spec.issuerRef.name}` }
      : {}),
    ...(renewAt ? { renewAt } : {}),
    serial: leaf.serialNumber,
    keyType: keyTypeOf(leaf),
    chainLength: chain.length,
    usedBy: input.usedBy,
    detail: explain({ daysLeft, managed, selfSigned, source: input.source, renewAt, usedBy: input.usedBy }),
    ...(fixFor({ daysLeft, managed, selfSigned, source: input.source }) ? { fix: fixFor({ daysLeft, managed, selfSigned, source: input.source }) } : {}),
    problems,
  };
}

/** A cert-manager Certificate whose secret is not there: issuance is failing. */
function fromCertManagerAlone(certificate: CertManagerCertificate, now: number): CertificateSummary {
  const ready = certificate.status?.conditions?.find((condition) => condition.type === 'Ready');
  const notAfter = certificate.status?.notAfter ?? '';
  const daysLeft = notAfter ? Math.floor((Date.parse(notAfter) - now) / DAY) : -1;
  return {
    id: `certmanager:${certificate.metadata?.namespace}/${certificate.metadata?.name}`,
    source: 'cert-manager',
    name: certificate.metadata?.name ?? 'unknown',
    namespace: certificate.metadata?.namespace,
    subject: certificate.spec?.dnsNames?.[0] ?? certificate.metadata?.name ?? 'unknown',
    issuer: certificate.spec?.issuerRef?.name ?? 'unknown',
    hosts: certificate.spec?.dnsNames ?? [],
    notBefore: certificate.status?.notBefore ?? '',
    notAfter,
    daysLeft,
    state: notAfter ? stateOf(daysLeft, false) : 'expired',
    selfSigned: false,
    managed: true,
    ...(certificate.spec?.issuerRef?.name
      ? { issuerRef: `${certificate.spec.issuerRef.kind ?? 'Issuer'}/${certificate.spec.issuerRef.name}` }
      : {}),
    ...(certificate.status?.renewalTime ? { renewAt: certificate.status.renewalTime } : {}),
    serial: '',
    keyType: 'unknown',
    chainLength: 0,
    usedBy: [],
    detail:
      'cert-manager has a Certificate for this but there is no secret behind it, so nothing is serving it. Issuance has not succeeded.',
    fix: `kubectl describe certificate ${certificate.metadata?.name ?? ''} -n ${certificate.metadata?.namespace ?? 'default'}`,
    problems: [
      {
        kind: 'renewal-failing',
        severity: 'critical',
        detail: ready?.message ?? ready?.reason ?? 'The Certificate has no secret and no reason recorded.',
      },
    ],
  };
}

function stateOf(daysLeft: number, notYetValid: boolean): CertificateState {
  if (notYetValid) return 'not-yet-valid';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= CRITICAL_DAYS) return 'critical';
  if (daysLeft <= SOON_DAYS) return 'soon';
  return 'ok';
}

function explain(input: {
  daysLeft: number;
  managed: boolean;
  selfSigned: boolean;
  source: CertificateSummary['source'];
  renewAt?: string | undefined;
  usedBy: readonly CertificateUse[];
}): string {
  const serving = input.usedBy.length > 0 ? ` It is served by ${input.usedBy.map((use) => `${use.kind} ${use.name}`).join(', ')}.` : '';

  if (input.daysLeft < 0) {
    const ago = Math.abs(input.daysLeft);
    const what =
      input.source === 'webhook'
        ? 'Every request this webhook intercepts is now failing, which for a validating webhook means creates and updates are being rejected across the cluster.'
        : input.source === 'api-service'
          ? 'The aggregated API behind this is unreachable, so anything that queries it is failing.'
          : 'Anything connecting over TLS with this is being refused.';
    return `It expired ${ago} day${ago === 1 ? '' : 's'} ago. ${what}${serving}`;
  }

  const when = `It expires in ${input.daysLeft} day${input.daysLeft === 1 ? '' : 's'}.`;
  if (input.managed) {
    return `${when} cert-manager renews it${input.renewAt ? ` and plans to on ${input.renewAt.slice(0, 10)}` : ''}, so this needs nothing from you unless issuance starts failing.${serving}`;
  }
  if (input.source === 'webhook' || input.source === 'api-service') {
    return `${when} This is a cluster CA bundle: when it lapses the component behind it stops answering, and the symptom is requests being rejected rather than a website breaking.${serving}`;
  }
  return `${when} Nothing is set up to renew it, so it will lapse unless somebody replaces it.${input.selfSigned ? ' It is self-signed, so whatever trusts it was told to by hand.' : ''}${serving}`;
}

function fixFor(input: { daysLeft: number; managed: boolean; selfSigned: boolean; source: CertificateSummary['source'] }): string | undefined {
  if (input.managed) return undefined;
  if (input.daysLeft > SOON_DAYS) return undefined;
  if (input.source === 'webhook' || input.source === 'api-service') {
    return 'Whatever installed this component reissues its CA. Reinstalling or upgrading the chart is usually the intended path; check whether it ships cert-manager support first.';
  }
  return 'Issue a replacement and update the secret, or hand it to cert-manager so this stops being a date somebody has to remember.';
}

// ---------------------------------------------------------------------------

/** Base64 from a secret or a caBundle, to PEM text. Empty when there is none. */
function decode(value: string | undefined): string {
  if (!value) return '';
  try {
    const text = Buffer.from(value, 'base64').toString('utf8');
    return text.includes('BEGIN CERTIFICATE') ? text : '';
  } catch {
    return '';
  }
}

/** Every certificate in a bundle, leaf first as convention requires. */
export function parseChain(pem: string): X509Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  const chain: X509Certificate[] = [];
  for (const block of blocks) {
    try {
      chain.push(new X509Certificate(block));
    } catch {
      // A bundle with one unreadable entry still tells us about the others,
      // and the leaf is the one that matters.
    }
  }
  return chain;
}

function validFrom(certificate: X509Certificate): Date {
  const typed = (certificate as unknown as { validFromDate?: Date }).validFromDate;
  return typed instanceof Date ? typed : new Date(certificate.validFrom);
}

function validTo(certificate: X509Certificate): Date {
  const typed = (certificate as unknown as { validToDate?: Date }).validToDate;
  return typed instanceof Date ? typed : new Date(certificate.validTo);
}

/** The DNS names it covers, from the SAN extension. */
export function hostsOf(certificate: X509Certificate): string[] {
  const san = certificate.subjectAltName ?? '';
  return san
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('DNS:'))
    .map((entry) => entry.slice(4));
}

export function commonName(distinguished: string): string | undefined {
  // Node gives a multi-line DN on newer versions and a slash-separated one on
  // older, so both spellings are matched.
  return /(?:^|[\n/,])CN=([^\n/,]+)/.exec(distinguished)?.[1]?.trim();
}

function issuerName(certificate: X509Certificate): string {
  return commonName(certificate.issuer) ?? certificate.issuer.split('\n')[0] ?? 'unknown';
}

/** "RSA 2048" or "EC P-256", the one question a security review always asks. */
function keyTypeOf(certificate: X509Certificate): string {
  try {
    const key = certificate.publicKey;
    const details = key.asymmetricKeyDetails ?? {};
    if (key.asymmetricKeyType === 'rsa') return `RSA ${details.modulusLength ?? '?'}`;
    if (key.asymmetricKeyType === 'ec') return `EC ${details.namedCurve ?? '?'}`;
    return key.asymmetricKeyType ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
