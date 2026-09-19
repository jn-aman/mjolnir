import * as Tooltip from '@radix-ui/react-tooltip';
import { AnimatePresence, motion } from 'motion/react';
import { Hexagon, Settings } from 'lucide-react';
import { KUBERNETES_MODULE, modules } from '../lib/tools.ts';
import { Menu } from './ui/ContextMenu.tsx';
import { EdgeToggle } from './ui/EdgeToggle.tsx';

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
export const RAIL_WIDTH = { open: 178, closed: 56 } as const;

interface ModuleRailProps {
  readonly active: string;
  readonly onSelect: (id: string) => void;
  readonly onSettings: () => void;
  readonly settingsActive: boolean;
  /** Names beside the icons. */
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
}

export function ModuleRail({ active, onSelect, onSettings, settingsActive, expanded, onToggleExpanded }: ModuleRailProps) {
  const entries = [
    { id: KUBERNETES_MODULE.id, label: KUBERNETES_MODULE.label, tint: KUBERNETES_MODULE.tint, icon: Hexagon, planned: false },
    ...modules().map((m) => ({ id: m.id, label: m.label, tint: m.tint, icon: m.icon, planned: m.built !== true })),
  ];
  return (
    <motion.nav
      data-testid="module-rail"
      data-expanded={expanded}
      aria-label="Modules"
      initial={false}
      animate={{ width: expanded ? RAIL_WIDTH.open : RAIL_WIDTH.closed }}
      transition={{ type: 'spring', stiffness: 460, damping: 40 }}
      className="relative flex shrink-0 flex-col gap-1 border-r border-line bg-sunken py-3"
    >
      <EdgeToggle
        open={expanded}
        onToggle={onToggleExpanded}
        label={expanded ? 'Collapse modules to icons' : 'Show module names'}
        hint="Alt B"
        testId="rail-toggle"
        top="68px"
      />

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
                  className={`group relative flex h-[38px] shrink-0 items-center ${expanded ? 'mx-2 gap-2.5 rounded-xl px-[5px] hover:bg-hover' : 'mx-auto w-[38px] justify-center'}`}
                  style={expanded ? { width: 'calc(100% - 16px)' } : undefined}
                >
                  {isActive ? (
                    <motion.span layoutId="module-rail-marker" aria-hidden className="absolute -left-[9px] h-[22px] w-[3px] rounded-r-full bg-accent" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
                  ) : null}
                  <motion.span
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                    className={`flex shrink-0 items-center justify-center border border-transparent ${expanded ? 'h-[28px] w-[28px] rounded-[10px]' : `h-full w-full rounded-xl ${isActive ? '' : 'group-hover:bg-hover'}`}`}
                    style={
                      isActive
                        ? { color: 'white', background: `linear-gradient(145deg, color-mix(in oklab, ${entry.tint} 100%, white 14%), color-mix(in oklab, ${entry.tint} 100%, black 22%))`, boxShadow: `0 1px 0 rgb(255 255 255 / 0.22) inset, 0 6px 16px color-mix(in oklab, ${entry.tint} 40%, transparent)` }
                        : { color: entry.tint, opacity: 0.82 }
                    }
                  >
                    <Icon size={expanded ? 15 : 18} strokeWidth={1.8} aria-hidden />
                  </motion.span>
                  <AnimatePresence initial={false}>
                    {expanded ? (
                      <motion.span
                        key="label"
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -6 }}
                        transition={{ duration: 0.14, ease: 'easeOut' }}
                        className="flex min-w-0 flex-1 flex-col text-left"
                      >
                        <span className={`break-words text-[12.5px] leading-[1.15] [overflow-wrap:anywhere] ${isActive ? 'font-medium text-primary' : 'text-secondary group-hover:text-primary'}`}>{entry.label}</span>
                        {entry.planned ? <span className="text-[9.5px] uppercase tracking-[0.06em] text-tertiary">planned</span> : null}
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </button>
              </Tooltip.Trigger>
            </Menu>
            {expanded ? null : (
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={8} className="rounded-md border border-line bg-overlay px-2 py-1 shadow-[var(--shadow-md)]">
                  <div className="text-[11.5px] text-primary">{entry.label}</div>
                  {entry.planned ? <div className="text-[10.5px] text-tertiary">planned</div> : null}
                </Tooltip.Content>
              </Tooltip.Portal>
            )}
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
            whileHover={{ scale: expanded ? 1 : 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 520, damping: 28 }}
            className={`relative flex h-[38px] shrink-0 items-center rounded-lg ${expanded ? 'mx-2 gap-2.5 px-[5px]' : 'mx-auto justify-center'} ${settingsActive ? 'bg-pressed text-accent' : 'text-tertiary hover:bg-hover hover:text-secondary'}`}
            style={{ width: expanded ? 'calc(100% - 16px)' : 38 }}
          >
            {settingsActive ? <motion.span layoutId="module-rail-marker" aria-hidden className="absolute -left-[9px] h-[22px] w-[3px] rounded-r-full bg-accent" transition={{ type: 'spring', stiffness: 420, damping: 34 }} /> : null}
            <span className="flex h-[28px] w-[28px] shrink-0 items-center justify-center">
              <Settings size={17} strokeWidth={1.8} />
            </span>
            {expanded ? <span className="break-words text-[12.5px] [overflow-wrap:anywhere]">Mjolnir settings</span> : null}
          </motion.button>
        </Tooltip.Trigger>
        {expanded ? null : (
          <Tooltip.Portal>
            <Tooltip.Content side="right" sideOffset={8} className="rounded-md border border-line bg-overlay px-2 py-1 text-[11.5px] text-primary shadow-[var(--shadow-md)]">Mjolnir settings</Tooltip.Content>
          </Tooltip.Portal>
        )}
      </Tooltip.Root>
    </motion.nav>
  );
}
