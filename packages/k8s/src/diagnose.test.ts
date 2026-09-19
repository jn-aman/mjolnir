import { describe, expect, it } from 'vitest';
import { diagnose, explainReason, workloadOf, type DiagnoseInput, type KubeEvent, type PodObject } from './diagnose.ts';

/**
 * The rules, against the failures they were written for.
 *
 * Every fixture here is shaped the way a real cluster shapes it, because the
 * bugs in this kind of code are all in the shape: a `lastState` that is
 * missing, a reason string that is `ErrImagePull` this minute and
 * `ImagePullBackOff` the next, an event with `eventTime` instead of
 * `lastTimestamp`.
 */

const NOW = Date.parse('2026-09-19T12:00:00.000Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function pod(name: string, status: NonNullable<PodObject['status']>, spec: NonNullable<PodObject['spec']> = {}): PodObject {
  return { metadata: { name, namespace: 'shop', creationTimestamp: ago(30) }, spec, status };
}

function event(partial: Partial<KubeEvent>): KubeEvent {
  return {
    type: 'Warning',
    lastTimestamp: ago(2),
    involvedObject: { kind: 'Pod', name: 'api-1', namespace: 'shop' },
    source: { component: 'kubelet' },
    ...partial,
  };
}

const run = (input: DiagnoseInput) => diagnose({ ...input, now: NOW });

describe('a container that will not stay up', () => {
  it('reads the exit code rather than repeating the word BackOff', () => {
    const result = run({
      pods: [
        pod('api-1', {
          phase: 'Running',
          containerStatuses: [
            {
              name: 'api',
              restartCount: 7,
              state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m0s restarting failed container' } },
              lastState: { terminated: { reason: 'Error', exitCode: 1, finishedAt: ago(1) } },
            },
          ],
        }),
      ],
    });

    const finding = result.findings[0]!;
    expect(finding.rule).toBe('crash-looping');
    expect(finding.severity).toBe('critical');
    expect(finding.title).toContain('keeps crashing');
    // The thing nobody explains, explained.
    expect(finding.detail).toContain('waiting longer between each try');
    expect(finding.detail).toContain('7 times');
    expect(finding.fix).toContain('previous container logs');
    expect(finding.actions.some((action) => action.kind === 'previous-logs')).toBe(true);
  });

  it('says memory, not "exit 137", when that is what happened', () => {
    const result = run({
      pods: [
        pod(
          'api-1',
          {
            containerStatuses: [
              {
                name: 'api',
                restartCount: 3,
                state: { waiting: { reason: 'CrashLoopBackOff' } },
                lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, finishedAt: ago(1) } },
              },
            ],
          },
          { containers: [{ name: 'api', resources: { limits: { memory: '256Mi' } } }] },
        ),
      ],
    });

    expect(result.findings[0]?.detail).toContain('ran out of memory');
    expect(result.findings[0]?.fix).toContain('memory limit');
  });

  it('separates a container with no limit from one that exceeded its own', () => {
    const withLimit = run({
      pods: [
        pod(
          'api-1',
          { containerStatuses: [{ name: 'api', restartCount: 1, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, finishedAt: ago(5) } } }] },
          { containers: [{ name: 'api', resources: { limits: { memory: '512Mi' } } }] },
        ),
      ],
    });
    expect(withLimit.findings[0]?.detail).toContain('512Mi');

    const without = run({
      pods: [pod('api-1', { containerStatuses: [{ name: 'api', restartCount: 1, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, finishedAt: ago(5) } } }] })],
    });
    // A node running out is a different problem from a container exceeding
    // its allowance, and the advice differs.
    expect(without.findings[0]?.detail).toContain('the node running out');
    expect(without.findings[0]?.fix).toContain('Set a memory limit');
  });

  it('catches the container that restarts quietly and is Running when you look', () => {
    const result = run({
      pods: [
        pod('worker-1', {
          phase: 'Running',
          containerStatuses: [
            {
              name: 'worker',
              ready: true,
              restartCount: 6,
              state: { running: { startedAt: ago(4) } },
              lastState: { terminated: { reason: 'Error', exitCode: 2, finishedAt: ago(4) } },
            },
          ],
        }),
      ],
    });

    const finding = result.findings.find((entry) => entry.rule === 'restarting-quietly');
    expect(finding?.title).toContain('restarted 6 times');
    expect(finding?.fix).toContain('by the time anyone looks');
  });
});

describe('a container that never starts', () => {
  it('names the missing key, which is the one line that matters', () => {
    const result = run({
      pods: [
        pod('api-1', {
          containerStatuses: [
            {
              name: 'api',
              state: {
                waiting: {
                  reason: 'CreateContainerConfigError',
                  message: 'couldn\'t find key DATABASE_URL in ConfigMap shop/api-config',
                },
              },
            },
          ],
        }),
      ],
    });

    const finding = result.findings[0]!;
    expect(finding.rule).toBe('config-missing');
    expect(finding.title).toContain('DATABASE_URL');
    // The trap: people look for logs and there are none, because nothing ran.
    expect(finding.detail).toContain('no logs at all');
  });

  it('tells a refused registry from a missing tag, because the fix differs', () => {
    const denied = run({
      pods: [pod('api-1', { containerStatuses: [{ name: 'api', image: 'ghcr.io/acme/api:v9', state: { waiting: { reason: 'ImagePullBackOff', message: 'unauthorized: authentication required' } } }] })],
    });
    expect(denied.findings[0]?.detail).toContain('refused the pull');
    expect(denied.findings[0]?.fix).toContain('imagePullSecret');

    const missing = run({
      pods: [pod('api-1', { containerStatuses: [{ name: 'api', image: 'ghcr.io/acme/api:v9', state: { waiting: { reason: 'ErrImagePull', message: 'manifest unknown' } } }] })],
    });
    expect(missing.findings[0]?.detail).toContain('does not have');
    expect(missing.findings[0]?.fix).toContain('digest');
  });

  it('explains what a scheduler refusal actually means', () => {
    const result = run({
      events: [
        event({
          reason: 'FailedScheduling',
          message: '0/6 nodes are available: 4 Insufficient cpu, 2 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }',
          source: { component: 'default-scheduler' },
        }),
      ],
    });

    const finding = result.findings[0]!;
    expect(finding.rule).toBe('unschedulable');
    // Requests, not usage, is the single most common misunderstanding here.
    expect(finding.detail).toContain('a reservation, not a measurement');
  });
});

describe('putting the cause above the symptom', () => {
  it('puts a rollout that preceded the failures above the failures', () => {
    const result = run({
      replicaSets: [
        // The one it replaced. Without a previous set this is a first deploy,
        // which replaces nothing and cannot be rolled back to anything.
        { metadata: { name: 'api-4b21', namespace: 'shop', creationTimestamp: ago(3000), ownerReferences: [{ kind: 'Deployment', name: 'api', controller: true }] } },
        { metadata: { name: 'api-7c9f', namespace: 'shop', creationTimestamp: ago(12), ownerReferences: [{ kind: 'Deployment', name: 'api', controller: true }] } },
      ],
      pods: [
        pod('api-1', {
          containerStatuses: [
            { name: 'api', restartCount: 5, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'Error', exitCode: 1, finishedAt: ago(9) } } },
          ],
        }),
      ],
      events: [event({ reason: 'BackOff', message: 'Back-off restarting failed container', count: 40, lastTimestamp: ago(1) })],
    });

    // This is the whole feature: kubectl sorts the forty backoff events to
    // the top and buries the deploy that caused them.
    expect(result.findings[0]?.rule).toBe('rollout-preceded-failure');
    expect(result.findings[0]?.title).toContain('just before this started');
    expect(result.findings[0]?.fix).toContain('kubectl rollout undo deployment/api');
    expect(result.findings.map((finding) => finding.rule)).toContain('crash-looping');
  });

  it('does not call a first deploy a rollout, because nothing was replaced', () => {
    const result = run({
      // One replica set, brand new: this workload has never had another
      // version. Every workload in a namespace someone just created looks
      // like this, and calling all of them the cause is worthless.
      replicaSets: [{ metadata: { name: 'api-7c9f', namespace: 'shop', creationTimestamp: ago(4), ownerReferences: [{ kind: 'Deployment', name: 'api', controller: true }] } }],
      pods: [
        pod('api-1', {
          containerStatuses: [{ name: 'api', restartCount: 2, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'Error', exitCode: 1, finishedAt: ago(2) } } }],
        }),
      ],
    });
    expect(result.findings.some((finding) => finding.rule === 'rollout-preceded-failure')).toBe(false);
    expect(result.findings[0]?.rule).toBe('crash-looping');
  });

  it('does not blame a rollout that nothing followed', () => {
    const result = run({
      replicaSets: [{ metadata: { name: 'api-7c9f', namespace: 'shop', creationTimestamp: ago(10), ownerReferences: [{ kind: 'Deployment', name: 'api', controller: true }] } }],
      pods: [pod('api-1', { phase: 'Running', containerStatuses: [{ name: 'api', ready: true, restartCount: 0, state: { running: { startedAt: ago(10) } } }] })],
    });
    expect(result.findings.some((finding) => finding.rule === 'rollout-preceded-failure')).toBe(false);
    expect(result.healthy).toBe(true);
    expect(result.summary).toBe('Nothing is failing here right now.');
  });

  it('dates a config change against the first failure, and says why it may not have taken', () => {
    const result = run({
      configs: [
        {
          kind: 'ConfigMap',
          metadata: { name: 'api-config', namespace: 'shop', managedFields: [{ manager: 'kubectl-edit', operation: 'Update', time: ago(14) }] },
        },
        // Changed at the same moment and read by nobody. Reporting it would
        // be true and useless, which is the worst kind of finding.
        { kind: 'ConfigMap', metadata: { name: 'unrelated', namespace: 'shop', managedFields: [{ manager: 'kubectl-edit', time: ago(14) }] } },
        // Kubernetes writes this into every namespace itself.
        { kind: 'ConfigMap', metadata: { name: 'kube-root-ca.crt', namespace: 'shop', managedFields: [{ manager: 'kube-controller-manager', time: ago(14) }] } },
      ],
      pods: [
        pod(
          'api-1',
          { phase: 'Running' },
          { containers: [{ name: 'api', env: [{ name: 'DB', valueFrom: { configMapKeyRef: { name: 'api-config', key: 'DB' } } }] }] },
        ),
      ],
      events: [event({ reason: 'Unhealthy', message: 'Readiness probe failed: connection refused', lastTimestamp: ago(6), count: 9 })],
    });

    const finding = result.findings.find((entry) => entry.rule === 'config-changed-before-failure')!;
    expect(finding.title).toContain('was changed 8 minutes before');
    // The bit that costs people an hour: editing a config map restarts nothing.
    expect(finding.detail).toContain('Pods do not restart when a config map changes');
    expect(finding.evidence[0]?.text).toBe('kubectl-edit');
    expect(result.findings.indexOf(finding)).toBe(0);
    expect(result.findings.some((entry) => entry.title.includes('unrelated'))).toBe(false);
    expect(result.findings.some((entry) => entry.title.includes('kube-root-ca'))).toBe(false);
  });

  it('ignores a config change from long before anything went wrong', () => {
    const result = run({
      configs: [{ kind: 'ConfigMap', metadata: { name: 'old', namespace: 'shop', managedFields: [{ manager: 'helm', time: ago(400) }] } }],
      events: [event({ reason: 'Unhealthy', message: 'Readiness probe failed', count: 5 })],
    });
    expect(result.findings.some((finding) => finding.rule === 'config-changed-before-failure')).toBe(false);
  });

  it('puts a sick node above the pods that are sick because of it', () => {
    const result = run({
      nodes: [
        {
          metadata: { name: 'node-3' },
          status: { conditions: [{ type: 'Ready', status: 'True' }, { type: 'MemoryPressure', status: 'True', message: 'kubelet has memory pressure', lastTransitionTime: ago(8) }] },
        },
      ],
      pods: [
        { metadata: { name: 'api-1', namespace: 'shop', creationTimestamp: ago(5) }, spec: { nodeName: 'node-3' }, status: { reason: 'Evicted', message: 'The node was low on resource: memory.' } },
      ],
    });

    expect(result.findings[0]?.rule).toBe('node-pressure');
    expect(result.findings[0]?.detail).toContain('was evicted because of this');
    expect(result.findings.some((finding) => finding.rule === 'evicted')).toBe(true);
  });

  it('treats a node that stopped reporting as worse than one that says it is unwell', () => {
    const result = run({
      nodes: [{ metadata: { name: 'node-9' }, status: { conditions: [{ type: 'Ready', status: 'Unknown', lastTransitionTime: ago(3) }] } }],
    });
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings[0]?.detail).toContain('still listed as running');
  });
});

describe('probes', () => {
  it('separates a readiness failure from a liveness one, because the consequence differs', () => {
    const readiness = run({ events: [event({ reason: 'Unhealthy', message: 'Readiness probe failed: HTTP probe failed with statuscode: 503', count: 12 })] });
    expect(readiness.findings[0]?.severity).toBe('warning');
    expect(readiness.findings[0]?.detail).toContain('taken out of its Service');

    const liveness = run({ events: [event({ reason: 'Unhealthy', message: 'Liveness probe failed: connection refused', count: 6 })] });
    expect(liveness.findings[0]?.severity).toBe('critical');
    expect(liveness.findings[0]?.detail).toContain('killed and restarted');
    expect(liveness.findings[0]?.fix).toContain('Nothing is listening');
  });

  it('lets a single failed check pass without comment', () => {
    const result = run({ events: [event({ reason: 'Unhealthy', message: 'Readiness probe failed', count: 1 })] });
    expect(result.findings.some((finding) => finding.rule === 'probe-failing')).toBe(false);
  });

  it('suggests a startup probe when the check timed out rather than being refused', () => {
    const result = run({ events: [event({ reason: 'Unhealthy', message: 'Liveness probe failed: context deadline exceeded', count: 4 })] });
    expect(result.findings[0]?.fix).toContain('startup probe');
  });
});

describe('the things that look like nothing happening', () => {
  it('finds a quota refusal, which never produces a pod to look at', () => {
    const result = run({
      events: [
        event({
          reason: 'FailedCreate',
          involvedObject: { kind: 'ReplicaSet', name: 'api-7c9f', namespace: 'shop' },
          message: 'pods "api-7c9f-x" is forbidden: exceeded quota: compute, requested: requests.cpu=2, used: requests.cpu=10, limited: requests.cpu=10',
        }),
      ],
    });

    const finding = result.findings[0]!;
    expect(finding.rule).toBe('quota-exceeded');
    expect(finding.detail).toContain('why this looks like nothing happening');
  });

  it('explains a multi-attach volume error and that it usually clears itself', () => {
    const result = run({
      events: [event({ reason: 'FailedAttachVolume', message: 'Multi-Attach error for volume "pvc-1" Volume is already used by pod' })],
    });
    expect(result.findings[0]?.detail).toContain('resolves itself');
  });

  it('reports a workload below strength as a symptom, under whatever caused it', () => {
    const result = run({
      workloads: [{ kind: 'Deployment', metadata: { name: 'api', namespace: 'shop' }, spec: { replicas: 3 }, status: { readyReplicas: 0 } }],
      pods: [
        pod('api-1', { containerStatuses: [{ name: 'api', state: { waiting: { reason: 'ImagePullBackOff', message: 'manifest unknown' } } }] }),
      ],
    });

    expect(result.findings[0]?.rule).toBe('image-unavailable');
    const understrength = result.findings.find((finding) => finding.rule === 'not-at-strength')!;
    expect(understrength.title).toContain('no pods running at all');
    expect(result.findings.indexOf(understrength)).toBeGreaterThan(0);
  });
});

describe('the answer as a whole', () => {
  it('leads with the thing rather than a count of things', () => {
    const result = run({
      pods: [
        pod('api-1', { containerStatuses: [{ name: 'api', restartCount: 4, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'Error', exitCode: 1, finishedAt: ago(2) } } }] }),
        pod('api-2', { containerStatuses: [{ name: 'api', restartCount: 4, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'Error', exitCode: 1, finishedAt: ago(2) } } }] }),
      ],
    });
    expect(result.summary).toContain('keeps crashing');
    expect(result.summary).toContain('one other thing below');
    expect(result.counts.critical).toBe(2);
  });

  it('keeps the ordinary events in the timeline, because the deploy is one of them', () => {
    const result = run({
      events: [
        event({ type: 'Normal', reason: 'ScalingReplicaSet', message: 'Scaled up replica set api-7c9f to 3', lastTimestamp: ago(12), involvedObject: { kind: 'Deployment', name: 'api', namespace: 'shop' } }),
        event({ reason: 'BackOff', message: 'Back-off restarting failed container', lastTimestamp: ago(2), count: 30 }),
      ],
    });

    expect(result.timeline).toHaveLength(2);
    expect(result.timeline[0]?.title).toContain('Waiting longer before the next retry');
    expect(result.timeline[1]?.title).toBe('Rollout: replica count changed');
  });

  it('reads an event that carries eventTime instead of lastTimestamp', () => {
    const result = run({
      events: [{ type: 'Warning', reason: 'Unhealthy', message: 'Liveness probe failed', count: 5, eventTime: ago(3), lastTimestamp: null, involvedObject: { kind: 'Pod', name: 'api-1', namespace: 'shop' } }],
    });
    expect(result.findings).toHaveLength(1);
  });

  it('drops what is too old to be news', () => {
    const result = run({ events: [event({ reason: 'Unhealthy', message: 'Liveness probe failed', count: 9, lastTimestamp: ago(400) })] });
    expect(result.findings).toHaveLength(0);
    expect(result.timeline).toHaveLength(0);
  });

  it('says nothing rather than something wrong when it was given nothing', () => {
    const result = run({});
    expect(result.healthy).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('turns every reason it shows into words', () => {
    expect(explainReason('BackOff', 30)).toBe('Waiting longer before the next retry (30 times)');
    expect(explainReason('FailedScheduling')).toBe('Could not be placed on any node');
    // An unknown reason passes through rather than being dropped or guessed at.
    expect(explainReason('SomethingNew')).toBe('SomethingNew');
  });
});

describe('one problem, once', () => {
  it('collapses three broken replicas into one finding named for the workload', () => {
    const replicas = ['api-7c9f-aaa', 'api-7c9f-bbb', 'api-7c9f-ccc'].map((name) => ({
      metadata: {
        name,
        namespace: 'shop',
        creationTimestamp: ago(20),
        ownerReferences: [{ kind: 'ReplicaSet', name: 'api-7c9f', controller: true }],
      },
      status: {
        containerStatuses: [
          {
            name: 'api',
            restartCount: 5,
            state: { waiting: { reason: 'CrashLoopBackOff' } },
            lastState: { terminated: { reason: 'Error', exitCode: 1, finishedAt: ago(2) } },
          },
        ],
      },
    }));

    const result = run({ pods: replicas });
    const crashes = result.findings.filter((finding) => finding.rule === 'crash-looping');
    expect(crashes).toHaveLength(1);
    // Named for the thing that is broken, not for one of the three ways it shows.
    // The container is named after the workload, so the sentence says it once.
    expect(crashes[0]?.title).toBe('api keeps crashing');
    expect(crashes[0]?.affected).toEqual(['api-7c9f-aaa', 'api-7c9f-bbb', 'api-7c9f-ccc']);
  });

  it('keeps two different problems apart even on the same workload', () => {
    const result = run({
      pods: [
        {
          metadata: { name: 'api-7c9f-aaa', namespace: 'shop', ownerReferences: [{ kind: 'ReplicaSet', name: 'api-7c9f', controller: true }] },
          status: {
            containerStatuses: [
              { name: 'api', restartCount: 4, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'Error', exitCode: 1, finishedAt: ago(2) } } },
              { name: 'sidecar', state: { waiting: { reason: 'ImagePullBackOff', message: 'manifest unknown' } } },
            ],
          },
        },
      ],
    });
    expect(result.findings.filter((finding) => finding.rule === 'crash-looping')).toHaveLength(1);
    expect(result.findings.filter((finding) => finding.rule === 'image-unavailable')).toHaveLength(1);
  });

  it('reads a pod back to its deployment through the replica set hash', () => {
    expect(workloadOf({ metadata: { name: 'api-8df977b79-fwqrj', ownerReferences: [{ kind: 'ReplicaSet', name: 'api-8df977b79', controller: true }] } })).toEqual({
      kind: 'Deployment',
      name: 'api',
    });
    // A StatefulSet owns its pods directly and its names carry no hash.
    expect(workloadOf({ metadata: { name: 'postgres-0', ownerReferences: [{ kind: 'StatefulSet', name: 'postgres', controller: true }] } })).toEqual({
      kind: 'StatefulSet',
      name: 'postgres',
    });
    // A pod nobody owns is its own workload.
    expect(workloadOf({ metadata: { name: 'debug' } })).toEqual({ kind: 'Pod', name: 'debug' });
    // The hash alphabet has no vowels in it, so a real word at the end of a
    // name is part of the name and not a hash to strip.
    expect(workloadOf({ metadata: { name: 'payments-prod-x', ownerReferences: [{ kind: 'ReplicaSet', name: 'payments-prod', controller: true }] } })).toEqual({
      kind: 'Deployment',
      name: 'payments-prod',
    });
  });
});

describe('scope', () => {
  it('does not report a config change to a workload that never reads it', () => {
    const result = run({
      // Asking about `hungry`, which mounts nothing.
      pods: [
        {
          metadata: { name: 'hungry-5c9f-khw5n', namespace: 'shop', ownerReferences: [{ kind: 'ReplicaSet', name: 'hungry-5c9f', controller: true }] },
          spec: { containers: [{ name: 'hungry' }] },
          status: {
            containerStatuses: [
              { name: 'hungry', restartCount: 3, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, finishedAt: ago(2) } } },
            ],
          },
        },
      ],
      configs: [{ kind: 'ConfigMap', metadata: { name: 'api-config', namespace: 'shop', managedFields: [{ manager: 'kubectl-edit', time: ago(6) }] } }],
    });

    expect(result.findings.some((finding) => finding.rule === 'config-changed-before-failure')).toBe(false);
    expect(result.findings[0]?.title).toBe('hungry keeps crashing');
  });

  it('still considers every config when there are no pods to narrow by', () => {
    const result = run({
      configs: [{ kind: 'ConfigMap', metadata: { name: 'api-config', namespace: 'shop', managedFields: [{ manager: 'kubectl-edit', time: ago(9) }] } }],
      events: [event({ reason: 'Unhealthy', message: 'Readiness probe failed', count: 6, lastTimestamp: ago(4) })],
    });
    expect(result.findings.some((finding) => finding.rule === 'config-changed-before-failure')).toBe(true);
  });
});

describe('one container, one finding', () => {
  it('does not report a memory kill twice as a restart count as well', () => {
    const result = run({
      pods: [
        {
          metadata: { name: 'cart-5c9f-a', namespace: 'shop', ownerReferences: [{ kind: 'ReplicaSet', name: 'cart-5c9f', controller: true }] },
          spec: { containers: [{ name: 'server', resources: { limits: { memory: '128Mi' } } }] },
          status: {
            containerStatuses: [
              { name: 'server', ready: true, restartCount: 45, state: { running: { startedAt: ago(1) } }, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, finishedAt: ago(2) } } },
            ],
          },
        },
      ],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe('out-of-memory');
    // The restart count is not lost, it moves into the finding that explains it.
    expect(result.findings[0]?.detail).toContain('come back 45 times');
  });
});
