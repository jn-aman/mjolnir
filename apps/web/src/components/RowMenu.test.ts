import { describe, expect, it } from 'vitest';
import { rowMenuEntries, type RowActionId } from './RowMenu.tsx';
import type { KubeItem } from './columns.tsx';

/**
 * Flags decide which verbs a row offers.
 *
 * The entry list is a pure function precisely so this can be asserted: the
 * right-click menu and the row's own buttons both read it, so a verb that is
 * off has to be off in both and there is no second place for it to survive.
 */
const pod = (): KubeItem =>
  ({
    metadata: { name: 'web-abc', namespace: 'shop' },
    spec: { nodeName: 'node-1', containers: [{ image: 'nginx:1.27' }] },
    status: {},
  }) as unknown as KubeItem;

const ids = (item: KubeItem, kind: string, flags?: Record<string, boolean>) =>
  rowMenuEntries(item, kind, () => {}, flags)
    .filter((entry): entry is Extract<typeof entry, { id: string }> => entry.type !== 'separator' && entry.type !== 'heading')
    .map((entry) => entry.id);

describe('rowMenuEntries', () => {
  it('offers everything when no flags are given', () => {
    const found = ids(pod(), 'Pod');
    for (const verb of ['open', 'pin', 'logs', 'shell', 'forward', 'scan', 'yaml', 'delete']) {
      expect(found).toContain(verb);
    }
  });

  it('drops the shell when exec is off, and keeps the rest', () => {
    const found = ids(pod(), 'Pod', { 'kubernetes.exec': false });
    expect(found).not.toContain('shell');
    expect(found).toContain('logs');
    expect(found).toContain('open');
  });

  it('drops every write verb when editing is off', () => {
    const found = ids(pod(), 'Pod', { 'kubernetes.edit': false });
    for (const verb of ['yaml', 'delete']) expect(found).not.toContain(verb);
    // Reading is untouched: that is the point of the flag.
    expect(found).toContain('open');
    expect(found).toContain('logs');
  });

  it('drops restart, scale and the rollout verbs on a Deployment', () => {
    const deployment = { metadata: { name: 'web', namespace: 'shop' }, spec: {}, status: {} } as unknown as KubeItem;
    expect(ids(deployment, 'Deployment')).toEqual(expect.arrayContaining(['restart', 'scale', 'pause', 'undo']));
    const off = ids(deployment, 'Deployment', { 'kubernetes.edit': false });
    for (const verb of ['restart', 'scale', 'pause', 'undo', 'delete']) expect(off).not.toContain(verb);
  });

  it('drops cordon, drain and taint on a Node', () => {
    const node = { metadata: { name: 'node-1' }, spec: {}, status: {} } as unknown as KubeItem;
    expect(ids(node, 'Node')).toEqual(expect.arrayContaining(['cordon', 'drain', 'taint']));
    const off = ids(node, 'Node', { 'kubernetes.edit': false });
    for (const verb of ['cordon', 'drain', 'taint']) expect(off).not.toContain(verb);
  });

  it('takes the dock entries away with the dock', () => {
    const found = ids(pod(), 'Pod', { 'ui.dock': false });
    expect(found).not.toContain('pin');
    expect(found).not.toContain('dock-logs');
    expect(found).toContain('logs');
  });

  it('takes dock-logs with the logs, not only with the dock', () => {
    const found = ids(pod(), 'Pod', { 'kubernetes.logs': false });
    expect(found).not.toContain('logs');
    expect(found).not.toContain('dock-logs');
  });

  it('drops the scan when image scanning is off', () => {
    expect(ids(pod(), 'Pod', { 'scan.images': false })).not.toContain('scan');
  });

  it('drops the filter shortcuts when filters are off', () => {
    const found = ids(pod(), 'Pod', { 'ui.filters': false });
    expect(found).not.toContain('filter-namespace');
    expect(found).not.toContain('filter-node');
  });

  it('never drops copy, which is not a feature anyone gates', () => {
    const found = ids(pod(), 'Pod', {
      'kubernetes.edit': false,
      'kubernetes.exec': false,
      'kubernetes.logs': false,
      'ui.dock': false,
      'ui.filters': false,
      'scan.images': false,
    });
    expect(found).toContain('copy-name');
    expect(found).toContain('copy-kubectl');
    expect(found).toContain('open');
  });
});

/** The act() ids the menu can produce are the ones the screen handles. */
describe('RowActionId', () => {
  it('covers every id the menu emits', () => {
    const emitted = new Set(ids(pod(), 'Pod').concat(ids({ metadata: { name: 'n' }, spec: {}, status: {} } as unknown as KubeItem, 'Node')));
    const handled: RowActionId[] = [
      'open', 'pin', 'logs', 'dock-logs', 'forward', 'shell', 'yaml', 'restart', 'scale',
      'filter-namespace', 'filter-node', 'cordon', 'uncordon', 'drain', 'taint', 'pause', 'resume', 'undo', 'delete',
    ];
    const extras = [...emitted].filter((id) => !handled.includes(id as RowActionId) && !id.startsWith('copy-') && id !== 'ask' && id !== 'scan');
    expect(extras).toEqual([]);
  });
});
