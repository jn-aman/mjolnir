import { type DockerContainer } from '../../lib/api.ts';
import { type MenuEntry } from '../ui/ContextMenu.tsx';
/** One container: what it is, its logs, and everything the engine knows. */
interface DockerDrawerProps {
    readonly context: string;
    readonly container: DockerContainer;
    readonly onClose: () => void;
    readonly onOpenDock: (tab: {
        kind: 'logs' | 'terminal';
        context: string;
        id: string;
        name: string;
    }) => void;
    readonly menu: (c: DockerContainer) => MenuEntry[];
}
export declare function DockerDrawer({ context, container, onClose, onOpenDock, menu }: DockerDrawerProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=DockerDrawer.d.ts.map