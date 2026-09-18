import type { NavSelection } from '../components/Sidebar.tsx';
/**
 * Where you are, in the URL.
 *
 * A reload, or the app restarting after an update, puts you back on the
 * same cluster, page, namespace, filter and open object. The hash is the
 * store because it costs nothing, survives Electron's reload, and can be
 * copied to a colleague as "look at this".
 */
export interface RouteState {
    readonly context?: string;
    readonly selection?: NavSelection;
    readonly namespace?: string;
    readonly status?: string;
    readonly selected?: string;
    readonly tab?: string;
}
export declare function readRoute(): RouteState;
export declare function writeRoute(state: RouteState): void;
//# sourceMappingURL=route.d.ts.map