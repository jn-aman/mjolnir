import { describe, expect, it } from 'vitest';
import { changesBetween, explainChange, redact, RevisionStore } from './history.ts';

/**
 * The revision window.
 *
 * Most of these are about what must *not* be kept. A history that records
 * every informer update fills with churn in minutes and buries the one change
 * anybody wanted, and it does it invisibly: memory goes up and the feature
 * still looks like it works.
 */

const deployment = (overrides: Record<string, unknown> = {}) => ({
  kind: 'Deployment',
  metadata: { name: 'api', namespace: 'shop', resourceVersion: '100', generation: 4 },
  spec: { replicas: 3, template: { spec: { containers: [{ name: 'api', image: 'acme/api:v2' }] } } },
  status: { readyReplicas: 3, observedGeneration: 4 },
  ...overrides,
});

const KEY = RevisionStore.key('prod', 'Deployment', 'shop', 'api');

describe('what gets kept', () => {
  it('keeps the first sight of an object', () => {
    const store = new RevisionStore();
    expect(store.record(KEY, deployment())).toBe(true);
    expect(store.revisions(KEY)).toHaveLength(1);
    expect(store.revisions(KEY)[0]?.kind).toBe('created');
  });

  it('ignores a version where only the resourceVersion moved', () => {
    const store = new RevisionStore();
    store.record(KEY, deployment());
    // Every write anywhere in a cluster can move this. Recording it would
    // fill an hour's window in about a minute.
    expect(store.record(KEY, deployment({ metadata: { name: 'api', namespace: 'shop', resourceVersion: '101', generation: 4 } }))).toBe(false);
    expect(store.revisions(KEY)).toHaveLength(1);
  });

  it('ignores a heartbeat, which is what a Lease is made of', () => {
    const store = new RevisionStore();
    const lease = (time: string) => ({ kind: 'Lease', metadata: { name: 'l' }, spec: { renewTime: time, holderIdentity: 'node-1' } });
    store.record('prod/Lease//l', lease('2026-09-19T10:00:00Z'));
    expect(store.record('prod/Lease//l', lease('2026-09-19T10:00:10Z'))).toBe(false);
  });

  it('keeps a change somebody actually made', () => {
    const store = new RevisionStore();
    store.record(KEY, deployment());
    expect(store.record(KEY, deployment({ spec: { replicas: 5, template: { spec: { containers: [{ name: 'api', image: 'acme/api:v2' }] } } } }))).toBe(true);
    expect(store.revisions(KEY)).toHaveLength(2);
    expect(store.revisions(KEY)[1]?.kind).toBe('changed');
  });

  it('records a deletion, because an object vanishing is the change you want', () => {
    const store = new RevisionStore();
    store.record(KEY, deployment());
    expect(store.record(KEY, deployment(), 'deleted')).toBe(true);
    expect(store.revisions(KEY).at(-1)?.kind).toBe('deleted');
  });
});

describe('the limits, which are the whole reason this is affordable', () => {
  it('keeps only the most recent versions of one object', () => {
    const store = new RevisionStore({ perObject: 3 });
    for (let replicas = 1; replicas <= 6; replicas += 1) {
      store.record(KEY, deployment({ spec: { replicas } }));
    }
    const kept = store.revisions(KEY);
    expect(kept).toHaveLength(3);
    // The newest three, so the oldest is replicas 4.
    expect((kept[0]?.object as { spec: { replicas: number } }).spec.replicas).toBe(4);
  });

  it('drops the least recently touched object when too many are tracked', () => {
    const store = new RevisionStore({ objects: 2 });
    store.record('prod/Pod//a', { kind: 'Pod', metadata: { name: 'a' } });
    store.record('prod/Pod//b', { kind: 'Pod', metadata: { name: 'b' } });
    // Touching a again makes b the oldest, which is what makes this an LRU
    // rather than a queue: the object being watched should not be evicted.
    store.record('prod/Pod//a', { kind: 'Pod', metadata: { name: 'a', labels: { x: '1' } } });
    store.record('prod/Pod//c', { kind: 'Pod', metadata: { name: 'c' } });

    expect(store.size).toBe(2);
    expect(store.revisions('prod/Pod//b')).toHaveLength(0);
    expect(store.revisions('prod/Pod//a')).not.toHaveLength(0);
  });

  it('forgets anything older than the window', () => {
    let now = 1_000_000;
    const store = new RevisionStore({ windowMs: 60_000, now: () => now });
    store.record(KEY, deployment());
    now += 120_000;
    store.record(KEY, deployment({ spec: { replicas: 9 } }));
    // An app left open overnight must not be holding last night's cluster.
    expect(store.revisions(KEY)).toHaveLength(1);
  });

  it('drops a whole cluster when it goes away', () => {
    const store = new RevisionStore();
    store.record('prod/Pod//a', { kind: 'Pod', metadata: { name: 'a' } });
    store.record('staging/Pod//a', { kind: 'Pod', metadata: { name: 'a' } });
    store.forget('prod');
    expect(store.revisions('prod/Pod//a')).toHaveLength(0);
    expect(store.revisions('staging/Pod//a')).toHaveLength(1);
  });
});

describe('what changed between two versions', () => {
  it('reports additions and removals, not only edits', () => {
    // Unlike drift, which asks "has what I declared changed" and so walks one
    // direction only. Here a field the controller added is as interesting as
    // one it took away.
    const changes = changesBetween({ a: 1, gone: true }, { a: 2, added: 'yes' });
    expect(changes).toEqual([
      { path: 'a', before: 1, after: 2, kind: 'changed' },
      { path: 'gone', before: true, after: undefined, kind: 'removed' },
      { path: 'added', before: undefined, after: 'yes', kind: 'added' },
    ]);
  });

  it('says nothing about the fields that move on their own', () => {
    const before = { metadata: { resourceVersion: '1', managedFields: [{ time: 'a' }] }, status: { observedGeneration: 1 } };
    const after = { metadata: { resourceVersion: '2', managedFields: [{ time: 'b' }] }, status: { observedGeneration: 2 } };
    expect(changesBetween(before, after)).toEqual([]);
  });

  it('walks into arrays by position, so a changed container is one change', () => {
    const changes = changesBetween(
      { containers: [{ name: 'api', image: 'v1' }] },
      { containers: [{ name: 'api', image: 'v2' }] },
    );
    expect(changes).toEqual([{ path: 'containers[0].image', before: 'v1', after: 'v2', kind: 'changed' }]);
  });

  it('gives the diff between two consecutive versions of one object', () => {
    const store = new RevisionStore();
    store.record(KEY, deployment());
    store.record(KEY, deployment({ spec: { replicas: 5, template: { spec: { containers: [{ name: 'api', image: 'acme/api:v3' }] } } } }));

    const diff = store.diff(KEY, 1);
    expect(diff.map((change) => change.path)).toEqual([
      'spec.replicas',
      'spec.template.spec.containers[0].image',
    ]);
  });
});

describe('what is not held in memory', () => {
  it('keeps a secret\'s keys and throws away its values', () => {
    const kept = redact({ kind: 'Secret', data: { password: 'aGVsbG8=', token: 'd29ybGQ=' } });
    // "Somebody added a key to this secret" is the change worth seeing. The
    // value is not, and twenty versions of every secret in a cluster is not a
    // feature anybody asked for.
    expect(kept['data']).toEqual({ password: '(not kept)', token: '(not kept)' });
  });

  it('leaves everything else alone', () => {
    const object = { kind: 'ConfigMap', data: { LOG_LEVEL: 'debug' } };
    expect(redact(object)).toBe(object);
  });

  it('stores the redacted copy, not the original', () => {
    const store = new RevisionStore();
    store.record('prod/Secret/shop/db', { kind: 'Secret', metadata: { name: 'db' }, data: { password: 'aGVsbG8=' } });
    expect(JSON.stringify(store.revisions('prod/Secret/shop/db'))).not.toContain('aGVsbG8=');
  });
});

describe('saying what a change means', () => {
  it('explains a scale, including the one that stops it serving', () => {
    expect(explainChange({ path: 'spec.replicas', before: 2, after: 5, kind: 'changed' })).toContain('Scaled up from 2 to 5');
    expect(explainChange({ path: 'spec.replicas', before: 3, after: 0, kind: 'changed' })).toContain('stops it serving without deleting it');
  });

  it('calls an image change what it is', () => {
    const note = explainChange({ path: 'spec.template.spec.containers[0].image', before: 'v1', after: 'v2', kind: 'changed' });
    expect(note).toContain('This is a deploy');
    expect(note).toContain('everything after it is downstream');
  });

  it('says nothing rather than something empty for an ordinary field', () => {
    expect(explainChange({ path: 'metadata.labels.team', before: 'a', after: 'b', kind: 'changed' })).toBeUndefined();
  });
});

describe('one thing happening is one entry', () => {
  it('folds a rollout settling into a single revision', () => {
    let now = 1_000_000;
    const store = new RevisionStore({ now: () => now });
    const withStatus = (replicas: number, ready: number) =>
      deployment({ spec: { replicas }, status: { readyReplicas: ready, replicas: ready } });

    store.record(KEY, withStatus(2, 2));
    now += 1_000;
    // Somebody scales it. That is the entry worth keeping.
    store.record(KEY, withStatus(5, 2));
    now += 1_000;
    // Then status catches up over a few seconds, which is one thing.
    for (const ready of [3, 4, 5]) {
      now += 1_000;
      store.record(KEY, withStatus(5, ready));
    }

    const kept = store.revisions(KEY);
    expect(kept.map((revision) => revision.origin)).toEqual(['spec', 'spec', 'status']);
    // The change somebody made is still there, not evicted by its own
    // consequences, and the settle reads as one event.
    expect(kept).toHaveLength(3);
  });

  it('does not fold two settles that are far apart', () => {
    let now = 1_000_000;
    const store = new RevisionStore({ settleMs: 5_000, now: () => now });
    store.record(KEY, deployment({ status: { readyReplicas: 3 } }));
    now += 1_000;
    store.record(KEY, deployment({ status: { readyReplicas: 2 } }));
    now += 60_000;
    store.record(KEY, deployment({ status: { readyReplicas: 1 } }));

    // An hour apart is two incidents, however similar they look.
    expect(store.revisions(KEY)).toHaveLength(3);
  });

  it('marks a change somebody made as one somebody made', () => {
    const store = new RevisionStore();
    store.record(KEY, deployment());
    store.record(KEY, deployment({ spec: { replicas: 9 } }));
    expect(store.revisions(KEY).at(-1)?.origin).toBe('spec');
  });
});
