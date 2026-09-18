import * as Tooltip from '@radix-ui/react-tooltip';
import { motion } from 'motion/react';
import { Hexagon, Settings } from 'lucide-react';
import { KUBERNETES_MODULE, modules } from '../lib/tools.ts';
import { Menu } from './ui/ContextMenu.tsx';

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

export function ModuleRail({ active, onSelect, onSettings, settingsActive }: ModuleRailProps) {
  const entries = [
    { id: KUBERNETES_MODULE.id, label: KUBERNETES_MODULE.label, tint: KUBERNETES_MODULE.tint, icon: Hexagon, planned: false },
    ...modules().map((m) => ({ id: m.id, label: m.label, tint: m.tint, icon: m.icon, planned: true })),
  ];
  return (
    <nav data-testid="module-rail" aria-label="Modules" className="flex w-[56px] shrink-0 flex-col items-center gap-1 border-r border-line bg-sunken py-3">
      {entries.map((entry) => {
        const Icon = entry.icon;
        const isActive = entry.id === active && !settingsActive;
        return (
          <Tooltip.Root key={entry.id}>
            <Menu label={entry.label} entries={[{ id: 'open', label: `Open ${entry.label}`, onSelect: () => onSelect(entry.id) }]} testId="module-menu">
            <Tooltip.Trigger asChild>
              <button
                type="button"
                data-testid={`module-${entry.id}`}
                data-active={isActive}
                onClick={() => onSelect(entry.id)}
                aria-label={entry.label}
                aria-current={isActive ? 'true' : undefined}
                className="group relative flex h-[38px] w-[38px] items-center justify-center"
              >
                {isActive ? (
                  <motion.span layoutId="module-rail-marker" aria-hidden className="absolute -left-[9px] h-[22px] w-[3px] rounded-r-full bg-accent" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
                ) : null}
                <motion.span
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.94 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                  className={`flex h-full w-full items-center justify-center rounded-lg border ${isActive ? 'border-transparent bg-pressed' : 'border-transparent group-hover:bg-hover'}`}
                  style={{ color: entry.tint, opacity: isActive ? 1 : 0.78 }}
                >
                  <Icon size={18} strokeWidth={1.8} aria-hidden />
                </motion.span>
              </button>
            </Tooltip.Trigger>
            </Menu>
            <Tooltip.Portal>
              <Tooltip.Content side="right" sideOffset={8} className="rounded-md border border-line bg-overlay px-2 py-1 shadow-[var(--shadow-md)]">
                <div className="text-[11.5px] text-primary">{entry.label}</div>
                {entry.planned ? <div className="text-[10.5px] text-tertiary">planned</div> : null}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        );
      })}

      <div className="flex-1" />
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <motion.button
            type="button"
            data-testid="rail-settings"
            onClick={onSettings}
            aria-label="Mjolnir settings"
            aria-current={settingsActive ? 'true' : undefined}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 520, damping: 28 }}
            className={`relative flex h-[38px] w-[38px] items-center justify-center rounded-lg ${settingsActive ? 'bg-pressed text-accent' : 'text-tertiary hover:bg-hover hover:text-secondary'}`}
          >
            {settingsActive ? <motion.span layoutId="module-rail-marker" aria-hidden className="absolute -left-[9px] h-[22px] w-[3px] rounded-r-full bg-accent" transition={{ type: 'spring', stiffness: 420, damping: 34 }} /> : null}
            <Settings size={17} strokeWidth={1.8} />
          </motion.button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="right" sideOffset={8} className="rounded-md border border-line bg-overlay px-2 py-1 text-[11.5px] text-primary shadow-[var(--shadow-md)]">Mjolnir settings</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </nav>
  );
}
