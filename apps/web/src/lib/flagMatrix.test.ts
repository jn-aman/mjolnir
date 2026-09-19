import { describe, expect, it } from 'vitest';
import { evaluateAll, FLAGS } from '@mjolnir/flags';
import type { UnleashFeature } from '@mjolnir/flags';
import { rowMenuEntries } from '../components/RowMenu.tsx';
import { modules, clusterTools } from './tools.ts';
import type { KubeItem } from '../components/columns.tsx';

/**
 * Three people, three sets of flags, and what each of them can actually do.
 *
 * Flags are tested one at a time everywhere else, which misses the thing that
 * bites: combinations. A person on the free tier with the dock off and writes
 * on is a configuration nobody designed and somebody will have, and the
 * question is whether the app is coherent in it or merely does not crash.
 *
 * The rule each case asserts is the same one: **whatever is off is off
 * everywhere, and whatever is left still works.** A build that hides the
 * Logs button but leaves the row's log verb is not narrower, it is broken in
 * a way only that customer will find.
 */

const pod = (): KubeItem =>
  ({
    metadata: { name: 'web-1', namespace: 'shop' },
    spec: { nodeName: 'node-1', containers: [{ image: 'nginx:1.27' }] },
    status: {},
  }) as unknown as KubeItem;

const context = {
  userId: 'someone@example.com',
  sessionId: 'install-1',
  environment: 'production',
  appName: 'mjolnir',
  properties: {},
};

/** The server's own evaluation, so a case is what the app would really see. */
function resolve(remote: Record<string, boolean>, overrides: Record<string, boolean> = {}) {
  const features: Record<string, UnleashFeature> = Object.fromEntries(
    Object.entries(remote).map(([name, enabled]) => [name, { name, enabled, strategies: [{ name: 'default' }] }]),
  );
  const states = evaluateAll({ overrides, features, context });
  return Object.fromEntries(states.map((state) => [state.id, state.value]));
}

const verbs = (values: Record<string, boolean>) =>
  rowMenuEntries(pod(), 'Pod', () => {}, values)
    .filter((entry): entry is Extract<typeof entry, { id: string }> => entry.type !== 'separator' && entry.type !== 'heading')
    .map((entry) => entry.id);

describe('a customer on the default build', () => {
  const values = resolve({});

  it('gets every shipped feature and nothing unreleased', () => {
    for (const flag of FLAGS) {
      expect(values[flag.id], `${flag.id} does not match its build default`).toBe(flag.fallback);
    }
  });

  it('can read, write and reach a shell', () => {
    const found = verbs(values);
    for (const verb of ['open', 'logs', 'shell', 'yaml', 'delete', 'pin']) expect(found).toContain(verb);
  });

  it('sees the three shipped modules and no others', () => {
    expect(modules(values).map((tool) => tool.id).sort()).toEqual(['docker', 'storage']);
  });
});

describe('a customer given a read-only build', () => {
  // Everything that changes a cluster, off. The sort of thing an organisation
  // asks for before it will install anything at all.
  const values = resolve({}, {
    'kubernetes.edit': false,
    'kubernetes.exec': false,
    'docker.write': false,
    'storage.write': false,
    'assistant.writes': false,
  });

  it('offers no verb that changes anything', () => {
    const found = verbs(values);
    for (const verb of ['yaml', 'delete', 'shell', 'restart', 'scale']) expect(found).not.toContain(verb);
  });

  it('still reads everything, which is the point of the build', () => {
    const found = verbs(values);
    for (const verb of ['open', 'logs', 'copy-name', 'copy-kubectl']) expect(found).toContain(verb);
    expect(values['kubernetes.logs']).toBe(true);
    expect(values['ui.command-palette']).toBe(true);
    expect(values['kubernetes.metrics']).toBe(true);
  });

  it('leaves the dock, because a log you can read is a log you can keep', () => {
    expect(values['ui.dock']).toBe(true);
    expect(verbs(values)).toContain('pin');
  });
});

describe('a customer with the whole toolbox turned on', () => {
  const values = resolve(Object.fromEntries(FLAGS.map((flag) => [flag.id, true])));

  it('sees every module', () => {
    const ids = modules(values).map((tool) => tool.id).sort();
    expect(ids).toEqual(['alerts', 'cloud', 'database', 'docker', 'kafka', 'machines', 'storage']);
  });

  it('sees every cluster tool', () => {
    expect(clusterTools(values).length).toBeGreaterThanOrEqual(4);
  });

  it('offers every verb', () => {
    const found = verbs(values);
    for (const verb of ['open', 'pin', 'logs', 'shell', 'forward', 'scan', 'yaml', 'delete']) expect(found).toContain(verb);
  });
});

describe('combinations that nobody designed but somebody will have', () => {
  it('a dock that is off takes the pin with it and leaves logs readable', () => {
    const values = resolve({}, { 'ui.dock': false });
    const found = verbs(values);
    expect(found).not.toContain('pin');
    expect(found).toContain('logs');
  });

  it('logs off takes both log entries, and the dock survives for shells', () => {
    const values = resolve({}, { 'kubernetes.logs': false });
    const found = verbs(values);
    expect(found).not.toContain('logs');
    expect(found).not.toContain('logs-here');
    expect(found).toContain('shell');
  });

  it('a local switch beats the server, in both directions', () => {
    expect(resolve({ 'kubernetes.edit': false })['kubernetes.edit']).toBe(false);
    expect(resolve({ 'kubernetes.edit': false }, { 'kubernetes.edit': true })['kubernetes.edit']).toBe(true);
    expect(resolve({ 'module.cloud': true }, { 'module.cloud': false })['module.cloud']).toBe(false);
  });

  it('a server that says nothing leaves the build in charge', () => {
    const values = resolve({});
    for (const flag of FLAGS) expect(values[flag.id]).toBe(flag.fallback);
  });

  it('a toggle Unleash has switched off is off, whatever its strategies say', () => {
    const features: Record<string, UnleashFeature> = {
      'kubernetes.edit': { name: 'kubernetes.edit', enabled: false, strategies: [{ name: 'default' }] },
    };
    const states = evaluateAll({ overrides: {}, features, context });
    expect(states.find((state) => state.id === 'kubernetes.edit')?.value).toBe(false);
  });

  it('turning everything off never leaves the app without a way to look at a row', () => {
    const values = resolve(Object.fromEntries(FLAGS.map((flag) => [flag.id, false])));
    const found = verbs(values);
    // Whatever else goes, opening an object and copying its name remain.
    expect(found).toContain('open');
    expect(found).toContain('copy-name');
  });
});
