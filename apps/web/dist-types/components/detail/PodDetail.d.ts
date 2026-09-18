/**
 * Everything the API says about a pod, laid out the way someone debugging one
 * reads it: what is wrong first, then what it is, then what it is made of.
 *
 * Deliberately exhaustive. A detail panel that shows six fields sends people
 * back to `kubectl describe`, and the whole argument for this app is that they
 * should not have to.
 */
export interface PodShape {
    metadata?: {
        name?: string;
        namespace?: string;
        uid?: string;
        creationTimestamp?: string;
        labels?: Record<string, string>;
        annotations?: Record<string, string>;
        ownerReferences?: Array<{
            kind?: string;
            name?: string;
            controller?: boolean;
        }>;
    };
    spec?: {
        nodeName?: string;
        serviceAccountName?: string;
        restartPolicy?: string;
        priorityClassName?: string;
        nodeSelector?: Record<string, string>;
        tolerations?: Array<{
            key?: string;
            operator?: string;
            value?: string;
            effect?: string;
        }>;
        volumes?: Array<{
            name?: string;
        } & Record<string, unknown>>;
        containers?: ContainerSpec[];
        initContainers?: ContainerSpec[];
    };
    status?: {
        phase?: string;
        podIP?: string;
        hostIP?: string;
        qosClass?: string;
        startTime?: string;
        conditions?: Array<{
            type?: string;
            status?: string;
            reason?: string;
            message?: string;
            lastTransitionTime?: string;
        }>;
        containerStatuses?: ContainerStatus[];
        initContainerStatuses?: ContainerStatus[];
    };
}
interface ContainerSpec {
    name?: string;
    image?: string;
    imagePullPolicy?: string;
    command?: string[];
    args?: string[];
    ports?: Array<{
        name?: string;
        containerPort?: number;
        protocol?: string;
    }>;
    env?: Array<{
        name?: string;
        value?: string;
        valueFrom?: unknown;
    }>;
    volumeMounts?: Array<{
        name?: string;
        mountPath?: string;
        readOnly?: boolean;
    }>;
    resources?: {
        requests?: Record<string, string>;
        limits?: Record<string, string>;
    };
    livenessProbe?: Probe;
    readinessProbe?: Probe;
    startupProbe?: Probe;
}
interface Probe {
    httpGet?: {
        path?: string;
        port?: number | string;
    };
    tcpSocket?: {
        port?: number | string;
    };
    exec?: {
        command?: string[];
    };
    initialDelaySeconds?: number;
    periodSeconds?: number;
    failureThreshold?: number;
}
interface ContainerStatus {
    name?: string;
    image?: string;
    imageID?: string;
    containerID?: string;
    ready?: boolean;
    started?: boolean;
    restartCount?: number;
    state?: {
        running?: {
            startedAt?: string;
        };
        waiting?: {
            reason?: string;
            message?: string;
        };
        terminated?: {
            reason?: string;
            exitCode?: number;
            finishedAt?: string;
        };
    };
    lastState?: {
        terminated?: {
            reason?: string;
            exitCode?: number;
            startedAt?: string;
            finishedAt?: string;
        };
    };
}
interface PodDetailProps {
    readonly pod: PodShape;
    readonly metrics?: {
        cpu: Array<{
            t: number;
            v: number;
        }>;
        memory: Array<{
            t: number;
            v: number;
        }>;
    } | undefined;
    readonly onOpenLogs: (container: string, previous: boolean) => void;
}
export declare function PodDetail({ pod, metrics, onOpenLogs }: PodDetailProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=PodDetail.d.ts.map