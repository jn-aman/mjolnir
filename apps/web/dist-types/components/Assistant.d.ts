interface AssistantProps {
    readonly context: string | null;
    /** A prompt handed in from a right-click; sent when it changes. */
    readonly incoming: {
        readonly id: number;
        readonly text: string;
    } | null;
    readonly onOpenSettings: () => void;
}
export declare function Assistant({ context, incoming, onOpenSettings }: AssistantProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Assistant.d.ts.map