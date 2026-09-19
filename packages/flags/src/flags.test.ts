import { describe, expect, it } from 'vitest';
import { murmur3, normalise } from './hash.ts';
import { evaluateFeature, type UnleashContext, type UnleashFeature } from './unleash.ts';
import { evaluateAll } from './evaluate.ts';

const context: UnleashContext = {
  userId: 'install-abc',
  sessionId: 'session-1',
  environment: 'production',
  appName: 'mjolnir',
  properties: { platform: 'darwin', version: '0.1.0', channel: 'stable' },
};

describe('murmur3', () => {
  // Values from an independent reference implementation. If these drift, a
  // percentage rollout puts this machine on a different side to every other
  // Unleash client, which is the one bug nobody notices until it matters.
  it.each([
    ['', 0],
    ['hello', 613153351],
    ['Hello, world!', 3224780355],
    ['mjolnir', 1001828874],
    ['kubernetes.time-travel:abc-123', 2261030663],
    ['a', 1009084850],
    ['ab', 2613040991],
    ['abc', 3017643002],
    ['abcd', 1139631978],
  ])('hashes %j', (input, expected) => {
    expect(murmur3(input)).toBe(expected);
  });

  it('normalises into 1..100', () => {
    for (let i = 0; i < 500; i += 1) {
      const value = normalise(`install-${i}`, 'some.flag');
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('puts roughly the right share inside a rollout', () => {
    const inside = Array.from({ length: 2000 }, (_, i) => normalise(`install-${i}`, 'some.flag')).filter((v) => v <= 20);
    expect(inside.length / 2000).toBeGreaterThan(0.16);
    expect(inside.length / 2000).toBeLessThan(0.24);
  });
});

describe('unleash strategies', () => {
  const feature = (partial: Partial<UnleashFeature>): UnleashFeature => ({ name: 'f', enabled: true, ...partial });

  it('a disabled toggle is off whatever its strategies say', () => {
    expect(evaluateFeature(feature({ enabled: false, strategies: [{ name: 'default' }] }), context)).toBe(false);
  });

  it('no strategies means on', () => {
    expect(evaluateFeature(feature({}), context)).toBe(true);
  });

  it('a full rollout is on and an empty one is off', () => {
    expect(evaluateFeature(feature({ strategies: [{ name: 'flexibleRollout', parameters: { rollout: '100' } }] }), context)).toBe(true);
    expect(evaluateFeature(feature({ strategies: [{ name: 'flexibleRollout', parameters: { rollout: '0' } }] }), context)).toBe(false);
  });

  it('the same install gets the same answer every time', () => {
    const f = feature({ strategies: [{ name: 'flexibleRollout', parameters: { rollout: '37', groupId: 'g' } }] });
    const answers = new Set(Array.from({ length: 50 }, () => evaluateFeature(f, context)));
    expect(answers.size).toBe(1);
  });

  it('userWithId matches the installation id', () => {
    expect(evaluateFeature(feature({ strategies: [{ name: 'userWithId', parameters: { userIds: 'other, install-abc' } }] }), context)).toBe(true);
    expect(evaluateFeature(feature({ strategies: [{ name: 'userWithId', parameters: { userIds: 'other' } }] }), context)).toBe(false);
  });

  it('a strategy this client cannot judge does not turn itself on', () => {
    expect(evaluateFeature(feature({ strategies: [{ name: 'remoteAddress', parameters: { IPs: '10.0.0.1' } }] }), context)).toBe(false);
  });

  it('constraints gate the strategy', () => {
    const on = feature({ strategies: [{ name: 'default', constraints: [{ contextName: 'platform', operator: 'IN', values: ['darwin'] }] }] });
    const off = feature({ strategies: [{ name: 'default', constraints: [{ contextName: 'platform', operator: 'IN', values: ['win32'] }] }] });
    expect(evaluateFeature(on, context)).toBe(true);
    expect(evaluateFeature(off, context)).toBe(false);
  });

  it('inverted constraints flip', () => {
    const f = feature({ strategies: [{ name: 'default', constraints: [{ contextName: 'platform', operator: 'IN', values: ['win32'], inverted: true }] }] });
    expect(evaluateFeature(f, context)).toBe(true);
  });

  it('semver constraints compare part by part', () => {
    const f = feature({ strategies: [{ name: 'default', constraints: [{ contextName: 'version', operator: 'SEMVER_GT', value: '0.0.9' }] }] });
    expect(evaluateFeature(f, context)).toBe(true);
    const g = feature({ strategies: [{ name: 'default', constraints: [{ contextName: 'version', operator: 'SEMVER_GT', value: '0.10.0' }] }] });
    expect(evaluateFeature(g, context)).toBe(false);
  });
});

describe('precedence', () => {
  const definitions = [
    { id: 'a', label: 'A', description: '', fallback: false, stage: 'beta' as const, module: 'mjolnir' },
    { id: 'b', label: 'B', description: '', fallback: true, stage: 'beta' as const, module: 'mjolnir' },
  ];

  it('falls back to the build when nothing else speaks', () => {
    const states = evaluateAll({ overrides: {}, features: {}, context, definitions });
    expect(states.map((s) => [s.value, s.source])).toEqual([
      [false, 'default'],
      [true, 'default'],
    ]);
  });

  it('a remote toggle beats the build default', () => {
    const states = evaluateAll({ overrides: {}, features: { a: { name: 'a', enabled: true } }, context, definitions });
    expect(states[0]?.value).toBe(true);
    expect(states[0]?.source).toBe('remote');
    expect(states[0]?.fallback).toBe(false);
  });

  it('a local switch beats the remote', () => {
    const states = evaluateAll({ overrides: { a: false }, features: { a: { name: 'a', enabled: true } }, context, definitions });
    expect(states[0]?.value).toBe(false);
    expect(states[0]?.source).toBe('override');
    expect(states[0]?.remote).toBe(true);
  });

  it('a remote toggle for a flag this build does not declare is ignored', () => {
    const states = evaluateAll({ overrides: {}, features: { unknown: { name: 'unknown', enabled: true } }, context, definitions });
    expect(states.map((s) => s.id)).toEqual(['a', 'b']);
  });
});
