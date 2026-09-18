import { useState } from 'react';
import { Archive, Copy, Eye, ExternalLink } from 'lucide-react';
import { Button } from '../ui/Button.tsx';
import { copyText, copyEntry, Menu, SEPARATOR, type MenuEntry } from '../ui/ContextMenu.tsx';

/**
 * "This pod is an object store", and how to get into it.
 *
 * MinIO, RustFS, SeaweedFS, Garage, Ceph RGW, LocalStack and friends are
 * recognised by image and port. The card then answers the two questions you
 * would otherwise dig for: where is the endpoint, and where are the keys.
 * Keys are read from the container's env, a literal value is shown as is; a
 * Secret reference names the Secret and key and can be decoded on request,
 * here, once, never stored.
 */

const STORAGE_IMAGES: ReadonlyArray<[RegExp, string]> = [
  [/minio/i, 'MinIO'],
  [/rustfs/i, 'RustFS'],
  [/seaweedfs/i, 'SeaweedFS'],
  [/dxflrs\/garage|\bgarage\b/i, 'Garage'],
  [/ceph.*rgw|radosgw|\brgw\b/i, 'Ceph RGW'],
  [/localstack/i, 'LocalStack S3'],
  [/zenko|cloudserver/i, 'Zenko CloudServer'],
];

const ACCESS_KEYS = ['MINIO_ROOT_USER', 'MINIO_ACCESS_KEY', 'RUSTFS_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'ACCESS_KEY', 'S3_ACCESS_KEY'];
const SECRET_KEYS = ['MINIO_ROOT_PASSWORD', 'MINIO_SECRET_KEY', 'RUSTFS_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY', 'SECRET_KEY', 'S3_SECRET_KEY'];

interface EnvVar {
  name?: string;
  value?: string;
  valueFrom?: { secretKeyRef?: { name?: string; key?: string }; configMapKeyRef?: { name?: string; key?: string } };
}

interface ContainerShape {
  name?: string;
  image?: string;
  env?: EnvVar[];
  ports?: Array<{ name?: string; containerPort?: number }>;
}

export interface StorageDetection {
  readonly product: string;
  readonly container: string;
  readonly port: number;
  readonly consolePort?: number | undefined;
  readonly access?: EnvVar | undefined;
  readonly secret?: EnvVar | undefined;
}

export function detectObjectStorage(containers: readonly ContainerShape[] | undefined): StorageDetection | null {
  for (const container of containers ?? []) {
    const image = container.image ?? '';
    const hit = STORAGE_IMAGES.find(([pattern]) => pattern.test(image));
    const s3Port = container.ports?.find((port) => port.containerPort === 9000 || port.name === 's3' || port.name === 'api');
    if (!hit && !s3Port) continue;
    const env = container.env ?? [];
    const find = (names: string[]) => env.find((entry) => entry.name && names.includes(entry.name));
    const console = container.ports?.find((port) => port.containerPort === 9001 || port.name === 'console');
    return {
      product: hit?.[1] ?? 'S3-compatible store',
      container: container.name ?? '',
      port: s3Port?.containerPort ?? 9000,
      ...(console?.containerPort ? { consolePort: console.containerPort } : {}),
      ...(find(ACCESS_KEYS) ? { access: find(ACCESS_KEYS) } : {}),
      ...(find(SECRET_KEYS) ? { secret: find(SECRET_KEYS) } : {}),
    };
  }
  return null;
}

interface StorageCardProps {
  readonly detection: StorageDetection;
  readonly pod: string;
  readonly namespace: string;
  readonly podIP?: string | undefined;
  /** Decodes one key of a Secret in this namespace. Absent means no access. */
  readonly onRevealSecret?: ((secret: string, key: string) => Promise<string>) | undefined;
  readonly onOpenBrowser?: (() => void) | undefined;
  readonly context?: string | undefined;
}

export function StorageCard({ detection, pod, namespace, podIP, onRevealSecret, onOpenBrowser, context }: StorageCardProps) {
  /** Reads the keys (revealing from Secrets if needed) and opens the browser on a forwarded connection. */
  const openBrowser = async () => {
    const value = async (entry: EnvVar | undefined): Promise<string> => {
      if (!entry) return '';
      if (entry.value !== undefined) return entry.value;
      const ref = entry.valueFrom?.secretKeyRef;
      if (ref?.name && ref.key && onRevealSecret) return onRevealSecret(ref.name, ref.key);
      return '';
    };
    try {
      const [accessKey, secretKey] = await Promise.all([value(detection.access), value(detection.secret)]);
      window.dispatchEvent(new CustomEvent('mjolnir:open-storage', { detail: { name: `${pod} (${detection.product})`, source: { context: context ?? '', namespace, pod, port: detection.port }, accessKey, secretKey } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const endpoint = podIP ? `http://${podIP}:${detection.port}` : `http://${pod}.${namespace}:${detection.port}`;
  const forward = `kubectl -n ${namespace} port-forward pod/${pod} ${detection.port}:${detection.port}${detection.consolePort ? ` ${detection.consolePort}:${detection.consolePort}` : ''}`;

  const reveal = async (entry: EnvVar) => {
    const ref = entry.valueFrom?.secretKeyRef;
    if (!ref?.name || !ref.key || !onRevealSecret) return;
    try {
      const value = await onRevealSecret(ref.name, ref.key);
      setRevealed((current) => ({ ...current, [entry.name ?? '']: value }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const credential = (label: string, entry: EnvVar | undefined) => {
    if (!entry) return <Row label={label} value="not set in env" muted />;
    const ref = entry.valueFrom?.secretKeyRef;
    const shown = entry.value ?? revealed[entry.name ?? ''];
    if (shown !== undefined) {
      return (
        <Row
          label={label}
          value={shown}
          hint={ref ? `from Secret ${ref.name} · ${ref.key}` : `env ${entry.name ?? ''}`}
          action={
            <Button variant="ghost" onClick={() => copyText(shown, `${label} copied`)} icon={<Copy size={12} strokeWidth={1.9} />}>
              Copy
            </Button>
          }
        />
      );
    }
    if (ref) {
      return (
        <Row
          label={label}
          value={`Secret ${ref.name ?? ''} · key ${ref.key ?? ''}`}
          hint={`env ${entry.name ?? ''} reads it at start; decoded here only when you ask`}
          action={
            onRevealSecret ? (
              <Button variant="ghost" data-testid={`reveal-${label.toLowerCase().replace(/\s+/g, '-')}`} onClick={() => void reveal(entry)} icon={<Eye size={12} strokeWidth={1.9} />}>
                Reveal
              </Button>
            ) : undefined
          }
        />
      );
    }
    return <Row label={label} value={`env ${entry.name ?? ''} (from ${entry.valueFrom?.configMapKeyRef ? 'ConfigMap' : 'elsewhere'})`} muted />;
  };

  const entries: MenuEntry[] = [
    ...copyEntry('copy-endpoint', 'Copy endpoint', endpoint),
    ...copyEntry('copy-forward', 'Copy port-forward command', forward),
    SEPARATOR,
    { id: 'open', label: 'Open bucket browser', onSelect: () => void (context ? openBrowser() : onOpenBrowser?.()) },
  ];

  return (
    <Menu label={detection.product} entries={entries} testId="storage-menu">
      <div
        data-testid="storage-card"
        className="rounded-lg border border-line p-3"
        style={{ borderColor: 'color-mix(in oklab, var(--log-pod-b) 45%, transparent)', background: 'color-mix(in oklab, var(--log-pod-b) 7%, transparent)' }}
      >
        <div className="mb-2 flex items-center gap-2">
          <Archive size={14} strokeWidth={1.9} aria-hidden style={{ color: 'var(--log-pod-b)' }} />
          <span className="text-[12.5px] font-semibold text-primary">{detection.product} detected</span>
          <span className="font-mono text-[11px] text-tertiary">container {detection.container}</span>
          <div className="flex-1" />
          <Button data-testid="storage-open" onClick={() => void (context ? openBrowser() : onOpenBrowser?.())} icon={<ExternalLink size={12} strokeWidth={1.9} />}>
            Open bucket browser
          </Button>
        </div>
        <div className="space-y-1.5">
          <Row
            label="Endpoint"
            value={endpoint}
            hint={detection.consolePort ? `console on :${detection.consolePort}` : undefined}
            action={
              <Button variant="ghost" onClick={() => copyText(forward, 'Port-forward command copied')} icon={<Copy size={12} strokeWidth={1.9} />}>
                port-forward
              </Button>
            }
          />
          {credential('Access key', detection.access)}
          {credential('Secret key', detection.secret)}
        </div>
        {error ? <p className="mt-2 text-[11.5px] text-error">{error}</p> : null}
      </div>
    </Menu>
  );
}

function Row({ label, value, hint, action, muted = false }: { label: string; value: string; hint?: string | undefined; action?: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center gap-3 text-[11.5px]">
      <span className="w-[86px] shrink-0 text-secondary">{label}</span>
      <span className={`min-w-0 flex-1 truncate font-mono ${muted ? 'text-tertiary' : 'text-primary'}`} title={value}>
        {value}
        {hint ? <span className="ml-2 font-sans text-tertiary">{hint}</span> : null}
      </span>
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  );
}
