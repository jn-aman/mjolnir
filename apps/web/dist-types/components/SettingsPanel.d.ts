import { type ClustersResponse } from '../lib/api.ts';
import type { ThemeChoice } from '../lib/theme.ts';
/**
 * Settings, in two scopes.
 *
 * Mjolnir is the product; Kubernetes is one of its modules. So the app has
 * its own settings (look, time, the assistant, the MCP server, the licence)
 * and the Kubernetes module has its own (kubeconfig, clusters, namespaces,
 * the tools that plug into it). Neither assumes the other. Sections that are
 * not built yet still have their place, so the layout does not move when
 * they arrive.
 */
export type SettingsScope = 'app' | 'kubernetes';
interface SettingsPanelProps {
    readonly scope: SettingsScope;
    readonly clusters: ClustersResponse | null;
    readonly theme: ThemeChoice;
    readonly onTheme: (choice: ThemeChoice) => void;
    readonly onReload: () => Promise<void>;
    readonly onClustersChanged: () => Promise<void>;
    /** Open on this section, e.g. "kubeconfig" from the + on the cluster strip. */
    readonly initialSection?: string | undefined;
    readonly onSectionShown?: (() => void) | undefined;
    /** Opens the first-run welcome again from the privacy section. */
    readonly onReplayWelcome?: (() => void) | undefined;
}
export declare function SettingsPanel({ scope, clusters, theme, onTheme, onReload, onClustersChanged, initialSection, onSectionShown, onReplayWelcome }: SettingsPanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=SettingsPanel.d.ts.map