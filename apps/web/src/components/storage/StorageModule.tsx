import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ChevronRight, Download, ExternalLink, Eye, Folder, FolderPlus, Link2, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api, type StorageConnection, type StorageObject } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/time.ts';
import { ResourceList, type BulkAction } from '../ResourceList.tsx';
import type { KubeItem } from '../columns.tsx';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import { Select } from '../ui/Select.tsx';
import { Switch } from '../ui/Switch.tsx';
import { Card } from '../ui/Card.tsx';
import { ConfirmDialog, Modal } from '../ui/Modal.tsx';
import { copyEntry, copyText, SEPARATOR, type MenuEntry } from '../ui/ContextMenu.tsx';
import { ToolPanel } from '../ToolPanel.tsx';
import { FileViewer } from './FileViewer.tsx';
import type { ToolDefinition } from '../../lib/tools.ts';
import { bucketName, url as urlRule } from '../../lib/validate.ts';
import { useSticky } from '../../lib/sticky.ts';
import { useFlags } from '../../lib/flags.tsx';

/**
 * Buckets as folders.
 *
 * A connection is an S3 endpoint and keys, or a pod the app port-forwards
 * to on demand. Prefixes are folders, objects are rows, preview shows text
 * and images in place, and every object has its menu: download, presign,
 * copy the key, delete.
 */
export type StorageSection = 'stores' | 'connections' | 'buckets' | 'transfers' | 'presigned-links';

interface StorageModuleProps {
  readonly tool: ToolDefinition;
  readonly section: StorageSection;
  /** A connection to select on arrival, e.g. one just created from a pod. */
  readonly focusConnection?: string | undefined;
}

export function StorageModule({ tool, section, focusConnection }: StorageModuleProps) {
  const [connections, setConnections] = useState<StorageConnection[]>([]);
  const [connectionId, setConnectionId] = useSticky<string>('storage.connection', () => {
    try {
      return localStorage.getItem('mjolnir.storage.connection') ?? '';
    } catch {
      return '';
    }
  });
  const refreshConnections = useCallback(async () => {
    const list = (await api.storage.connections()).connections;
    setConnections(list);
    setConnectionId((current) => (list.some((c) => c.id === current) ? current : (list[0]?.id ?? '')));
  }, []);
  useEffect(() => {
    void refreshConnections();
  }, [refreshConnections]);
  useEffect(() => {
    if (focusConnection) setConnectionId(focusConnection);
  }, [focusConnection]);
  useEffect(() => {
    try {
      if (connectionId) localStorage.setItem('mjolnir.storage.connection', connectionId);
    } catch {
      // fine
    }
  }, [connectionId]);

  if (section === 'transfers' || section === 'presigned-links') return <ToolPanel tool={tool} section={section === 'transfers' ? 'Transfers' : 'Presigned links'} />;
  if (section === 'stores' || section === 'connections') return <Connections connections={connections} onChanged={refreshConnections} />;
  return <Buckets connections={connections} connectionId={connectionId} onConnection={setConnectionId} />;
}

/* ------------------------------- connections ------------------------------ */

function Connections({ connections, onChanged }: { connections: StorageConnection[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [pathStyle, setPathStyle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<StorageConnection | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});

  const add = async () => {
    setBusy(true);
    try {
      await api.storage.addConnection({ name: name.trim(), endpoint: endpoint.trim(), region: region.trim() || 'us-east-1', accessKey: accessKey.trim(), secretKey, pathStyle });
      toast.success(`Connection ${name.trim()} saved`);
      setName('');
      setEndpoint('');
      setAccessKey('');
      setSecretKey('');
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const test = async (c: StorageConnection) => {
    try {
      const { buckets } = await api.storage.buckets(c.id);
      setTested((t) => ({ ...t, [c.id]: `${buckets.length} bucket${buckets.length === 1 ? '' : 's'}` }));
    } catch (error) {
      setTested((t) => ({ ...t, [c.id]: `failed: ${error instanceof Error ? error.message : String(error)}` }));
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="storage-connections">
      <div className="mx-auto max-w-[820px] space-y-3">
        <Card title="Connections" subtitle="S3-compatible endpoints. Keys are kept in ~/.mjolnir/settings.json (owner-only) and never shown again.">
          {connections.length === 0 ? <p className="text-[12.5px] text-tertiary">None yet. Add one below, or open a bucket browser from a MinIO or RustFS pod.</p> : null}
          <ul className="divide-y divide-[var(--border-subtle)]">
            {connections.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2" data-testid={`storage-connection-${c.name}`}>
                <Archive size={14} strokeWidth={1.8} aria-hidden style={{ color: 'var(--log-pod-b)' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-primary">{c.name}</div>
                  <div className="break-words [overflow-wrap:anywhere] font-mono text-[11px] text-tertiary">{c.source ? `pod ${c.source.namespace}/${c.source.pod}:${c.source.port} (forwarded on demand)` : c.endpoint} · {c.region} · {c.pathStyle ? 'path-style' : 'virtual-host'}{c.accessKey ? ` · ${c.accessKey}` : ''}</div>
                </div>
                {tested[c.id] ? <span className={`text-[11.5px] ${tested[c.id]?.startsWith('failed') ? 'text-error' : 'text-ok'}`}>{tested[c.id]}</span> : null}
                <Button variant="ghost" onClick={() => void test(c)}>Test</Button>
                <Button variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => setRemoving(c)} icon={<Trash2 size={12} strokeWidth={1.9} />}>Remove</Button>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Add a connection" subtitle="MinIO, RustFS, SeaweedFS, Garage, Ceph RGW, LocalStack, AWS S3. Sessions from Cloud access (IAM) arrive with that module.">
          <div className="grid grid-cols-2 gap-3">
            <Field id="st-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="local minio" data-testid="storage-name" />
            <Field id="st-endpoint" label="Endpoint" mono value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://127.0.0.1:9000" data-testid="storage-endpoint" validate={(v) => (v ? urlRule(v) : null)} />
            <Field id="st-access" label="Access key" mono value={accessKey} onChange={(e) => setAccessKey(e.target.value)} data-testid="storage-access" />
            <Field id="st-secret" label="Secret key" mono type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} data-testid="storage-secret" />
            <Field id="st-region" label="Region" mono value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
            <label className="flex items-center gap-2 self-end text-[12.5px] text-secondary">
              <Switch checked={pathStyle} onChange={setPathStyle} label="Path-style addressing" />
              Path-style addressing (MinIO and most self-hosted stores)
            </label>
          </div>
          <div className="mt-3 flex justify-end"><Button variant="primary" data-testid="storage-add" disabled={!name.trim() || !endpoint.trim() || urlRule(endpoint) !== null || busy} onClick={() => void add()}>{busy ? 'Saving…' : 'Save connection'}</Button></div>
        </Card>
      </div>
      <ConfirmDialog open={removing !== null} title={`Remove ${removing?.name ?? ''}?`} body="The saved endpoint and keys are deleted from this machine. Nothing in the store changes." confirmLabel="Remove" danger onClose={() => setRemoving(null)} onConfirm={() => { if (removing) void api.storage.removeConnection(removing.id).then(onChanged).finally(() => setRemoving(null)); }} />
    </div>
  );
}

/* --------------------------------- buckets -------------------------------- */

interface Entry {
  readonly kind: 'prefix' | 'object';
  readonly name: string;
  readonly key: string;
  readonly object?: StorageObject | undefined;
}

function Buckets({ connections, connectionId, onConnection }: { connections: StorageConnection[]; connectionId: string; onConnection: (id: string) => void }) {
  const { values: flags } = useFlags();
  const canWrite = flags['storage.write'] ?? true;
  const canPresign = flags['storage.presigned'] ?? true;
  const [buckets, setBuckets] = useState<Array<{ name: string; created: string }>>([]);
  // Where you were, kept across leaving the module and coming back.
  const [bucket, setBucket] = useSticky('storage.bucket', '');
  const [prefix, setPrefix] = useSticky('storage.prefix', '');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [next, setNext] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useSticky('storage.filter', '');
  const [preview, setPreview] = useState<{ key: string; type: string; size: number } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => Promise<unknown> } | null>(null);
  const [presigned, setPresigned] = useState<{ key: string; url: string; expires: number } | null>(null);
  const [creatingBucket, setCreatingBucket] = useState(false);
  const [newBucket, setNewBucket] = useState('');

  const loadBuckets = useCallback(async () => {
    if (!connectionId) return;
    try {
      const list = (await api.storage.buckets(connectionId)).buckets;
      setBuckets(list);
      setBucket((current) => (list.some((b) => b.name === current) ? current : (list[0]?.name ?? '')));
      setError(null);
    } catch (cause) {
      setBuckets([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [connectionId]);
  useEffect(() => {
    void loadBuckets();
  }, [loadBuckets]);

  // A prefix belongs to the bucket it was read from. Changing bucket has to
  // drop it, but mounting with a remembered pair must not, so this compares
  // rather than firing on every render.
  const lastBucket = useRef(bucket);
  useEffect(() => {
    if (lastBucket.current === bucket) return;
    lastBucket.current = bucket;
    setPrefix('');
  }, [bucket, setPrefix]);

  const loadObjects = useCallback(
    async (token?: string) => {
      if (!connectionId || !bucket) {
        setEntries([]);
        return;
      }
      try {
        const page = await api.storage.objects(connectionId, bucket, prefix, token);
        const folders: Entry[] = page.prefixes.map((p) => ({ kind: 'prefix', name: p.slice(prefix.length).replace(/\/$/, ''), key: p }));
        const files: Entry[] = page.objects.filter((o) => o.key !== prefix).map((o) => ({ kind: 'object', name: o.key.slice(prefix.length), key: o.key, object: o }));
        setEntries((current) => (token ? [...current, ...folders, ...files] : [...folders, ...files]));
        setNext(page.next);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [connectionId, bucket, prefix],
  );
  useEffect(() => {
    void loadObjects();
  }, [loadObjects]);

  const items = useMemo(
    () =>
      entries.map(
        (e) =>
          ({
            metadata: { name: e.name, ...(e.object?.lastModified ? { creationTimestamp: e.object.lastModified } : {}) },
            spec: { kind: e.kind, key: e.key, size: e.object?.size, etag: e.object?.etag, storageClass: e.object?.storageClass },
            status: {},
          }) as KubeItem,
      ),
    [entries],
  );
  const byName = useMemo(() => new Map(entries.map((e) => [e.name, e])), [entries]);
  const crumbs = prefix.split('/').filter(Boolean);

  const open = async (entry: Entry) => {
    if (entry.kind === 'prefix') {
      setPrefix(entry.key);
      return;
    }
    try {
      const head = await api.storage.head(connectionId, bucket, entry.key);
      setPreview({ key: entry.key, type: head.type, size: head.size });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const menuFor = (entry: Entry): MenuEntry[] =>
    entry.kind === 'prefix'
      ? [{ id: 'open', label: 'Open folder', icon: <Folder size={13} strokeWidth={1.9} />, onSelect: () => setPrefix(entry.key) }, ...copyEntry('copy-prefix', 'Copy prefix', entry.key)]
      : [
          { id: 'preview', label: 'Preview', icon: <Eye size={13} strokeWidth={1.9} />, onSelect: () => void open(entry) },
          { id: 'download', label: 'Download', icon: <Download size={13} strokeWidth={1.9} />, onSelect: () => window.open(api.storage.objectUrl(connectionId, bucket, entry.key), '_blank') },
          ...(canPresign
            ? [{ id: 'presign', label: 'Presigned link (1 hour)…', icon: <Link2 size={13} strokeWidth={1.9} />, onSelect: () => void api.storage.presign(connectionId, bucket, entry.key, 3600).then((r) => { setPresigned({ key: entry.key, ...r }); copyText(r.url, 'Presigned link copied'); }) }]
            : []),
          SEPARATOR,
          ...copyEntry('copy-key', 'Copy key', entry.key),
          ...copyEntry('copy-s3', 'Copy s3:// URI', `s3://${bucket}/${entry.key}`),
          ...copyEntry('copy-mc', 'Copy mc command', `mc cp <alias>/${bucket}/${entry.key} .`),
          SEPARATOR,
          ...(canWrite
            ? [{ id: 'delete', label: 'Delete…', icon: <Trash2 size={13} strokeWidth={1.9} />, danger: true, onSelect: () => setConfirm({ title: `Delete ${entry.name}?`, body: 'The object is removed from the bucket. Versioned buckets keep a delete marker.', run: () => api.storage.remove(connectionId, bucket, entry.key) }) }]
            : []),
        ];

  const isObject = (item: KubeItem) => (item.spec as { kind?: string } | undefined)?.kind === 'object';
  const keyOf = (item: KubeItem) => String((item.spec as { key?: string } | undefined)?.key ?? '');
  const bulk: BulkAction[] = [
    { id: 'download', label: 'Download', icon: <Download size={12} strokeWidth={2} />, applies: isObject, run: (chosen) => { for (const item of chosen) window.open(api.storage.objectUrl(connectionId, bucket, keyOf(item), false, true), '_blank'); } },
    { id: 'copy', label: 'Copy keys', icon: <Link2 size={12} strokeWidth={2} />, run: (chosen) => copyText(chosen.map(keyOf).join('\n'), `${chosen.length} keys copied`) },
    {
      id: 'delete',
      label: 'Delete…',
      icon: <Trash2 size={12} strokeWidth={2} />,
      danger: true,
      applies: (item: KubeItem) => canWrite && isObject(item),
      run: (chosen) =>
        setConfirm({
          title: `Delete ${chosen.length} object${chosen.length === 1 ? '' : 's'}?`,
          body: 'They are removed from the bucket. A versioned bucket keeps a delete marker.',
          run: async () => {
            for (const item of chosen) await api.storage.remove(connectionId, bucket, keyOf(item));
          },
        }),
    },
  ];

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        await api.storage.upload(connectionId, bucket, `${prefix}${file.name}`, file);
        toast.success(`Uploaded ${file.name}`);
      } catch (cause) {
        toast.error(`Upload of ${file.name} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    await loadObjects();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="storage-buckets">
      {/*
        One path, not three controls.
        
        Store, bucket and folder are the same journey, and showing them as a
        dropdown, a second dropdown and then a breadcrumb made people navigate
        the same thing in three different ways. It is one breadcrumb now: every
        segment is clickable, and the first two open a menu instead of leading
        deeper. That is how a file manager works, and a bucket is a folder.
      */}
      <div className="flex h-[46px] shrink-0 items-center gap-1 border-b border-line bg-raised px-3">
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[12.5px]" aria-label="Path" data-testid="storage-path">
          <Select
            label="Store"
            value={connectionId}
            onChange={onConnection}
            testId="storage-connection"
            inline
            options={connections.map((c) => ({
              value: c.id,
              label: storeName(c),
              hint: c.source ? `${c.source.namespace} \u00b7 in the cluster` : new URL(c.endpoint || 'http://x').host,
            }))}
          />
          <ChevronRight size={13} className="shrink-0 text-tertiary" aria-hidden />
          <Select
            label="Bucket"
            value={bucket}
            onChange={(b) => setBucket(b)}
            testId="storage-bucket"
            inline
            mono
            options={buckets.map((b) => ({ value: b.name, label: b.name }))}
          />
          {crumbs.map((part, index) => (
            <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight size={13} className="shrink-0 text-tertiary" aria-hidden />
              <button
                type="button"
                onClick={() => setPrefix(`${crumbs.slice(0, index + 1).join('/')}/`)}
                title={part}
                className="max-w-[170px] truncate rounded-md px-1.5 py-1 font-mono text-secondary hover:bg-hover hover:text-primary"
              >
                {part}
              </button>
            </span>
          ))}
        </nav>

        <Field
          id="storage-filter"
          label="Filter"
          hideLabel
          mono
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter"
          className="ml-2 w-[180px] shrink-0"
        />
        {canWrite ? (
          <Button iconOnly variant="ghost" aria-label="New bucket" hint="Creates it on this store" onClick={() => setCreatingBucket(true)} icon={<FolderPlus size={13} strokeWidth={1.9} />} />
        ) : null}
        {canWrite ? (
          <label className="inline-flex cursor-pointer">
            <input type="file" multiple className="hidden" data-testid="storage-upload-input" onChange={(e) => void upload(e.target.files)} />
            <span className="inline-flex h-[30px] items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-[13px] text-primary hover:border-strong"><Upload size={13} strokeWidth={1.9} aria-hidden /> Upload</span>
          </label>
        ) : null}
        <Button iconOnly variant="ghost" aria-label="Refresh" onClick={() => void loadObjects()} icon={<RefreshCw size={13} strokeWidth={2} />} />
      </div>
      {error ? <div className="border-b border-[var(--status-error-border)] bg-error-bg px-3 py-2 text-[12.5px] text-error">{error}</div> : null}
      {!connectionId ? <div className="p-4 text-[12.5px] text-tertiary">No connection. Add one under Connections, or open a bucket browser from a storage pod.</div> : null}
      <div className="relative flex min-h-0 flex-1">
        <ResourceList
          kind="StorageObject"
          label="objects"
          namespace={bucket ? `${bucket}/${prefix}` : undefined}
          items={items}
          state={connectionId ? 'synced' : 'idle'}
          error={null}
          filter={filter}
          bulk={bulk}
          empty={
            !connectionId
              ? { title: 'No connection yet', detail: 'Add an endpoint and keys under Connections, or open a bucket browser straight from a MinIO, RustFS or SeaweedFS pod in Kubernetes: the keys come from the pod.' }
              : !bucket
                ? { title: 'No bucket selected', detail: 'Pick one from the bucket menu in the toolbar, or create one with the folder button beside it.' }
                : { title: `Nothing in ${bucket}${prefix ? `/${prefix.replace(/\/$/, '')}` : ''}`, detail: 'This prefix holds no objects. Upload with the button in the toolbar, or drop files onto the list.' }
          }
          menu={(item) => {
            const entry = byName.get(item.metadata?.name ?? '');
            return entry ? menuFor(entry) : [];
          }}
          onSelect={(item) => {
            const entry = byName.get(item.metadata?.name ?? '');
            if (entry) void open(entry);
          }}
        />
      </div>
      {next ? (
        <div className="flex shrink-0 justify-center border-t border-line bg-raised py-1.5"><Button variant="ghost" onClick={() => void loadObjects(next)}>Load more</Button></div>
      ) : null}

      <FileViewer
        file={preview}
        urlFor={(key, inline, download) => api.storage.objectUrl(connectionId, bucket, key, inline, download)}
        onPresign={(key) => api.storage.presign(connectionId, bucket, key, 3600).then((r) => r.url)}
        onClose={() => setPreview(null)}
      />
      <Modal open={presigned !== null} onClose={() => setPresigned(null)} title="Presigned link" description={presigned ? `Anyone with it can read ${presigned.key} for ${Math.round(presigned.expires / 60)} minutes.` : ''} width={620}
        footer={<><Button variant="ghost" onClick={() => presigned && window.open(presigned.url, '_blank')} icon={<ExternalLink size={12} strokeWidth={1.9} />}>Open</Button><Button variant="primary" onClick={() => presigned && copyText(presigned.url, 'Copied')}>Copy</Button></>}>
        <code className="mb-4 block break-all rounded-lg border border-line bg-sunken p-3 font-mono text-[11.5px] text-primary" data-testid="presigned-url">{presigned?.url}</code>
      </Modal>
      <Modal open={creatingBucket} onClose={() => setCreatingBucket(false)} title="New bucket" guard={{ dirty: newBucket !== '' }} footer={<><Button variant="ghost" onClick={() => setCreatingBucket(false)}>Cancel</Button><Button variant="primary" disabled={!newBucket.trim() || bucketName(newBucket.trim()) !== null} onClick={() => void api.storage.createBucket(connectionId, newBucket.trim()).then(() => { toast.success(`Bucket ${newBucket.trim()} created`); setCreatingBucket(false); setNewBucket(''); return loadBuckets(); }).catch((e: Error) => toast.error(e.message))} icon={<Plus size={12} strokeWidth={2} />}>Create</Button></>}>
        <Field id="new-bucket" label="Name" mono value={newBucket} onChange={(e) => setNewBucket(e.target.value)} placeholder="my-bucket" validate={(v) => (v ? bucketName(v) : null)} />
        <div className="pb-2" />
      </Modal>
      <ConfirmDialog open={confirm !== null} title={confirm?.title ?? ''} body={confirm?.body ?? ''} confirmLabel="Delete" danger onClose={() => setConfirm(null)} onConfirm={() => { if (!confirm) return; void confirm.run().then(() => { toast.success('Deleted'); return loadObjects(); }).catch((e: Error) => toast.error(e.message)).finally(() => setConfirm(null)); }} />
    </div>
  );
}

export function formatObjectDate(value: string | undefined): string {
  return value ? formatDateTime(value) : '';
}


/**
 * A name a person recognises.
 *
 * Connections made before this rewrite are called things like
 * "minio-55f7f885c7-98nq9 (MinIO)", which is a replica-set hash nobody reads
 * and which changes every time the pod is rescheduled: the store you chose
 * yesterday looks like a different one today. The product and the namespace
 * are the two things that actually identify it.
 */
export function storeName(connection: StorageConnection): string {
  if (!connection.source) return connection.name;
  const product = /\(([^)]+)\)\s*$/.exec(connection.name)?.[1];
  if (!product) return connection.name;
  return `${product} in ${connection.source.namespace}`;
}
