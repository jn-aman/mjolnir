import { Router } from 'express';
import { HttpError, handle, param, queryBoolean } from '../http.ts';
import { DockerError, readAll } from '../docker/client.ts';
import { dockerClient, listDockerContexts } from '../docker/contexts.ts';

/**
 * The Containers module's API. Thin: the engine already speaks JSON, and
 * what we add is discovery, per-container stats folded into the list, and
 * one verb per action so the UI never builds engine paths.
 */

interface ContainerSummary {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  State: string;
  Status: string;
  Created: number;
  Labels: Record<string, string>;
  Ports: Array<{ IP?: string; PrivatePort: number; PublicPort?: number; Type: string }>;
  Mounts: Array<{ Type: string; Source?: string; Destination: string; Name?: string }>;
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }> };
}

interface Stats {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; limit?: number; stats?: { inactive_file?: number; cache?: number } };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
}

function cpuPercent(stats: Stats): number {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = (stats.cpu_stats.system_cpu_usage ?? 0) - (stats.precpu_stats.system_cpu_usage ?? 0);
  const cpus = stats.cpu_stats.online_cpus ?? 1;
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;
  return (cpuDelta / systemDelta) * cpus * 100;
}

const ACTIONS = new Set(['start', 'stop', 'restart', 'kill', 'pause', 'unpause']);

const cleanName = (c: ContainerSummary) => c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12);

export function dockerRoutes(): Router {
  const router = Router();

  const wrap = <T>(work: () => Promise<T>): Promise<T> =>
    work().catch((error: unknown) => {
      if (error instanceof DockerError) throw new HttpError(error.status === 404 ? 404 : 502, error.status === 404 ? 'not-found' : 'upstream', error.message);
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOENT|ECONNREFUSED|EACCES/.test(message)) throw new HttpError(502, 'upstream', `the Docker engine is not reachable: ${message}`);
      throw error;
    });

  router.get(
    '/',
    handle(async (_req, res) => {
      const { contexts, current } = listDockerContexts();
      const described = await Promise.all(
        contexts.map(async (context) => {
          if (!context.supported) return { ...context, reachable: false };
          try {
            const version = await dockerClient(context.name).json<{ Version?: string; Os?: string; Arch?: string }>('GET', '/version');
            return { ...context, reachable: true, version: version.Version, platform: `${version.Os ?? ''}/${version.Arch ?? ''}` };
          } catch (error) {
            return { ...context, reachable: false, error: error instanceof Error ? error.message : String(error) };
          }
        }),
      );
      res.json({ contexts: described, current });
    }),
  );

  router.get(
    '/:ctx/containers',
    handle(async (req, res) => {
      const client = dockerClient(param(req, 'ctx'));
      const containers = await wrap(() => client.json<ContainerSummary[]>('GET', '/containers/json', { query: { all: true } }));
      const withStats = await Promise.all(
        containers.map(async (container) => {
          const base = {
            id: container.Id,
            name: cleanName(container),
            image: container.Image,
            imageId: container.ImageID,
            state: container.State,
            status: container.Status,
            created: new Date(container.Created * 1000).toISOString(),
            labels: container.Labels ?? {},
            project: container.Labels?.['com.docker.compose.project'],
            service: container.Labels?.['com.docker.compose.service'],
            ports: (container.Ports ?? []).map((port) => ({ host: port.PublicPort, container: port.PrivatePort, protocol: port.Type, ip: port.IP })),
            mounts: (container.Mounts ?? []).map((m) => ({ type: m.Type, source: m.Source ?? m.Name, destination: m.Destination })),
            networks: Object.entries(container.NetworkSettings?.Networks ?? {}).map(([name, net]) => ({ name, ip: net.IPAddress })),
          };
          if (container.State !== 'running') return base;
          try {
            const stats = await client.json<Stats>('GET', `/containers/${container.Id}/stats`, { query: { stream: false } });
            const cache = stats.memory_stats.stats?.inactive_file ?? stats.memory_stats.stats?.cache ?? 0;
            const rx = Object.values(stats.networks ?? {}).reduce((n, net) => n + net.rx_bytes, 0);
            const tx = Object.values(stats.networks ?? {}).reduce((n, net) => n + net.tx_bytes, 0);
            return { ...base, cpuPercent: cpuPercent(stats), memoryBytes: Math.max(0, (stats.memory_stats.usage ?? 0) - cache), memoryLimit: stats.memory_stats.limit, rxBytes: rx, txBytes: tx };
          } catch {
            return base;
          }
        }),
      );
      res.json({ containers: withStats });
    }),
  );

  router.get(
    '/:ctx/containers/:id',
    handle(async (req, res) => {
      const client = dockerClient(param(req, 'ctx'));
      res.json(await wrap(() => client.json('GET', `/containers/${encodeURIComponent(param(req, 'id'))}/json`)));
    }),
  );

  router.post(
    '/:ctx/containers/:id/:action',
    handle(async (req, res) => {
      const action = param(req, 'action');
      if (!ACTIONS.has(action)) throw HttpError.badRequest(`unknown action ${action}`);
      const client = dockerClient(param(req, 'ctx'));
      await wrap(() => client.json('POST', `/containers/${encodeURIComponent(param(req, 'id'))}/${action}`, { query: action === 'stop' || action === 'restart' ? { t: 10 } : {} }));
      res.json({ ok: true });
    }),
  );

  router.delete(
    '/:ctx/containers/:id',
    handle(async (req, res) => {
      const client = dockerClient(param(req, 'ctx'));
      await wrap(() => client.json('DELETE', `/containers/${encodeURIComponent(param(req, 'id'))}`, { query: { force: queryBoolean(req, 'force'), v: queryBoolean(req, 'volumes') } }));
      res.json({ ok: true });
    }),
  );

  router.get(
    '/:ctx/images',
    handle(async (req, res) => {
      const client = dockerClient(param(req, 'ctx'));
      type Image = { Id: string; RepoTags: string[] | null; RepoDigests: string[] | null; Created: number; Size: number; Labels: Record<string, string> | null };
      const [images, containers] = await Promise.all([
        wrap(() => client.json<Image[]>('GET', '/images/json')),
        wrap(() => client.json<ContainerSummary[]>('GET', '/containers/json', { query: { all: true } })),
      ]);
      res.json({
        images: images.map((image) => ({
          id: image.Id,
          tags: (image.RepoTags ?? []).filter((tag) => tag !== '<none>:<none>'),
          digests: image.RepoDigests ?? [],
          created: new Date(image.Created * 1000).toISOString(),
          size: image.Size,
          usedBy: containers.filter((c) => c.ImageID === image.Id).map(cleanName),
          labels: image.Labels ?? {},
        })),
      });
    }),
  );

  router.delete(
    '/:ctx/images/:id',
    handle(async (req, res) => {
      const client = dockerClient(param(req, 'ctx'));
      res.json(await wrap(() => client.json('DELETE', `/images/${encodeURIComponent(param(req, 'id'))}`, { query: { force: queryBoolean(req, 'force') } })));
    }),
  );

  router.post(
    '/:ctx/images/pull',
    handle(async (req, res) => {
      const image = String((req.body as { image?: unknown })?.image ?? '').trim();
      if (!image) throw HttpError.badRequest('image is required');
      const client = dockerClient(param(req, 'ctx'));
      const response = await wrap(() => client.raw('POST', '/images/create', { query: { fromImage: image } }));
      const text = await readAll(response);
      if ((response.statusCode ?? 0) >= 400) throw new HttpError(502, 'upstream', text.slice(0, 300));
      const last = text.trim().split('\n').pop() ?? '';
      let status = last;
      try {
        status = (JSON.parse(last) as { status?: string }).status ?? last;
      } catch {
        // Not JSON; the raw tail is the status.
      }
      res.json({ ok: true, status });
    }),
  );

  router.get(
    '/:ctx/volumes',
    handle(async (req, res) => {
      const client = dockerClient(param(req, 'ctx'));
      type Volume = { Name: string; Driver: string; Mountpoint: string; CreatedAt?: string; Labels: Record<string, string> | null; Scope: string };
      const [result, containers] = await Promise.all([
        wrap(() => client.json<{ Volumes: Volume[] | null }>('GET', '/volumes')),
        wrap(() => client.json<ContainerSummary[]>('GET', '/containers/json', { query: { all: true } })),
      ]);
      res.json({
        volumes: (result.Volumes ?? []).map((volume) => ({
          name: volume.Name,
          driver: volume.Driver,
          mountpoint: volume.Mountpoint,
          created: volume.CreatedAt,
          labels: volume.Labels ?? {},
          usedBy: containers.filter((c) => (c.Mounts ?? []).some((m) => m.Name === volume.Name)).map(cleanName),
        })),
      });
    }),
  );

  router.delete(
    '/:ctx/volumes/:name',
    handle(async (req, res) => {
      const client = dockerClient(param(req, 'ctx'));
      await wrap(() => client.json('DELETE', `/volumes/${encodeURIComponent(param(req, 'name'))}`, { query: { force: queryBoolean(req, 'force') } }));
      res.json({ ok: true });
    }),
  );

  router.get(
    '/:ctx/networks',
    handle(async (req, res) => {
      const client = dockerClient(param(req, 'ctx'));
      type Network = { Id: string; Name: string; Driver: string; Scope: string; Created: string; Internal: boolean; IPAM?: { Config?: Array<{ Subnet?: string }> }; Containers?: Record<string, { Name: string }> };
      const networks = await wrap(() => client.json<Network[]>('GET', '/networks'));
      res.json({
        networks: networks.map((network) => ({
          id: network.Id,
          name: network.Name,
          driver: network.Driver,
          scope: network.Scope,
          created: network.Created,
          internal: network.Internal,
          subnets: (network.IPAM?.Config ?? []).map((c) => c.Subnet).filter(Boolean),
          containers: Object.values(network.Containers ?? {}).map((c) => c.Name),
        })),
      });
    }),
  );

  router.delete(
    '/:ctx/networks/:id',
    handle(async (req, res) => {
      const client = dockerClient(param(req, 'ctx'));
      await wrap(() => client.json('DELETE', `/networks/${encodeURIComponent(param(req, 'id'))}`));
      res.json({ ok: true });
    }),
  );

  router.get(
    '/:ctx/system',
    handle(async (req, res) => {
      const client = dockerClient(param(req, 'ctx'));
      const [info, df, version] = await Promise.all([
        wrap(() => client.json<Record<string, unknown>>('GET', '/info')),
        wrap(() => client.json<Record<string, unknown>>('GET', '/system/df')),
        wrap(() => client.json<Record<string, unknown>>('GET', '/version')),
      ]);
      res.json({ info, df, version });
    }),
  );

  router.post(
    '/:ctx/prune/:what',
    handle(async (req, res) => {
      const what = param(req, 'what');
      const client = dockerClient(param(req, 'ctx'));
      const paths: Record<string, string[]> = {
        containers: ['/containers/prune'],
        images: ['/images/prune'],
        volumes: ['/volumes/prune'],
        networks: ['/networks/prune'],
        system: ['/containers/prune', '/images/prune', '/volumes/prune', '/networks/prune'],
      };
      const targets = paths[what];
      if (!targets) throw HttpError.badRequest(`unknown prune target ${what}`);
      const results = await Promise.all(targets.map((path) => wrap(() => client.json<Record<string, unknown>>('POST', path))));
      const reclaimed = results.reduce((n, r) => n + Number(r['SpaceReclaimed'] ?? 0), 0);
      res.json({ ok: true, reclaimed });
    }),
  );

  return router;
}
