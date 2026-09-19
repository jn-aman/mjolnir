import { describe, expect, it } from 'vitest';
import { imageInventory, parseReference, scanTarget } from './images.ts';
import type { PodObject } from './diagnose.ts';

/**
 * The inventory, against pods shaped the way a cluster shapes them.
 *
 * The interesting cases are all about identity: two pods on the same tag
 * running different digests, an image named in the spec that has not started
 * and so has no status, and the reference-parsing rule that everyone gets
 * wrong.
 */

function pod(input: {
  name: string;
  namespace?: string;
  owner?: string;
  phase?: string;
  containers: Array<{ name: string; image: string; imageID?: string }>;
  init?: Array<{ name: string; image: string; imageID?: string }>;
}): PodObject {
  return {
    metadata: {
      name: input.name,
      namespace: input.namespace ?? 'shop',
      ...(input.owner ? { ownerReferences: [{ kind: 'ReplicaSet', name: input.owner, controller: true }] } : {}),
    },
    spec: {
      containers: input.containers.map((container) => ({ name: container.name, image: container.image })),
    },
    status: {
      phase: input.phase ?? 'Running',
      containerStatuses: input.containers.map((container) => ({
        name: container.name,
        // Two different fields, as the kubelet writes them: `image` echoes
        // the spec, `imageID` carries the digest.
        image: container.image,
        ...(container.imageID ? { imageID: container.imageID } : {}),
      })),
      ...(input.init
        ? { initContainerStatuses: input.init.map((container) => ({ name: container.name, image: container.imageID ?? container.image })) }
        : {}),
    },
    ...(input.init ? {} : {}),
  };
}

describe('what is running', () => {
  it('counts one image once, however many pods run it', () => {
    const inventory = imageInventory([
      pod({ name: 'api-a', owner: 'api-7c9f', containers: [{ name: 'api', image: 'ghcr.io/acme/api:v2' }] }),
      pod({ name: 'api-b', owner: 'api-7c9f', containers: [{ name: 'api', image: 'ghcr.io/acme/api:v2' }] }),
      pod({ name: 'api-c', owner: 'api-7c9f', containers: [{ name: 'api', image: 'ghcr.io/acme/api:v2' }] }),
    ]);

    expect(inventory.images).toHaveLength(1);
    expect(inventory.images[0]?.pods).toBe(3);
    // And it knows whose it is, which is the thing a per-image scan cannot say.
    expect(inventory.images[0]?.usedBy).toEqual([{ kind: 'Deployment', name: 'api', namespace: 'shop', pods: 3 }]);
    expect(inventory.pods).toBe(3);
  });

  it('keeps two digests apart even when the tag is the same', () => {
    const inventory = imageInventory([
      pod({
        name: 'old',
        owner: 'web-5d4b',
        containers: [{ name: 'web', image: 'acme/web:latest', imageID: `docker-pullable://acme/web@sha256:${'a'.repeat(64)}` }],
      }),
      pod({
        name: 'new',
        owner: 'web-7c9f',
        containers: [{ name: 'web', image: 'acme/web:latest', imageID: `docker-pullable://acme/web@sha256:${'b'.repeat(64)}` }],
      }),
    ]);

    // Same tag, a week apart, different code. Merging them would make the
    // report quietly wrong about one of the two.
    expect(inventory.images).toHaveLength(2);
    expect(new Set(inventory.images.map((entry) => entry.digest)).size).toBe(2);
    expect(inventory.images.every((entry) => entry.mutableTag)).toBe(true);
  });

  it('includes a container named in the spec that has not started yet', () => {
    const inventory = imageInventory([
      {
        metadata: { name: 'pending', namespace: 'shop' },
        spec: { containers: [{ name: 'api', image: 'ghcr.io/acme/api:v3' }] },
        status: { phase: 'Pending' },
      },
    ]);
    // It is about to run, so it is exposure. A status-only reading misses it.
    expect(inventory.images[0]?.image).toBe('ghcr.io/acme/api:v3');
  });

  it('leaves out pods that have finished, because they are not running anything', () => {
    const inventory = imageInventory([
      pod({ name: 'job-done', phase: 'Succeeded', containers: [{ name: 'job', image: 'acme/job:v1' }] }),
      pod({ name: 'job-failed', phase: 'Failed', containers: [{ name: 'job', image: 'acme/job:v1' }] }),
    ]);
    expect(inventory.images).toEqual([]);
    expect(inventory.pods).toBe(0);
  });

  it('gathers one image used by two teams under both of them', () => {
    const inventory = imageInventory([
      pod({ name: 'a-1', namespace: 'shop', owner: 'a-5d4b', containers: [{ name: 'c', image: 'acme/base:v1' }] }),
      pod({ name: 'b-1', namespace: 'billing', owner: 'b-7c9f', containers: [{ name: 'c', image: 'acme/base:v1' }] }),
      pod({ name: 'b-2', namespace: 'billing', owner: 'b-7c9f', containers: [{ name: 'c', image: 'acme/base:v1' }] }),
    ]);

    const entry = inventory.images[0]!;
    expect(entry.namespaces).toEqual(['billing', 'shop']);
    // Widest user first, because that is where a fix buys the most.
    expect(entry.usedBy.map((use) => `${use.name}:${use.pods}`)).toEqual(['b:2', 'a:1']);
    expect(inventory.namespaces).toBe(2);
  });

  it('puts the most widely run image at the top', () => {
    const inventory = imageInventory([
      pod({ name: 'rare', owner: 'rare-5d4b', containers: [{ name: 'c', image: 'acme/rare:v1' }] }),
      pod({ name: 'common-a', owner: 'common-5d4b', containers: [{ name: 'c', image: 'acme/common:v1' }] }),
      pod({ name: 'common-b', owner: 'common-5d4b', containers: [{ name: 'c', image: 'acme/common:v1' }] }),
    ]);
    expect(inventory.images[0]?.image).toBe('acme/common:v1');
  });
});

describe('reading an image reference', () => {
  it('only treats the first segment as a registry when it looks like a host', () => {
    // The rule everyone gets wrong: `library` is not a registry.
    expect(parseReference('library/nginx:1.25')).toEqual({ registry: 'docker.io', repository: 'library/nginx', tag: '1.25' });
    expect(parseReference('nginx')).toEqual({ registry: 'docker.io', repository: 'nginx', tag: 'latest' });
    expect(parseReference('ghcr.io/acme/api:v2')).toEqual({ registry: 'ghcr.io', repository: 'acme/api', tag: 'v2' });
    expect(parseReference('localhost:5000/api:dev')).toEqual({ registry: 'localhost:5000', repository: 'api', tag: 'dev' });
  });

  it('tells a registry port from a tag', () => {
    expect(parseReference('registry.internal:5000/team/api:v1.2.3')).toEqual({
      registry: 'registry.internal:5000',
      repository: 'team/api',
      tag: 'v1.2.3',
    });
  });

  it('handles a reference pinned to a digest', () => {
    const digest = `sha256:${'c'.repeat(64)}`;
    expect(parseReference(`ghcr.io/acme/api@${digest}`)).toEqual({ registry: 'ghcr.io', repository: 'acme/api', tag: '' });
  });
});

describe('what gets scanned', () => {
  it('scans the digest that is running, not whatever the tag means today', () => {
    const digest = `sha256:${'d'.repeat(64)}`;
    const inventory = imageInventory([
      pod({ name: 'web', owner: 'web-5d4b', containers: [{ name: 'web', image: 'ghcr.io/acme/web:latest', imageID: `ghcr.io/acme/web@${digest}` }] }),
    ]);
    expect(scanTarget(inventory.images[0]!)).toBe(`ghcr.io/acme/web@${digest}`);
  });

  it('drops the implicit docker.io so the reference stays the one people wrote', () => {
    const digest = `sha256:${'e'.repeat(64)}`;
    const inventory = imageInventory([
      pod({ name: 'r', owner: 'r-5d4b', containers: [{ name: 'c', image: 'redis:7', imageID: `docker-pullable://redis@${digest}` }] }),
    ]);
    expect(scanTarget(inventory.images[0]!)).toBe(`redis@${digest}`);
  });

  it('falls back to the tag when the runtime recorded no digest', () => {
    const inventory = imageInventory([pod({ name: 'x', owner: 'x-5d4b', containers: [{ name: 'c', image: 'acme/x:v1' }] })]);
    expect(scanTarget(inventory.images[0]!)).toBe('acme/x:v1');
  });
});
