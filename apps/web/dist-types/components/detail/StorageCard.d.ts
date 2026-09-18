interface EnvVar {
    name?: string;
    value?: string;
    valueFrom?: {
        secretKeyRef?: {
            name?: string;
            key?: string;
        };
        configMapKeyRef?: {
            name?: string;
            key?: string;
        };
    };
}
interface ContainerShape {
    name?: string;
    image?: string;
    env?: EnvVar[];
    ports?: Array<{
        name?: string;
        containerPort?: number;
    }>;
}
export interface StorageDetection {
    readonly product: string;
    readonly container: string;
    readonly port: number;
    readonly consolePort?: number | undefined;
    readonly access?: EnvVar | undefined;
    readonly secret?: EnvVar | undefined;
}
export declare function detectObjectStorage(containers: readonly ContainerShape[] | undefined): StorageDetection | null;
interface StorageCardProps {
    readonly detection: StorageDetection;
    readonly pod: string;
    readonly namespace: string;
    readonly podIP?: string | undefined;
    /** Decodes one key of a Secret in this namespace. Absent means no access. */
    readonly onRevealSecret?: ((secret: string, key: string) => Promise<string>) | undefined;
    readonly onOpenBrowser?: (() => void) | undefined;
}
export declare function StorageCard({ detection, pod, namespace, podIP, onRevealSecret, onOpenBrowser }: StorageCardProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=StorageCard.d.ts.map