interface ClusterHeroProps {
    readonly context: string;
    readonly cluster?: {
        name: string;
        server?: string | null | undefined;
        provider: string;
    } | undefined;
    readonly ready: boolean;
    readonly pods: number;
    readonly nodes: number;
    readonly health: {
        ok: number;
        warn: number;
        error: number;
    };
    readonly version?: string | undefined;
    readonly onDecorChanged?: (() => void) | undefined;
    readonly usage?: {
        cpu: number | null;
        cpuText: string;
        memory: number | null;
        memoryText: string;
    } | undefined;
    readonly onOpenPods?: ((filter?: string) => void) | undefined;
    readonly onOpenNodes?: (() => void) | undefined;
}
export declare function ClusterHero({ context, cluster, ready, pods, nodes, health, version, onDecorChanged, usage, onOpenPods, onOpenNodes }: ClusterHeroProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ClusterHero.d.ts.map