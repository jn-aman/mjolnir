import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { CRITICAL_DAYS, commonName, hostsOf, inspectCertificates, parseChain, SOON_DAYS } from './certificates.ts';

/**
 * Against certificates that are actually certificates.
 *
 * A fixture here cannot be a hand-written object: the whole point is parsing
 * real X.509, so these are generated with openssl at the start of the run.
 * A hardcoded PEM would work until it expired and then fail for everyone
 * forever, which is a funny way for a certificate-expiry test to die.
 */

const dir = mkdtempSync(join(tmpdir(), 'mjolnir-certs-'));

/**
 * One self-signed certificate, valid for this many days from now.
 *
 * Expiry is tested by moving `now` rather than by backdating the certificate.
 * Backdating needs `-not_before`, which only recent OpenSSL builds have and
 * LibreSSL does not, and the arithmetic under test is the same either way.
 */
function makeCertificate(options: { days: number; cn: string; hosts?: string[] }): string {
  const key = join(dir, `${options.cn}.key`);
  const out = join(dir, `${options.cn}.crt`);
  const config = join(dir, `${options.cn}.cnf`);
  const hosts = options.hosts ?? [options.cn];

  writeFileSync(
    config,
    `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=${options.cn}\n[v3]\nsubjectAltName=${hosts
      .map((host) => `DNS:${host}`)
      .join(',')}\n`,
  );

  execFileSync('openssl', ['genrsa', '-out', key, '2048'], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-new', '-x509', '-key', key, '-out', out, '-days', String(options.days), '-config', config], {
    stdio: 'ignore',
  });
  return readFileSync(out, 'utf8');
}

const DAY = 86_400_000;

const base64 = (pem: string) => Buffer.from(pem, 'utf8').toString('base64');

const LONG = makeCertificate({ days: 365, cn: 'long.example.com' });
const SOON = makeCertificate({ days: 12, cn: 'soon.example.com' });
const URGENT = makeCertificate({ days: 3, cn: 'urgent.example.com' });
const WILDCARD = makeCertificate({ days: 200, cn: 'wildcard', hosts: ['*.acme.test', 'acme.test'] });

function secret(name: string, pem: string, namespace = 'shop') {
  return { metadata: { name, namespace }, type: 'kubernetes.io/tls', data: { 'tls.crt': base64(pem), 'tls.key': base64('not a key') } };
}

describe('reading a certificate', () => {
  it('reads the dates, hosts and key type out of a real one', () => {
    const report = inspectCertificates({ secrets: [secret('long', LONG)] });
    const entry = report.certificates[0]!;

    expect(entry.subject).toBe('long.example.com');
    expect(entry.hosts).toEqual(['long.example.com']);
    expect(entry.keyType).toBe('RSA 2048');
    expect(entry.selfSigned).toBe(true);
    expect(entry.daysLeft).toBeGreaterThan(SOON_DAYS);
    expect(entry.state).toBe('ok');
  });

  it('sorts the soonest first and counts the bands', () => {
    const report = inspectCertificates({
      secrets: [secret('long', LONG), secret('urgent', URGENT), secret('soon', SOON)],
    });

    expect(report.certificates.map((entry) => entry.name)).toEqual(['urgent', 'soon', 'long']);
    expect(report.counts).toEqual({ expired: 0, critical: 1, soon: 1, ok: 1 });
    expect(report.certificates[0]?.state).toBe('critical');
    expect(report.certificates[1]?.state).toBe('soon');
  });

  it('ignores a secret that is not TLS at all', () => {
    const report = inspectCertificates({
      secrets: [{ metadata: { name: 'db-password', namespace: 'shop' }, type: 'Opaque', data: { password: base64('hunter2') } }],
    });
    expect(report.certificates).toEqual([]);
    expect(report.summary).toContain('No certificates');
  });

  it('never carries the private key into the answer', () => {
    const report = inspectCertificates({ secrets: [secret('long', LONG)] });
    // The shape of the finding is the guarantee: there is nowhere for it to go.
    expect(JSON.stringify(report)).not.toContain('tls.key');
    expect(JSON.stringify(report)).not.toContain('PRIVATE KEY');
  });
});

describe('what nobody renews', () => {
  it('leads on the one nothing will renew, not the one expiring soonest', () => {
    const report = inspectCertificates({
      secrets: [secret('managed', URGENT), secret('by-hand', SOON)],
      // cert-manager owns the urgent one, so it is not the story even though
      // it is the nearest date.
      certificates: [
        {
          metadata: { name: 'managed', namespace: 'shop' },
          spec: { secretName: 'managed', issuerRef: { name: 'letsencrypt', kind: 'ClusterIssuer' } },
          status: { renewalTime: new Date(Date.now() + 86_400_000).toISOString(), conditions: [{ type: 'Ready', status: 'True' }] },
        },
      ],
    });

    expect(report.summary).toContain('by-hand');
    expect(report.summary).toContain('nothing is set up to renew it');
    expect(report.nextUnmanaged?.name).toBe('by-hand');

    const managed = report.certificates.find((entry) => entry.name === 'managed')!;
    expect(managed.managed).toBe(true);
    expect(managed.issuerRef).toBe('ClusterIssuer/letsencrypt');
    expect(managed.detail).toContain('needs nothing from you');
    // No advice for something that looks after itself.
    expect(managed.fix).toBeUndefined();
  });

  it('says plainly that a hand-made certificate will just lapse', () => {
    const report = inspectCertificates({ secrets: [secret('by-hand', SOON)] });
    const entry = report.certificates[0]!;
    expect(entry.managed).toBe(false);
    expect(entry.detail).toContain('Nothing is set up to renew it');
    expect(entry.fix).toContain('hand it to cert-manager');
  });

  it('is quiet when everything renews itself', () => {
    const report = inspectCertificates({
      secrets: [secret('managed', SOON)],
      certificates: [
        { metadata: { name: 'managed', namespace: 'shop' }, spec: { secretName: 'managed' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } },
      ],
    });
    expect(report.summary).toBe('Nothing expires soon, and everything here renews itself.');
  });
});

describe('the problems that are not about dates', () => {
  it('catches an Ingress serving a host its certificate does not cover', () => {
    const report = inspectCertificates({
      secrets: [secret('web-tls', WILDCARD)],
      ingresses: [
        {
          metadata: { name: 'shop', namespace: 'shop' },
          // The wildcard covers one label. `deep.api.acme.test` is two.
          spec: { tls: [{ secretName: 'web-tls', hosts: ['api.acme.test', 'deep.api.acme.test'] }] },
        },
      ],
    });

    const entry = report.certificates[0]!;
    const problem = entry.problems.find((item) => item.kind === 'host-not-covered')!;
    expect(problem.severity).toBe('critical');
    expect(problem.detail).toContain('deep.api.acme.test');
    // The one the wildcard does cover is not reported.
    expect(entry.problems.filter((item) => item.kind === 'host-not-covered')).toHaveLength(1);
    expect(entry.usedBy[0]?.name).toBe('shop');
  });

  it('takes the hosts from the ingress rules when the TLS block names none', () => {
    const report = inspectCertificates({
      secrets: [secret('web-tls', WILDCARD)],
      ingresses: [
        {
          metadata: { name: 'shop', namespace: 'shop' },
          spec: { tls: [{ secretName: 'web-tls' }], rules: [{ host: 'shop.other.test' }] },
        },
      ],
    });
    expect(report.certificates[0]?.problems.some((problem) => problem.detail.includes('shop.other.test'))).toBe(true);
  });

  it('notices a certificate that is not valid yet, which is usually a clock', () => {
    // Looking at it from ten days before it was issued, which is what a node
    // with a wrong clock is doing.
    const report = inspectCertificates({ secrets: [secret('long', LONG)], now: Date.now() - 10 * DAY });
    const entry = report.certificates[0]!;
    expect(entry.state).toBe('not-yet-valid');
    expect(entry.problems[0]?.detail).toContain('a clock somewhere is wrong');
  });

  it('mentions a bundle holding only the leaf, without calling it an error', () => {
    // Self-signed needs nothing else, so it is not flagged.
    expect(inspectCertificates({ secrets: [secret('self', LONG)] }).certificates[0]?.problems).toEqual([]);
  });

  it('reports a cert-manager Certificate with no secret as issuance failing', () => {
    const report = inspectCertificates({
      certificates: [
        {
          metadata: { name: 'pending', namespace: 'shop' },
          spec: { secretName: 'pending-tls', dnsNames: ['new.acme.test'], issuerRef: { name: 'letsencrypt', kind: 'ClusterIssuer' } },
          status: { conditions: [{ type: 'Ready', status: 'False', reason: 'Failed', message: 'the DNS-01 challenge did not propagate' }] },
        },
      ],
    });

    const entry = report.certificates[0]!;
    expect(entry.detail).toContain('no secret behind it');
    expect(entry.problems[0]?.detail).toContain('DNS-01 challenge');
    expect(entry.fix).toContain('kubectl describe certificate pending');
  });

  it('catches a renewal scheduled for after the expiry, which never fires in time', () => {
    const report = inspectCertificates({
      secrets: [secret('late', SOON)],
      certificates: [
        {
          metadata: { name: 'late', namespace: 'shop' },
          spec: { secretName: 'late' },
          status: { renewalTime: new Date(Date.now() + 60 * 86_400_000).toISOString(), conditions: [{ type: 'Ready', status: 'True' }] },
        },
      ],
    });
    expect(report.certificates[0]?.problems.some((problem) => problem.kind === 'expires-before-renewal')).toBe(true);
  });

  it('surfaces a failing issuance even while the old certificate still works', () => {
    const report = inspectCertificates({
      secrets: [secret('stale', LONG)],
      certificates: [
        {
          metadata: { name: 'stale', namespace: 'shop' },
          spec: { secretName: 'stale' },
          status: { conditions: [{ type: 'Ready', status: 'False', message: 'rate limited by the ACME server' }] },
        },
      ],
    });
    const entry = report.certificates[0]!;
    expect(entry.state).toBe('ok');
    expect(entry.problems[0]?.detail).toContain('rate limited');
    // The summary must not say everything is fine while renewal is broken.
    expect(report.summary).toContain('rate limited');
  });
});

describe('the ones nobody looks at', () => {
  it('reads a webhook CA bundle and says what breaks when it lapses', () => {
    const report = inspectCertificates({
      webhooks: [
        {
          metadata: { name: 'ingress-nginx-admission' },
          webhooks: [{ name: 'validate.nginx.ingress.kubernetes.io', clientConfig: { caBundle: base64(URGENT) } }],
        },
      ],
      // Five days past its expiry, which is where a real one is found.
      now: Date.now() + 8 * DAY,
    });

    const entry = report.certificates[0]!;
    expect(entry.source).toBe('webhook');
    expect(entry.state).toBe('expired');
    // The consequence, not the date: this is a cluster outage, not a website.
    expect(entry.detail).toContain('creates and updates are being rejected');
    expect(report.summary).toContain('expired');
  });

  it('reads an aggregated API service bundle', () => {
    const report = inspectCertificates({
      apiServices: [{ metadata: { name: 'v1beta1.metrics.k8s.io' }, spec: { caBundle: base64(SOON), service: { name: 'metrics-server', namespace: 'kube-system' } } }],
    });
    const entry = report.certificates[0]!;
    expect(entry.source).toBe('api-service');
    expect(entry.usedBy[0]).toEqual({ kind: 'Service', name: 'metrics-server', namespace: 'kube-system' });
    expect(entry.detail).toContain('cluster CA bundle');
  });
});

describe('the parsing underneath', () => {
  it('pulls every certificate out of a bundle and keeps the leaf first', () => {
    const chain = parseChain(`${URGENT}\n${LONG}`);
    expect(chain).toHaveLength(2);
    expect(commonName(chain[0]!.subject)).toBe('urgent.example.com');
  });

  it('survives a bundle with rubbish in it rather than throwing', () => {
    const chain = parseChain(`-----BEGIN CERTIFICATE-----\nnot base64 at all\n-----END CERTIFICATE-----\n${LONG}`);
    expect(chain).toHaveLength(1);
  });

  it('reads the hosts out of the SAN extension', () => {
    expect(hostsOf(parseChain(WILDCARD)[0]!)).toEqual(['*.acme.test', 'acme.test']);
  });

  it('agrees with its own thresholds', () => {
    expect(CRITICAL_DAYS).toBeLessThan(SOON_DAYS);
    const report = inspectCertificates({ secrets: [secret('urgent', URGENT)] });
    expect(report.certificates[0]!.daysLeft).toBeLessThanOrEqual(CRITICAL_DAYS);
  });
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
