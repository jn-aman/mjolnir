/**
 * The rail: one tile per module. Kubernetes, cloud access, containers,
 * object storage, databases, Kafka, certificates, image provenance. They are
 * peers; together they are Mjolnir. Nothing here is a cluster, because a
 * cluster belongs to one module. The settings gear sits below the modules.
 */
interface ModuleRailProps {
    readonly active: string;
    readonly onSelect: (id: string) => void;
    readonly onSettings: () => void;
    readonly settingsActive: boolean;
}
export declare function ModuleRail({ active, onSelect, onSettings, settingsActive }: ModuleRailProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ModuleRail.d.ts.map