import { describe, expect, it } from 'vitest';
import type { ResourceDefinition } from '@mjolnir/k8s';
import { warmSnapshot } from './watch-wait.ts';
import type { ClusterConnection } from './clusters.ts';

/**
 * Waiting for a watch cache to be full rather than for it to be filling.
 *
 * Two bugs met here and both were invisible. The watch reported `synced` the
 * moment its connection was made, before the initial list had been replayed
 * into the cache; and the code that waited for it polled *while* the state was
 * `connecting`, which a brand new watch is not yet. Between them, the first
 * request after a start got "synced, nothing here" and every request after
 * that was correct, so the failure never reproduced when anybody looked.
 */

const SECRET: ResourceDefinition = {
  kind: 'Secret',
  group: '',
  version: 'v1',
  plural: 'secrets',
  namespaced: true,
  category: 'config',
  label: 'Secret',
  aliases: [],
};

/** A watch that reaches `synced` after a given number of reads. */
function connection(script: Array<{ state: string; items: unknown[] }>): ClusterConnection {
  let read = 0;
  return {
    watch: () => ({
      snapshot: () => script[Math.min(read++, script.length - 1)],
    }),
  } as unknown as ClusterConnection;
}

describe('warming a watch', () => {
  it('waits through idle and connecting for the list to land', async () => {
    const snapshot = await warmSnapshot(
      connection([
        // A new watch is idle before it is connecting, which is why waiting
        // "while connecting" returned instantly with nothing.
        { state: 'idle', items: [] },
        { state: 'connecting', items: [] },
        { state: 'connecting', items: [] },
        { state: 'synced', items: [{ name: 'a' }, { name: 'b' }] },
      ]),
      SECRET,
      'shop',
    );

    expect(snapshot.state).toBe('synced');
    expect(snapshot.items).toHaveLength(2);
  });

  it('returns at once when the cache is already good', async () => {
    const started = Date.now();
    const snapshot = await warmSnapshot(connection([{ state: 'synced', items: [{ name: 'a' }] }]), SECRET);
    expect(snapshot.items).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('does not wait on a watch that has failed', async () => {
    // An error is an answer. Waiting for it to become synced would hang every
    // request against a cluster this token cannot read.
    const snapshot = await warmSnapshot(connection([{ state: 'error', items: [] }]), SECRET);
    expect(snapshot.state).toBe('error');
  });

  it('gives up rather than hanging a request on a slow cluster', async () => {
    const started = Date.now();
    const snapshot = await warmSnapshot(connection([{ state: 'connecting', items: [] }]), SECRET, 'shop', 200);
    expect(snapshot.state).toBe('connecting');
    // The caller gets what arrived, and the state says it is not the whole
    // story, which is better than a request that never comes back.
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
