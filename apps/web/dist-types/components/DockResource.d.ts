/**
 * One object, kept open in the dock.
 *
 * The drawer is modal-ish: it covers the list and it belongs to the list you
 * opened it from. That is the wrong shape for the thing you are working on
 * while you look at five others. Lens solved this with a bottom dock and it is
 * the right answer: the deployment you are rolling out stays pinned while you
 * read the pods, the events and the config map it mounts.
 *
 * It re-reads on an interval rather than watching, because a pinned object is
 * one object and a watch per pinned tab is a socket per tab. Ten seconds is
 * fast enough to see a rollout move and slow enough to be free.
 */
export declare function DockResource({ context, kind, name, namespace, onNavigate, }: {
    context: string;
    kind: string;
    name: string;
    namespace?: string | undefined;
    onNavigate?: ((target: {
        kind: string;
        name?: string;
        namespace?: string;
    }) => void) | undefined;
}): import("react").JSX.Element;
//# sourceMappingURL=DockResource.d.ts.map