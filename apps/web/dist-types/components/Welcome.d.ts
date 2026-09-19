import { type AppSettings, type ClustersResponse } from '../lib/api.ts';
interface WelcomeProps {
    readonly settings: AppSettings | null;
    readonly clusters: ClustersResponse | null;
    readonly onFinish: () => void;
    readonly onOpenSettings: (section: string) => void;
}
export declare function Welcome({ settings, clusters, onFinish, onOpenSettings }: WelcomeProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Welcome.d.ts.map