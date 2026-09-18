import type { ToolDefinition } from '../../lib/tools.ts';
/**
 * The Containers module.
 *
 * Every engine on this machine (OrbStack, Docker Desktop, Colima, rootless)
 * is a context in the picker. Each section is the same list component the
 * Kubernetes module uses, so columns resize, reorder, hide and remember the
 * same way, and every row has its menu.
 */
export type DockerSection = 'containers' | 'images' | 'volumes' | 'networks' | 'compose' | 'system' | 'registries';
interface DockerModuleProps {
    readonly tool: ToolDefinition;
    readonly section: DockerSection;
    readonly onOpenDock: (tab: {
        kind: 'logs' | 'terminal';
        context: string;
        id: string;
        name: string;
    }) => void;
}
export declare function DockerModule({ tool, section, onOpenDock }: DockerModuleProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=DockerModule.d.ts.map