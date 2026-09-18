import { randomUUID } from 'node:crypto';
import { Router, raw } from 'express';
import type { SettingsStore } from '../settings.ts';
import type { ForwardManager } from '../forwards.ts';
import { HttpError, handle, param, query } from '../http.ts';
import { S3Client, S3Error } from '../storage/s3.ts';

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

export function storageRoutes(settings: SettingsStore, forwards: ForwardManager): Router {
  const router = Router();

  const connections = (): Connection[] => settings.get().storage.connections as Connection[];
  const save = (list: Connection[]) => settings.update({ storage: { connections: list } });

  /** The live endpoint: the forward's local port when the store is in a pod. */
  const clientFor = async (id: string): Promise<S3Client> => {
    const connection = connections().find((c) => c.id === id);
    if (!connection) throw HttpError.notFound(`no connection ${id}`);
    let endpoint = connection.endpoint;
    if (connection.source) {
      const record = await forwards.start({ context: connection.source.context, namespace: connection.source.namespace, pod: connection.source.pod, port: connection.source.port });
      endpoint = `http://127.0.0.1:${record.localPort}`;
    }
    return new S3Client({ endpoint, region: connection.region || 'us-east-1', accessKey: connection.accessKey, secretKey: connection.secretKey, pathStyle: connection.pathStyle });
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
      const connection: Connection = {
        id: randomUUID(),
        name: body.name,
        endpoint: body.endpoint ?? '',
        region: body.region || 'us-east-1',
        accessKey: body.accessKey ?? '',
        secretKey: body.secretKey ?? '',
        pathStyle: body.pathStyle ?? !/amazonaws\.com/.test(body.endpoint ?? ''),
        source: body.source,
      };
      save([...connections(), connection]);
      res.status(201).json({ connection: { ...connection, secretKey: connection.secretKey ? 'set' : '' } });
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
      const inline = query(req, 'inline') === '1';
      const upstream = await wrap(() => client.getObject(param(req, 'bucket'), key, inline ? 'bytes=0-1048575' : undefined));
      res.status(upstream.statusCode === 206 ? 200 : (upstream.statusCode ?? 200));
      res.setHeader('content-type', String(upstream.headers['content-type'] ?? 'application/octet-stream'));
      if (upstream.headers['content-length'] && !inline) res.setHeader('content-length', String(upstream.headers['content-length']));
      res.setHeader('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="${key.split('/').pop() ?? 'object'}"`);
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
