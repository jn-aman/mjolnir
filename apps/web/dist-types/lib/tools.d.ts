import { type LucideIcon } from 'lucide-react';
/**
 * Everything the shell will hold, declared before it is built.
 *
 * The navigation, the command palette and the rail all read this list, so a
 * feature arrives by filling in a panel, not by finding a place for it. Until
 * a panel exists, the entry opens an honest page: what it will do, and the
 * command that does the same thing today. A slot that says "planned" is a
 * promise the layout keeps; a slot that does not exist is a redesign later.
 *
 * `tools` live in the cluster's own navigation because they act on the cluster
 * you are looking at. `workspace` entries are not about one cluster (cloud
 * identities, local containers, buckets, databases, brokers, certificates,
 * image provenance) and live in the Toolbox, behind one tile on the rail.
 */
export interface ToolCommand {
    readonly label: string;
    readonly command: string;
}
export interface ToolDefinition {
    readonly id: string;
    readonly label: string;
    readonly icon: LucideIcon;
    readonly tint: string;
    readonly area: 'tools' | 'workspace';
    /** One sentence: what it is for. */
    readonly summary: string;
    /** What it will do, concretely, once built. */
    readonly detail: readonly string[];
    /** What does the job today, so the page is useful before the feature is. */
    readonly today: readonly ToolCommand[];
    /** A module's sidebar entries. Only for `workspace` entries. */
    readonly sections?: readonly string[];
    /** Built and working today. Anything without this is honestly labelled planned. */
    readonly built?: boolean;
}
/** The Kubernetes module, alongside the others; it is not the app. */
export declare const KUBERNETES_MODULE: {
    readonly id: 'kubernetes';
    readonly label: 'Kubernetes';
    readonly tint: 'var(--series-1)';
};
export declare function isModule(id: string): boolean;
export declare function modules(): ToolDefinition[];
export declare const TOOLS: readonly ToolDefinition[];
export declare function toolById(id: string): ToolDefinition | undefined;
//# sourceMappingURL=tools.d.ts.map