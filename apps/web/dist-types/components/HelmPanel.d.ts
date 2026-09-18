/**
 * Helm, read from the cluster.
 *
 * Every release Helm 3 installed left its revisions as Secrets, and this page
 * decodes them: the list is `helm list`, the drawer is `helm get all` and
 * `helm history`. Upgrades and rollbacks need the Helm engine and arrive
 * with it; until then the exact commands are one right-click away.
 */
interface HelmPanelProps {
    readonly context: string;
    readonly namespace?: string | undefined;
    readonly onNavigate: (target: {
        kind: string;
        name?: string;
        namespace?: string;
    }) => void;
}
export declare function HelmPanel({ context, namespace, onNavigate }: HelmPanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=HelmPanel.d.ts.map