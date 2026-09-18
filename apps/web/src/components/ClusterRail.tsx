import * as Tooltip from '@radix-ui/react-tooltip';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import type { ClusterContext } from '@mjolnir/k8s';

/**
 * The cluster rail.
 *
 * Every cluster you have is one tile, always visible, so switching is one click
 * from anywhere rather than a dropdown you have to open first. The selection
 * marker is a single element that *moves* between tiles rather than one bar
 * fading out while another fades in — which is what makes the switch read as a
 * movement rather than a repaint.
 */

const PROVIDER_TINT: Record<string, string> = {
  eks: 'var(--series-4)',
  aks: 'var(--series-1)',
  gke: 'var(--series-2)',
  kind: 'var(--series-3)',
  minikube: 'var(--series-3)',
  k3s: 'var(--series-3)',
  openshift: 'var(--status-error)',
  other: 'var(--text-tertiary)',
};

/** Two letters from the context name — "prod-eu-west" becomes "PE". */
function initials(name: string): string {
  const parts = name.split(/[-_./]/).filter(Boolean);
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
}

interface ClusterRailProps {
  readonly contexts: readonly ClusterContext[];
  readonly current: string | null;
  readonly onSelect: (name: string) => void;
  readonly onAdd: () => void;
}

export function ClusterRail({ contexts, current, onSelect, onAdd }: ClusterRailProps) {
  return (
    <nav
      data-testid="cluster-rail"
      aria-label="Clusters"
      className="flex w-[56px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-sunken py-3"
    >
      {contexts.map((context) => {
        const active = context.name === current;
        return (
          <Tooltip.Root key={context.name}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                data-testid={`cluster-tile-${context.name}`}
                data-active={active}
                onClick={() => onSelect(context.name)}
                aria-label={context.name}
                aria-current={active ? 'true' : undefined}
                className="group relative flex h-[36px] w-[36px] items-center justify-center"
              >
                {active ? (
                  <motion.span
                    // One element shared across tiles: it slides to the new one.
                    layoutId="cluster-rail-marker"
                    aria-hidden
                    className="absolute -left-3 h-[20px] w-[3px] rounded-r-full bg-accent"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                ) : null}
                <motion.span
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.94 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                  className={`flex h-full w-full items-center justify-center rounded-lg border text-[12px] font-semibold ${
                    active
                      ? 'border-transparent bg-pressed text-primary'
                      : 'border-line bg-raised text-tertiary group-hover:border-strong group-hover:text-secondary'
                  }`}
                >
                  {initials(context.name)}
                </motion.span>
                <span
                  aria-hidden
                  className="absolute -bottom-px right-0 h-[7px] w-[7px] rounded-full border-2 border-[var(--surface-sunken)]"
                  style={{ background: PROVIDER_TINT[context.provider] ?? 'var(--text-tertiary)' }}
                />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="right"
                sideOffset={8}
                className="rounded-md border border-line bg-overlay px-2 py-1 shadow-[var(--shadow-md)]"
              >
                <div className="font-mono text-[11.5px] text-primary">{context.name}</div>
                {context.server ? (
                  <div className="font-mono text-[10.5px] text-tertiary">{context.server}</div>
                ) : null}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        );
      })}

      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <motion.button
            type="button"
            data-testid="cluster-add"
            onClick={onAdd}
            aria-label="Add a cluster"
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 520, damping: 28 }}
            className="mt-1 flex h-[36px] w-[36px] items-center justify-center rounded-lg border border-dashed border-[var(--border-strong)] text-tertiary hover:border-accent hover:text-accent"
          >
            <Plus size={15} strokeWidth={2} />
          </motion.button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="right"
            sideOffset={8}
            className="rounded-md border border-line bg-overlay px-2 py-1 text-[11.5px] text-primary shadow-[var(--shadow-md)]"
          >
            Add a kubeconfig
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </nav>
  );
}
