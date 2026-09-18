import type { ClustersResponse } from '../lib/api.ts';
import type { ThemeChoice } from '../lib/theme.ts';
/**
 * Settings.
 *
 * Kubeconfig comes first because it is the only setting that can leave someone
 * unable to use the app at all. If a file in `KUBECONFIG` is unreadable, that
 * is stated here with the path and the reason rather than swallowed — a tool
 * that silently shows fewer clusters than you have is worse than one that
 * refuses to start.
 */
interface SettingsPanelProps {
    readonly clusters: ClustersResponse | null;
    readonly theme: ThemeChoice;
    readonly onTheme: (choice: ThemeChoice) => void;
    readonly onReload: () => Promise<void>;
}
export declare function SettingsPanel({ clusters, theme, onTheme, onReload }: SettingsPanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=SettingsPanel.d.ts.map