import { randomUUID } from 'node:crypto';
import { Router, raw } from 'express';
import type { SettingsStore } from '../settings.ts';
import type { ForwardManager } from '../forwards.ts';
import type { ClusterRegistry } from '../clusters.ts';
import { HttpError, handle, param, query } from '../http.ts';
import { S3Client, S3Error } from '../storage/s3.ts';
import { logger } from '@mjolnir/logger';

const log = logger.child('storage');

/**
 * The object storage module's API. A connection is an endpoint and keys; a
 * pod-sourced connection also owns a port-forward the server keeps open.
 * Object bodies stream through; nothing is cached on disk.
 */
interface Connection {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  pathStyle: boolean;
  source?: { context: string; namespace: string; pod: string; port: number } | undefined;
}

/**
 * Where an object store keeps its keys.
 *
 * Every distribution picks its own names, and more to the point most of them
 * do not put the value in `env` at all: the MinIO chart, the operator and
 * Bitnami all use `envFrom: [{ secretRef }]`, so a reader that only walks
 * `env` finds nothing and the browser opens with an empty access key. That is
 * what "The Access Key Id you provided does not exist" was.
 */
const ACCESS_NAMES = ['MINIO_ROOT_USER', 'MINIO_ACCESS_KEY', 'RUSTFS_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'ACCESS_KEY', 'S3_ACCESS_KEY', 'SEAWEEDFS_ACCESS_KEY', 'GARAGE_ACCESS_KEY'];
const SECRET_NAMES = ['MINIO_ROOT_PASSWORD', 'MINIO_SECRET_KEY', 'RUSTFS_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY', 'SECRET_KEY', 'S3_SECRET_KEY', 'SEAWEEDFS_SECRET_KEY', 'GARAGE_SECRET_KEY'];

interface PodShape {
  spec?: {
    containers?: Array<{
      name?: string;
      ports?: Array<{ containerPort?: number; name?: string }>;
      env?: Array<{ name?: string; value?: string; valueFrom?: { secretKeyRef?: { name?: string; key?: string }; configMapKeyRef?: { name?: string; key?: string } } }>;
      envFrom?: Array<{ secretRef?: { name?: string }; configMapRef?: { name?: string }; prefix?: string }>;
    }>;
  };
}

/**
 * Reads the keys out of the pod that serves the bucket.
 *
 * Literal `env` first, then `env.valueFrom.secretKeyRef`, then every Secret
 * and ConfigMap pulled in wholesale by `envFrom`. The lookup is by the names
 * above, so a Secret that happens to hold twenty keys still yields the right
 * two. Anything unreadable is skipped rather than fatal: a partial answer
 * still saves the typing, and the caller says what is missing.
 */
export async function credentialsFromPod(
  registry: ClusterRegistry,
  source: { context: string; namespace: string; pod: string; port: number },
): Promise<{ accessKey: string; secretKey: string; from: string[] }> {
  const connection = registry.connect(source.context);
  const pod = await connection.json<PodShape>(`/api/v1/namespaces/${source.namespace}/pods/${source.pod}`);

  const bag = new Map<string, string>();
  const from: string[] = [];
  const decode = (value: string) => Buffer.from(value, 'base64').toString('utf8');

  for (const container of pod.spec?.containers ?? []) {
    // Wholesale first, so an explicit `env` entry overrides it, which is the
    // order Kubernetes itself applies.
    for (const entry of container.envFrom ?? []) {
      const prefix = entry.prefix ?? '';
      if (entry.secretRef?.name) {
        try {
          const secret = await connection.json<{ data?: Record<string, string> }>(`/api/v1/namespaces/${source.namespace}/secrets/${entry.secretRef.name}`);
          for (const [key, value] of Object.entries(secret.data ?? {})) bag.set(`${prefix}${key}`, decode(value));
          from.push(`Secret ${entry.secretRef.name}`);
        } catch {
          // No access to that Secret: the caller reports what is still missing.
        }
      }
      if (entry.configMapRef?.name) {
        try {
          const map = await connection.json<{ data?: Record<string, string> }>(`/api/v1/namespaces/${source.namespace}/configmaps/${entry.configMapRef.name}`);
          for (const [key, value] of Object.entries(map.data ?? {})) bag.set(`${prefix}${key}`, value);
          from.push(`ConfigMap ${entry.configMapRef.name}`);
        } catch {
          // as above
        }
      }
    }
    for (const entry of container.env ?? []) {
      if (!entry.name) continue;
      if (entry.value !== undefined) {
        bag.set(entry.name, entry.value);
        continue;
      }
      const ref = entry.valueFrom?.secretKeyRef;
      if (ref?.name && ref.key) {
        try {
          const secret = await connection.json<{ data?: Record<string, string> }>(`/api/v1/namespaces/${source.namespace}/secrets/${ref.name}`);
          const value = secret.data?.[ref.key];
          if (value !== undefined) {
            bag.set(entry.name, decode(value));
            from.push(`Secret ${ref.name}`);
          }
        } catch {
          // as above
        }
      }
      const map = entry.valueFrom?.configMapKeyRef;
      if (map?.name && map.key) {
        try {
          const object = await connection.json<{ data?: Record<string, string> }>(`/api/v1/namespaces/${source.namespace}/configmaps/${map.name}`);
          const value = object.data?.[map.key];
          if (value !== undefined) {
            bag.set(entry.name, value);
            from.push(`ConfigMap ${map.name}`);
          }
        } catch {
          // as above
        }
      }
    }
  }

  const pick = (names: string[]) => names.map((name) => bag.get(name)).find((value) => value !== undefined && value !== '') ?? '';
  return { accessKey: pick(ACCESS_NAMES), secretKey: pick(SECRET_NAMES), from: [...new Set(from)] };
}

export function storageRoutes(settings: SettingsStore, forwards: ForwardManager, registry: ClusterRegistry): Router {
  const router = Router();

  const connections = (): Connection[] => settings.get().storage.connections as Connection[];
  const save = (list: Connection[]) => settings.update({ storage: { connections: list } });

  /** The live endpoint: the forward's local port when the store is in a pod. */
  const clientFor = async (id: string): Promise<S3Client> => {
    const connection = connections().find((c) => c.id === id);
    if (!connection) throw HttpError.notFound(`no connection ${id}`);
    let endpoint = connection.endpoint;
    let { accessKey, secretKey } = connection;

    if (connection.source) {
      const record = await forwards.start({ context: connection.source.context, namespace: connection.source.namespace, pod: connection.source.pod, port: connection.source.port });
      endpoint = `http://127.0.0.1:${record.localPort}`;

      // A connection made before Mjolnir could read `envFrom` has no keys and
      // fails on every request with "the access key does not exist". Look
      // again now rather than making someone delete it and start over; the
      // pod is the source of truth and it is already in front of us.
      if (!accessKey || !secretKey) {
        const found = await credentialsFromPod(registry, connection.source).catch(() => ({ accessKey: '', secretKey: '', from: [] as string[] }));
        accessKey = accessKey || found.accessKey;
        secretKey = secretKey || found.secretKey;
        if (accessKey && secretKey) {
          save(connections().map((c) => (c.id === id ? { ...c, accessKey, secretKey } : c)));
          log.info('recovered storage credentials from the pod', { connection: connection.name, from: found.from });
        } else {
          throw HttpError.badRequest(
            `No S3 credentials for ${connection.name}. Mjolnir looked at pod ${connection.source.pod}: its env, the Secrets it names and anything it pulls in with envFrom. Add the keys by hand under Connections.`,
          );
        }
      }
    }

    return new S3Client({ endpoint, region: connection.region || 'us-east-1', accessKey, secretKey, pathStyle: connection.pathStyle });
  };

  const wrap = <T>(work: () => Promise<T>): Promise<T> =>
    work().catch((error: unknown) => {
      if (error instanceof S3Error) throw new HttpError(error.status === 404 ? 404 : error.status === 403 ? 401 : 502, error.status === 404 ? 'not-found' : error.status === 403 ? 'auth' : 'upstream', error.message);
      const message = error instanceof Error ? error.message : String(error);
      if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/.test(message)) throw new HttpError(502, 'upstream', `cannot reach the store: ${message}`);
      throw error;
    });

  router.get('/connections', handle(async (_req, res) => res.json({ connections: connections().map((c) => ({ ...c, secretKey: c.secretKey ? 'set' : '' })) })));

  router.post(
    '/connections',
    handle(async (req, res) => {
      const body = req.body as Partial<Connection>;
      if (!body.name) throw HttpError.badRequest('name is required');
      if (!body.endpoint && !body.source) throw HttpError.badRequest('endpoint, or a pod source, is required');

      // Opening the browser on a pod should not ask for keys the cluster
      // already holds. Only when the caller sent none, so a deliberate
      // override still wins.
      let accessKey = body.accessKey ?? '';
      let secretKey = body.secretKey ?? '';
      let discovered: string[] = [];
      if (body.source && (!accessKey || !secretKey)) {
        const found = await credentialsFromPod(registry, body.source).catch(() => ({ accessKey: '', secretKey: '', from: [] as string[] }));
        accessKey = accessKey || found.accessKey;
        secretKey = secretKey || found.secretKey;
        discovered = found.from;
        if (!accessKey || !secretKey) {
          throw HttpError.badRequest(
            `Could not find S3 credentials on pod ${body.source.pod}. Looked at its env, the Secrets it names and anything it pulls in with envFrom. Add the access key and secret key by hand under Connections.`,
          );
        }
      }

      const connection: Connection = {
        id: randomUUID(),
        name: body.name,
        endpoint: body.endpoint ?? '',
        region: body.region || 'us-east-1',
        accessKey,
        secretKey,
        pathStyle: body.pathStyle ?? !/amazonaws\.com/.test(body.endpoint ?? ''),
        source: body.source,
      };
      save([...connections(), connection]);
      res.status(201).json({ connection: { ...connection, secretKey: connection.secretKey ? 'set' : '' }, discovered });
    }),
  );

  router.put(
    '/connections/:id',
    handle(async (req, res) => {
      const id = param(req, 'id');
      const body = req.body as Partial<Connection>;
      const list = connections().map((c) => (c.id === id ? { ...c, ...body, id, secretKey: body.secretKey && body.secretKey !== 'set' ? body.secretKey : c.secretKey } : c));
      save(list);
      res.json({ ok: true });
    }),
  );

  router.delete(
    '/connections/:id',
    handle(async (req, res) => {
      const id = param(req, 'id');
      save(connections().filter((c) => c.id !== id));
      res.json({ ok: true });
    }),
  );

  router.get(
    '/connections/:id/buckets',
    handle(async (req, res) => {
      const client = await clientFor(param(req, 'id'));
      res.json({ buckets: await wrap(() => client.listBuckets()) });
    }),
  );

  router.post(
    '/connections/:id/buckets',
    handle(async (req, res) => {
      const name = String((req.body as { name?: unknown })?.name ?? '').trim();
      if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)) throw HttpError.badRequest('bucket names are 3 to 63 lowercase letters, digits, dots and dashes');
      const client = await clientFor(param(req, 'id'));
      await wrap(() => client.createBucket(name));
      res.status(201).json({ ok: true });
    }),
  );

  router.get(
    '/connections/:id/buckets/:bucket/objects',
    handle(async (req, res) => {
      const client = await clientFor(param(req, 'id'));
      res.json(await wrap(() => client.listObjects(param(req, 'bucket'), query(req, 'prefix') ?? '', query(req, 'token'))));
    }),
  );

  router.get(
    '/connections/:id/buckets/:bucket/object',
    handle(async (req, res) => {
      const key = query(req, 'key');
      if (!key) throw HttpError.badRequest('key is required');
      const client = await clientFor(param(req, 'id'));
      // Two separate questions that used to be one flag, which is why PDFs
      // downloaded instead of opening. `inline` is about how much to read:
      // the first few megabytes, for a text preview. `download` is about what
      // the browser does with it. A PDF wants all the bytes *and* to be
      // rendered, and the old code could not express that.
      const inline = query(req, 'inline') === '1';
      const download = query(req, 'download') === '1';
      const upstream = await wrap(() => client.getObject(param(req, 'bucket'), key, inline ? 'bytes=0-4194303' : undefined));
      res.status(upstream.statusCode === 206 ? 200 : (upstream.statusCode ?? 200));
      res.setHeader('content-type', String(upstream.headers['content-type'] ?? 'application/octet-stream'));
      if (upstream.headers['content-length'] && !inline) res.setHeader('content-length', String(upstream.headers['content-length']));
      // Accept-ranges matters for a PDF: the viewer fetches the trailer first
      // and will not render at all without it on a large file.
      if (upstream.headers['accept-ranges']) res.setHeader('accept-ranges', String(upstream.headers['accept-ranges']));
      res.setHeader('content-disposition', `${download ? 'attachment' : 'inline'}; filename="${key.split('/').pop() ?? 'object'}"`);
      upstream.pipe(res);
    }),
  );

  router.get(
    '/connections/:id/buckets/:bucket/head',
    handle(async (req, res) => {
      const key = query(req, 'key');
      if (!key) throw HttpError.badRequest('key is required');
      const client = await clientFor(param(req, 'id'));
      res.json(await wrap(() => client.headObject(param(req, 'bucket'), key)));
    }),
  );

  router.put(
    '/connections/:id/buckets/:bucket/object',
    raw({ type: () => true, limit: '512mb' }),
    handle(async (req, res) => {
      const key = query(req, 'key');
      if (!key) throw HttpError.badRequest('key is required');
      const client = await clientFor(param(req, 'id'));
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      await wrap(() => client.putObject(param(req, 'bucket'), key, body, String(req.headers['content-type'] ?? 'application/octet-stream')));
      res.status(201).json({ ok: true, size: body.length });
    }),
  );

  router.delete(
    '/connections/:id/buckets/:bucket/object',
    handle(async (req, res) => {
      const key = query(req, 'key');
      if (!key) throw HttpError.badRequest('key is required');
      const client = await clientFor(param(req, 'id'));
      await wrap(() => client.deleteObject(param(req, 'bucket'), key));
      res.json({ ok: true });
    }),
  );

  router.post(
    '/connections/:id/buckets/:bucket/presign',
    handle(async (req, res) => {
      const body = req.body as { key?: unknown; expires?: unknown };
      const key = String(body.key ?? '');
      if (!key) throw HttpError.badRequest('key is required');
      const expires = Math.min(7 * 86_400, Math.max(60, Number(body.expires ?? 3600)));
      const client = await clientFor(param(req, 'id'));
      res.json({ url: client.presign(param(req, 'bucket'), key, expires), expires });
    }),
  );

  return router;
}
