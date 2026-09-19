import { Router } from 'express';
import { logger } from '@mjolnir/logger';
import type { ClusterRegistry } from '../clusters.ts';
import type { ForwardManager } from '../forwards.ts';
import { HttpError, handle, param, query } from '../http.ts';

const log = logger.child('forwards');

interface PortShape {
  readonly name?: string;
  readonly containerPort?: number;
  readonly port?: number;
  readonly targetPort?: number | string;
  readonly protocol?: string;
}

/** Something you can point a local port at. */
export interface ForwardTarget {
  readonly kind: 'Pod' | 'Service';
  readonly name: string;
  readonly namespace: string;
  /** The pod the connection actually lands on, which for a Service is one behind it. */
  readonly pod: string;
  readonly ports: ReadonlyArray<{ port: number; name?: string | undefined; protocol: string }>;
  /** The workload behind it, so the list reads like the cluster rather than like pod names. */
  readonly workload?: string | undefined;
  /** A guess at what this is, from the port. Only ever a hint. */
  readonly hint?: string | undefined;
}

/**
 * What a well-known port usually is.
 *
 * A hint and never a claim: 5432 is almost always Postgres and occasionally
 * something else entirely, so this labels the row and decides nothing.
 */
const WELL_KNOWN: Record<number, string> = {
  80: 'HTTP',
  443: 'HTTPS',
  3000: 'HTTP',
  3306: 'MySQL',
  5000: 'HTTP',
  5432: 'Postgres',
  5672: 'AMQP',
  6379: 'Redis',
  8000: 'HTTP',
  8080: 'HTTP',
  8443: 'HTTPS',
  9000: 'HTTP',
  9090: 'Prometheus',
  9092: 'Kafka',
  9093: 'Alertmanager',
  9200: 'Elasticsearch',
  11211: 'Memcached',
  15672: 'RabbitMQ admin',
  16686: 'Jaeger',
  27017: 'MongoDB',
};

export function forwardRoutes(forwards: ForwardManager, registry?: ClusterRegistry): Router {
  const router = Router();

  /**
   * Everything in the cluster worth forwarding, so the panel can offer it.
   *
   * Services first, because a Service is what a person means. "Forward Redis"
   * is a sentence about a service; `redis-7c9f-x4k2p` is an implementation
   * detail that changes every rollout, and asking somebody to pick one is
   * asking them to do the lookup themselves.
   */
  router.get(
    '/targets/:context',
    handle(async (req, res) => {
      if (!registry) throw new HttpError(503, 'internal', 'no cluster registry is available');
      const contextName = param(req, 'context');
      const namespace = query(req, 'namespace') ?? '';
      const scope = namespace ? `/api/v1/namespaces/${encodeURIComponent(namespace)}` : '/api/v1';
      const connection = registry.connect(contextName);

      const [pods, services, endpoints] = await Promise.all([
        connection.json<{ items?: PodShape[] }>(`${scope}/pods?limit=500`),
        connection.json<{ items?: ServiceShape[] }>(`${scope}/services?limit=500`),
        // Which pod is actually behind each service. Without this a Service
        // row is a name with nothing to connect to.
        connection.json<{ items?: EndpointShape[] }>(`${scope}/endpoints?limit=500`).catch(() => ({ items: [] })),
      ]);

      const ready = new Map<string, string>();
      for (const endpoint of endpoints.items ?? []) {
        const pod = (endpoint.subsets ?? []).flatMap((subset) => subset.addresses ?? []).find((address) => address.targetRef?.name)
          ?.targetRef?.name;
        if (pod) ready.set(`${endpoint.metadata?.namespace}/${endpoint.metadata?.name}`, pod);
      }

      const running = (pods.items ?? []).filter((pod) => pod.status?.phase === 'Running');
      const targets: ForwardTarget[] = [];

      for (const service of services.items ?? []) {
        const name = service.metadata?.name ?? '';
        const ns = service.metadata?.namespace ?? '';
        // A headless service has no cluster IP to forward through, and
        // ExternalName has nothing in the cluster at all.
        if (service.spec?.type === 'ExternalName') continue;
        const pod = ready.get(`${ns}/${name}`);
        if (!pod) continue;
        const ports = describePorts(service.spec?.ports ?? [], 'service');
        if (ports.length === 0) continue;
        targets.push({ kind: 'Service', name, namespace: ns, pod, ports, hint: hintFor(ports) });
      }

      for (const pod of running) {
        const ports = describePorts(
          (pod.spec?.containers ?? []).flatMap((container) => container.ports ?? []),
          'pod',
        );
        if (ports.length === 0) continue;
        targets.push({
          kind: 'Pod',
          name: pod.metadata?.name ?? '',
          namespace: pod.metadata?.namespace ?? '',
          pod: pod.metadata?.name ?? '',
          ports,
          ...(ownerOf(pod) ? { workload: ownerOf(pod) } : {}),
          hint: hintFor(ports),
        });
      }

      log.debug('forward targets', { context: contextName, count: targets.length });
      res.json({ targets });
    }),
  );

  router.get(
    '/',
    handle(async (_req, res) => {
      res.json({ forwards: forwards.list() });
    }),
  );

  router.post(
    '/',
    handle(async (req, res) => {
      const body = req.body as Partial<{ context: string; namespace: string; pod: string; port: number; localPort: number }>;
      for (const key of ['context', 'namespace', 'pod'] as const) {
        if (typeof body[key] !== 'string' || !body[key]) throw HttpError.badRequest(`${key} is required`);
      }
      const port = Number(body.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw HttpError.badRequest('port must be 1–65535');
      const localPort = body.localPort === undefined ? undefined : Number(body.localPort);
      if (localPort !== undefined && (!Number.isInteger(localPort) || localPort < 0 || localPort > 65535)) {
        throw HttpError.badRequest('localPort must be 0–65535');
      }
      const record = await forwards.start({
        context: body.context as string,
        namespace: body.namespace as string,
        pod: body.pod as string,
        port,
        ...(localPort ? { localPort } : {}),
      });
      res.status(201).json(record);
    }),
  );

  router.delete(
    '/:id',
    handle(async (req, res) => {
      const id = decodeURIComponent(param(req, 'id'));
      if (!(await forwards.stop(id))) throw HttpError.notFound(`no forward ${id}`);
      res.json({ ok: true });
    }),
  );

  return router;
}

interface PodShape {
  metadata?: { name?: string; namespace?: string; ownerReferences?: Array<{ kind?: string; name?: string; controller?: boolean }> };
  spec?: { containers?: Array<{ ports?: PortShape[] }> };
  status?: { phase?: string };
}

interface ServiceShape {
  metadata?: { name?: string; namespace?: string };
  spec?: { type?: string; ports?: PortShape[] };
}

interface EndpointShape {
  metadata?: { name?: string; namespace?: string };
  subsets?: Array<{ addresses?: Array<{ targetRef?: { name?: string } }> }>;
}

/** The ports of a pod or a service, deduplicated and sorted. */
function describePorts(ports: readonly PortShape[], from: 'pod' | 'service'): Array<{ port: number; name?: string | undefined; protocol: string }> {
  const seen = new Map<number, { port: number; name?: string | undefined; protocol: string }>();
  for (const entry of ports) {
    // For a service, forwarding goes to the container port behind it, which
    // is `targetPort` when it is a number and the service port otherwise.
    const number =
      from === 'service'
        ? typeof entry.targetPort === 'number'
          ? entry.targetPort
          : (entry.port ?? 0)
        : (entry.containerPort ?? 0);
    if (!Number.isInteger(number) || number < 1) continue;
    // UDP cannot be forwarded by the Kubernetes API, so offering it would be
    // offering a button that always fails.
    if ((entry.protocol ?? 'TCP').toUpperCase() !== 'TCP') continue;
    if (!seen.has(number)) seen.set(number, { port: number, ...(entry.name ? { name: entry.name } : {}), protocol: 'TCP' });
  }
  return [...seen.values()].sort((a, b) => a.port - b.port);
}

function hintFor(ports: ReadonlyArray<{ port: number }>): string | undefined {
  for (const entry of ports) {
    const known = WELL_KNOWN[entry.port];
    if (known) return known;
  }
  return undefined;
}

function ownerOf(pod: PodShape): string | undefined {
  const owner = pod.metadata?.ownerReferences?.find((reference) => reference.controller) ?? pod.metadata?.ownerReferences?.[0];
  if (!owner?.name) return undefined;
  return owner.kind === 'ReplicaSet' ? owner.name.replace(/-[bcdfghjklmnpqrstvwxz2456789]{4,10}$/, '') : owner.name;
}
