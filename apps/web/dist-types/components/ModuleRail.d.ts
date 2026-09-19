/**
 * The rail: one tile per module. Kubernetes, cloud access, containers,
 * object storage, databases, Kafka, machines, alerts. They are peers; together
 * they are Mjolnir. Nothing here is a cluster, because a cluster belongs to one
 * module. The settings gear sits below the modules.
 *
 * The rail opens to read as words and closes to read as shapes. Icons alone are
 * fast once you know them and a guessing game before that, so the handle on the
 * rail's own edge turns the guess back into a name.
 */
export declare const RAIL_WIDTH: {
    readonly open: 178;
    readonly closed: 56;
};
interface ModuleRailProps {
    readonly active: string;
    readonly onSelect: (id: string) => void;
    readonly onSettings: () => void;
    readonly settingsActive: boolean;
    /** Names beside the icons. */
    readonly expanded: boolean;
    readonly onToggleExpanded: () => void;
}
export declare function ModuleRail({ active, onSelect, onSettings, settingsActive, expanded, onToggleExpanded }: ModuleRailProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ModuleRail.d.ts.map