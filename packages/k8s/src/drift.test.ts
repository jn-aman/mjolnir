import { describe, expect, it } from 'vitest';
import { comparePaths, detectDrift, findInManifest, lastApplied, quantity } from './drift.ts';

/**
 * Drift, against the noise that makes naive drift detection useless.
 *
 * Most of these tests are about what must *not* be reported. A tool that
 * reports two hundred differences on a healthy Deployment is a tool people
 * turn off, and every default Kubernetes writes on admission is one of those
 * two hundred.
 */

const DESIRED = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name: 'api', namespace: 'shop', labels: { app: 'api' } },
  spec: {
    replicas: 3,
    template: {
      spec: {
        containers: [{ name: 'api', image: 'ghcr.io/acme/api:v2', resources: { requests: { cpu: '500m', memory: '512Mi' } } }],
      },
    },
  },
};

/** The same object as the API server hands it back: defaulted to death. */
function live(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: 'api',
      namespace: 'shop',
      labels: { app: 'api' },
      uid: '8a7f-4c2b',
      resourceVersion: '148392',
      generation: 4,
      creationTimestamp: '2026-01-04T10:00:00Z',
      managedFields: [{ manager: 'kubectl-client-side-apply', time: '2026-01-04T10:00:00Z' }],
      annotations: { 'deployment.kubernetes.io/revision': '4' },
    },
    spec: {
      replicas: 3,
      revisionHistoryLimit: 10,
      progressDeadlineSeconds: 600,
      strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' } },
      template: {
        metadata: { creationTimestamp: null },
        spec: {
          dnsPolicy: 'ClusterFirst',
          restartPolicy: 'Always',
          schedulerName: 'default-scheduler',
          terminationGracePeriodSeconds: 30,
          containers: [
            {
              name: 'api',
              image: 'ghcr.io/acme/api:v2',
              imagePullPolicy: 'IfNotPresent',
              terminationMessagePath: '/dev/termination-log',
              resources: { requests: { cpu: '500m', memory: '512Mi' } },
            },
          ],
        },
      },
    },
    status: { replicas: 3, readyReplicas: 3, observedGeneration: 4 },
    ...overrides,
  };
}

const against = 'the chart';
const run = (overrides: Record<string, unknown> = {}, desired: Record<string, unknown> = DESIRED) =>
  detectDrift({ live: live(overrides), desired, source: 'helm', against });

describe('the noise that must not be reported', () => {
  it('says an untouched object is in sync, despite forty defaulted fields', () => {
    const report = run();
    expect(report.changes).toEqual([]);
    expect(report.inSync).toBe(true);
    expect(report.summary).toBe('The cluster matches the chart.');
  });

  it('ignores everything the API server owns', () => {
    const changes = comparePaths(
      { metadata: { name: 'api', resourceVersion: '1', uid: 'x', managedFields: [] }, status: { replicas: 1 } },
      { metadata: { name: 'api', resourceVersion: '999', uid: 'y', managedFields: [{ manager: 'z' }] }, status: { replicas: 7 } },
    );
    expect(changes).toEqual([]);
  });

  it('treats the same quantity written two ways as the same quantity', () => {
    const desired = { spec: { template: { spec: { containers: [{ name: 'api', resources: { requests: { cpu: 1, memory: '1024Mi' } } }] } } } };
    const report = detectDrift({
      live: {
        kind: 'Deployment',
        metadata: { name: 'api' },
        spec: { template: { spec: { containers: [{ name: 'api', resources: { requests: { cpu: '1', memory: '1Gi' } } }] } } },
      },
      desired,
      source: 'helm',
      against,
    });
    // `cpu: 1` and `cpu: "1"`, `1024Mi` and `1Gi`: the same request, written
    // differently. Reporting them teaches people to ignore the whole page.
    expect(report.changes).toEqual([]);
  });

  it('reads quantities the way Kubernetes writes them', () => {
    expect(quantity('500m')).toBe(0.5);
    expect(quantity('1Gi')).toBe(1024 ** 3);
    expect(quantity('1024Mi')).toBe(1024 ** 3);
    expect(quantity('2')).toBe(2);
    expect(quantity('nonsense')).toBeNull();
    // A percentage is not a quantity, and guessing would make 25% equal 25.
    expect(quantity('25%')).toBeNull();
  });
});

describe('the drift that is real', () => {
  it('catches a replica count somebody changed, and says who usually does', () => {
    const report = run({ spec: { ...live().spec as object, replicas: 5 } });
    const change = report.changes.find((entry) => entry.path === 'spec.replicas')!;

    expect(change.desired).toBe(3);
    expect(change.live).toBe(5);
    expect(change.note).toContain('HorizontalPodAutoscaler');
    // The consequence people forget: the next upgrade takes it back.
    expect(change.note).toContain('next apply or upgrade will undo it');
    expect(report.unexpected).toBe(1);
    expect(report.summary).toContain('spec.replicas differs from the chart');
  });

  it('catches a kubectl set image and says the fix will be reverted', () => {
    const current = live();
    const spec = current.spec as { template: { spec: { containers: Array<Record<string, unknown>> } } };
    spec.template.spec.containers[0]!['image'] = 'ghcr.io/acme/api:hotfix';
    const report = detectDrift({ live: current, desired: DESIRED, source: 'helm', against });

    const change = report.changes.find((entry) => entry.path.endsWith('.image'))!;
    expect(change.path).toBe('spec.template.spec.containers[0].image');
    expect(change.note).toContain('whatever this fixed comes back');
  });

  it('catches a declared field that has been deleted from the live object', () => {
    const current = live();
    delete (current.metadata as Record<string, unknown>)['labels'];
    const report = detectDrift({ live: current, desired: DESIRED, source: 'helm', against });
    // Reported at the block that vanished rather than enumerating every key
    // inside it: "the labels are gone" is one fact, not four.
    expect(report.changes[0]?.kind).toBe('removed');
    expect(report.changes[0]?.path).toBe('metadata.labels');
    expect(report.changes[0]?.desired).toEqual({ app: 'api' });
  });

  it('separates the drift a controller makes from the drift a person makes', () => {
    const current = live();
    (current.metadata as { annotations: Record<string, string> }).annotations['autoscaling.alpha.kubernetes.io/conditions'] = '[]';
    const report = detectDrift({
      live: current,
      desired: { ...DESIRED, metadata: { ...DESIRED.metadata, annotations: { 'autoscaling.alpha.kubernetes.io/conditions': 'something else' } } },
      source: 'helm',
      against,
    });

    expect(report.changes).toHaveLength(1);
    expect(report.changes[0]?.expected).toBe(true);
    expect(report.unexpected).toBe(0);
    expect(report.summary).toContain('all of them the kind a controller makes');
  });

  it('notices a paused rollout, which looks like nothing being wrong', () => {
    const report = run({ spec: { ...(live().spec as object), paused: true } }, { ...DESIRED, spec: { ...DESIRED.spec, paused: false } });
    const change = report.changes.find((entry) => entry.path === 'spec.paused')!;
    expect(change.note).toContain('changes are being applied and not rolled out');
  });

  it('reports a field whose type changed, not just its value', () => {
    const changes = comparePaths({ spec: { ports: [{ port: 80 }] } }, { spec: { ports: 'eighty' } });
    expect(changes[0]?.kind).toBe('type-changed');
  });
});

describe('where desired state comes from', () => {
  it('reads what was last applied with kubectl', () => {
    const applied = { kind: 'Deployment', metadata: { name: 'api' }, spec: { replicas: 2 } };
    const current = live({
      metadata: { name: 'api', annotations: { 'kubectl.kubernetes.io/last-applied-configuration': JSON.stringify(applied) } },
    });
    expect(lastApplied(current)).toEqual(applied);
  });

  it('says nothing rather than guessing when there is no kubectl history', () => {
    // Normal for anything Helm created, or anything applied server-side.
    expect(lastApplied(live())).toBeNull();
    expect(lastApplied({ metadata: { annotations: { 'kubectl.kubernetes.io/last-applied-configuration': 'not json' } } })).toBeNull();
  });

  it('finds an object in a chart manifest by identity, not by position', () => {
    const documents = [
      { kind: 'Service', metadata: { name: 'api' } },
      { kind: 'Deployment', metadata: { name: 'other' } },
      { kind: 'Deployment', metadata: { name: 'api' } },
    ];
    expect(findInManifest(documents, { kind: 'Deployment', name: 'api', namespace: 'shop' })).toBe(documents[2]);
    expect(findInManifest(documents, { kind: 'StatefulSet', name: 'api' })).toBeNull();
  });

  it('matches a chart object that leaves the namespace to the release', () => {
    const documents = [{ kind: 'Deployment', metadata: { name: 'api' } }];
    expect(findInManifest(documents, { kind: 'Deployment', name: 'api', namespace: 'shop' })).toBe(documents[0]);
  });
});
