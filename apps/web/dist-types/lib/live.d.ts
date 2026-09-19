import type { WatchState } from '@mjolnir/k8s';
/**
 * The live wire.
 *
 * One WebSocket to /ws/watch carries every list and count the screen shows.
 * A subscription is an id and a query; the server pushes a snapshot whenever
 * the watch cache changes, so a pod that dies shows up dead within a frame
 * or two, with no polling and no refresh button that matters.
 */
type Listener = (message: Record<string, unknown>) => void;
declare class LiveConnection {
    #private;
    get open(): boolean;
    onState(listener: (open: boolean) => void): () => void;
    subscribe(query: Record<string, unknown>, listener: Listener): () => void;
}
export declare const live: LiveConnection;
export interface LiveList<T> {
    readonly items: T[];
    readonly state: WatchState;
    readonly error: string | null;
    readonly updatedAt: string | null;
}
/** A kind's list, kept current by the server. */
export declare function useLiveList<T>(context: string | null, kind: string | null, namespace: string | undefined): LiveList<T>;
/** Every kind's count for a cluster, live. */
export declare function useLiveCounts(context: string | null): Record<string, number>;
/** Whether the live wire is up, for the header's pulse. */
export declare function useLiveState(): boolean;
export {};
//# sourceMappingURL=live.d.ts.map