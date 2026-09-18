export interface StreamedLine {
    readonly seq: number;
    readonly timestamp: Date | null;
    readonly message: string;
    readonly pod: string;
    readonly container: string;
}
export type StreamState = 'idle' | 'connecting' | 'streaming' | 'ended' | 'error';
interface Options {
    readonly context: string;
    readonly namespace: string;
    readonly pod: string;
    readonly container?: string;
    readonly previous?: boolean;
    readonly follow?: boolean;
    readonly tailLines?: number;
    /** Lines kept in memory. Older ones are dropped, oldest first. */
    readonly buffer?: number;
}
/**
 * Live container logs.
 *
 * Batched frames from the server are appended in one state update, one update
 * per frame rather than per line, because a React render per log line is
 * precisely how a viewer freezes on a chatty pod.
 *
 * The buffer is bounded. An unbounded log view is a memory leak with a nice
 * font.
 */
export declare function useLogStream(options: Options | null): {
    lines: StreamedLine[];
    state: StreamState;
    error: string | null;
    clear: () => void;
};
export {};
//# sourceMappingURL=useLogStream.d.ts.map