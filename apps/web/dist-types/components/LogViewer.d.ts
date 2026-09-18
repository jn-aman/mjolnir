interface LogViewerProps {
    readonly source?: 'kubernetes' | 'docker' | undefined;
    readonly context: string;
    readonly namespace: string;
    readonly pod: string;
    readonly containers: string[];
    readonly expanded?: boolean;
    readonly onToggleExpand?: () => void;
    readonly initialContainer?: string | undefined;
    readonly initialPrevious?: boolean | undefined;
}
export declare function LogViewer({ source, context, namespace, pod, containers, expanded, onToggleExpand, initialContainer, initialPrevious, }: LogViewerProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=LogViewer.d.ts.map