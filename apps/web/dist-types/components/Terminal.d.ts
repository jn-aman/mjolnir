import '@xterm/xterm/css/xterm.css';
/**
 * A shell in a container, in the dock.
 *
 * xterm on the client, the API server's exec WebSocket on the other end, our
 * server bridging the two. Keystrokes go up as JSON, bytes come down as
 * binary frames. The terminal takes the Storm colours from the tokens so it
 * follows the theme with the rest of the app.
 */
interface TerminalProps {
    readonly source?: 'kubernetes' | 'docker' | undefined;
    readonly context: string;
    readonly namespace: string;
    readonly pod: string;
    readonly container?: string | undefined;
}
export declare function Terminal({ source, context, namespace, pod, container }: TerminalProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Terminal.d.ts.map