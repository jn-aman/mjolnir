/**
 * Every image running in a cluster, and who runs it.
 *
 * Scanning images one at a time answers "is this image safe". The question
 * people actually have is "what in my cluster is exposed", and those differ in
 * a way that matters: forty pods can run one image, one image can be run by
 * two teams, and a vulnerability list keyed by image tells you nothing about
 * which of your deployments to fix first.
 *
 * So the unit here is the image, and every image carries the workloads that
 * run it. That inversion is the whole feature. It is also why a scan of a
 * cluster is far cheaper than it looks: a hundred pods usually run fifteen
 * distinct images.
 *
 * ## Tags versus digests
 *
 * The identity of a running image is its digest, not its tag. Two pods on
 * `:latest` scheduled a week apart can be running different code, and a
 * report that merged them would be quietly wrong about one of them. The
 * digest comes from `imageID` in the container status, which is what the
 * kubelet actually pulled. The tag is kept for display, because nobody talks
 * about their deployments in sha256.
 */

import type { PodObject } from './diagnose.ts';
import { workloadOf } from './diagnose.ts';

export interface ImageUser {
  readonly kind: string;
  readonly name: string;
  readonly namespace?: string | undefined;
  /** How many pods of this workload run it. */
  readonly pods: number;
}

export interface ImageEntry {
  /** The reference as written in the spec, which is what people recognise. */
  readonly image: string;
  /** What the kubelet actually pulled, when it says. This is the real identity. */
  readonly digest?: string | undefined;
  readonly registry: string;
  readonly repository: string;
  readonly tag: string;
  /** Total pods running it, across every workload. */
  readonly pods: number;
  readonly namespaces: readonly string[];
  readonly usedBy: readonly ImageUser[];
  /** True when it is only ever an init container: different risk, different urgency. */
  readonly initOnly: boolean;
  /**
   * True when the spec names a mutable tag.
   *
   * A scan of `:latest` is a statement about the digest that was pulled, not
   * about the tag, and next week's pod may differ. Worth saying, because a
   * clean scan against a moving tag is a weaker promise than it looks.
   */
  readonly mutableTag: boolean;
}

export interface ImageInventory {
  readonly images: readonly ImageEntry[];
  readonly pods: number;
  readonly namespaces: number;
}

/** Tags that move under you. `latest` is the famous one and not the only one. */
const MUTABLE = new Set(['latest', 'main', 'master', 'edge', 'nightly', 'dev', 'develop', 'stable', 'release']);

export function imageInventory(pods: readonly PodObject[]): ImageInventory {
  const entries = new Map<string, {
    image: string;
    digest?: string;
    pods: Set<string>;
    namespaces: Set<string>;
    users: Map<string, ImageUser>;
    init: boolean;
    run: boolean;
  }>();

  const namespaces = new Set<string>();
  let counted = 0;

  for (const pod of pods) {
    // A pod that has finished is not exposure. Its image may well still be
    // running elsewhere, and if it is, that pod contributes it.
    const phase = pod.status?.phase ?? '';
    if (phase === 'Succeeded' || phase === 'Failed') continue;
    counted += 1;

    const namespace = pod.metadata?.namespace ?? '';
    const podName = pod.metadata?.name ?? '';
    if (namespace) namespaces.add(namespace);
    const workload = workloadOf(pod);

    const statuses = new Map(
      [...(pod.status?.containerStatuses ?? []), ...(pod.status?.initContainerStatuses ?? [])].map((status) => [
        status.name ?? '',
        status,
      ]),
    );
    const initNames = new Set((pod.status?.initContainerStatuses ?? []).map((status) => status.name ?? ''));
    const specContainers = pod.spec?.containers ?? [];

    // The spec is the source of truth for what is meant to run; the status
    // says what is actually running. Both are needed: a container that has
    // not started yet has no status and still counts as exposure.
    for (const container of specContainers) {
      const image = container.image ?? statuses.get(container.name ?? '')?.image ?? '';
      if (!image) continue;
      const digest = digestOf(statuses.get(container.name ?? '')?.imageID, image);
      const key = digest ?? image;

      const entry = entries.get(key) ?? {
        image,
        ...(digest ? { digest } : {}),
        pods: new Set<string>(),
        namespaces: new Set<string>(),
        users: new Map<string, ImageUser>(),
        init: false,
        run: false,
      };
      entry.pods.add(`${namespace}/${podName}`);
      if (namespace) entry.namespaces.add(namespace);
      if (initNames.has(container.name ?? '')) entry.init = true;
      else entry.run = true;

      const userKey = `${workload.kind}/${namespace}/${workload.name}`;
      const existing = entry.users.get(userKey);
      entry.users.set(userKey, {
        kind: workload.kind,
        name: workload.name,
        namespace,
        pods: (existing?.pods ?? 0) + 1,
      });
      entries.set(key, entry);
    }
  }

  const images = [...entries.values()]
    .map((entry) => {
      const parsed = parseReference(entry.image);
      return {
        image: entry.image,
        ...(entry.digest ? { digest: entry.digest } : {}),
        registry: parsed.registry,
        repository: parsed.repository,
        tag: parsed.tag,
        pods: entry.pods.size,
        namespaces: [...entry.namespaces].sort(),
        usedBy: [...entry.users.values()].sort((a, b) => b.pods - a.pods || a.name.localeCompare(b.name)),
        initOnly: entry.init && !entry.run,
        mutableTag: MUTABLE.has(parsed.tag) || parsed.tag === '',
      };
    })
    // Most widely run first: an image on thirty pods is a bigger problem than
    // the same finding on one.
    .sort((a, b) => b.pods - a.pods || a.image.localeCompare(b.image));

  return { images, pods: counted, namespaces: namespaces.size };
}

/**
 * The digest the kubelet recorded, if it recorded one.
 *
 * `imageID` comes back in several shapes depending on the runtime:
 * `docker-pullable://repo@sha256:...`, a bare `sha256:...`, or the repository
 * with a digest attached. Only a `sha256:` is worth keeping, and only when the
 * spec did not already pin one.
 */
function digestOf(imageId: string | undefined, spec: string): string | undefined {
  const pinned = /@(sha256:[a-f0-9]{64})/.exec(spec)?.[1];
  if (pinned) return pinned;
  if (!imageId) return undefined;
  return /(sha256:[a-f0-9]{64})/.exec(imageId)?.[1];
}

/**
 * An image reference, split the way Docker actually splits it.
 *
 * The rule people get wrong: the first segment is a registry only if it looks
 * like a host, meaning it contains a dot or a colon, or is exactly
 * `localhost`. Without that, `library/nginx` reads as registry `library`, and
 * `nginx` reads as having no repository at all.
 */
export function parseReference(reference: string): { registry: string; repository: string; tag: string } {
  const withoutDigest = reference.split('@')[0] ?? reference;
  const slash = withoutDigest.indexOf('/');
  const first = slash === -1 ? '' : withoutDigest.slice(0, slash);
  const hasRegistry = first.includes('.') || first.includes(':') || first === 'localhost';

  const registry = hasRegistry ? first : 'docker.io';
  const rest = hasRegistry ? withoutDigest.slice(slash + 1) : withoutDigest;

  // A colon after the last slash is a tag; one before it is a port.
  const lastSlash = rest.lastIndexOf('/');
  const colon = rest.indexOf(':', lastSlash + 1);
  const repository = colon === -1 ? rest : rest.slice(0, colon);
  const tag = colon === -1 ? (reference.includes('@') ? '' : 'latest') : rest.slice(colon + 1);

  return { registry, repository, tag };
}

/**
 * What to hand Trivy.
 *
 * The digest, when there is one, because that is the thing actually running.
 * Scanning `app:latest` a week after the pod started scans whatever `latest`
 * means today, which may not be what is in the cluster, and a report about the
 * wrong image is worse than no report.
 */
export function scanTarget(entry: ImageEntry): string {
  if (!entry.digest) return entry.image;
  if (entry.image.includes('@')) return entry.image;
  const prefix = entry.registry === 'docker.io' ? '' : `${entry.registry}/`;
  return `${prefix}${entry.repository}@${entry.digest}`;
}
