import type { KubeItem } from '../components/columns.tsx';
export interface ContainerChange {
    readonly image?: string;
    readonly env?: Record<string, string>;
    readonly resources?: {
        requests?: Record<string, string>;
        limits?: Record<string, string>;
    };
}
export interface ControllerRef {
    readonly kind: string;
    readonly name: string;
    readonly namespace: string;
}
/** The workload that owns a pod, following ReplicaSet up to its Deployment. */
export declare function resolveController(context: string, pod: KubeItem): Promise<ControllerRef | null>;
/**
 * Edits one container's fields, on the workload that owns the pod when there
 * is one. Returns a sentence saying where the change landed.
 */
export declare function editContainer(context: string, pod: KubeItem, containerName: string, change: ContainerChange): Promise<string>;
/** `kubectl rollout undo`: the previous ReplicaSet's template becomes current. */
export declare function rolloutUndo(context: string, deployment: KubeItem): Promise<string>;
/** `kubectl cordon` / `uncordon`. */
export declare function setSchedulable(context: string, node: KubeItem, schedulable: boolean): Promise<void>;
/**
 * `kubectl drain`: cordon, then evict every pod that is not a DaemonSet's or
 * a static pod. Returns how many were evicted.
 */
export declare function drainNode(context: string, node: KubeItem): Promise<number>;
export interface Taint {
    readonly key: string;
    readonly value?: string;
    readonly effect: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute';
}
/** `kubectl taint`: the full list is sent, so removing is a shorter list. */
export declare function setTaints(context: string, node: KubeItem, taints: readonly Taint[]): Promise<void>;
/** `kubectl rollout pause` / `resume`. */
export declare function setPaused(context: string, deployment: KubeItem, paused: boolean): Promise<void>;
//# sourceMappingURL=edits.d.ts.map