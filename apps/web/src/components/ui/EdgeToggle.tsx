import * as Tooltip from '@radix-ui/react-tooltip';
import { motion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';

/**
 * The handle that opens and closes a panel, living on the panel's own edge.
 *
 * A collapse control belongs to the thing it collapses. Putting it in the
 * header means guessing which panel it means, and putting it at the bottom of
 * a scrolling list means hunting for it. On the edge it is always in the same
 * place, it points the way the panel will move, and it is the one pixel column
 * your pointer is already crossing on its way out of the panel.
 */
interface EdgeToggleProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Read aloud, and shown in the tooltip. */
  readonly label: string;
  readonly hint?: string | undefined;
  readonly testId: string;
  /** Where on the edge it sits. Centred by default. */
  readonly top?: string | undefined;
}

export function EdgeToggle({ open, onToggle, label, hint, testId, top = '50%' }: EdgeToggleProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <motion.button
          type="button"
          data-testid={testId}
          data-open={open}
          aria-label={label}
          aria-expanded={open}
          onClick={onToggle}
          initial={false}
          whileHover={{ scale: 1.14 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 520, damping: 26 }}
          className="group/edge absolute -right-[10px] z-40 flex h-[54px] w-[20px] items-center justify-center opacity-55 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100"
          style={{ top, marginTop: -27, ['WebkitAppRegion' as string]: 'no-drag' }}
        >
          <span
            aria-hidden
            className="flex h-[42px] w-[15px] items-center justify-center rounded-full border border-line bg-raised text-tertiary shadow-[var(--shadow-md)] transition-colors duration-150 group-hover/edge:border-accent group-hover/edge:bg-accent-subtle group-hover/edge:text-accent"
            style={{ boxShadow: '0 1px 0 var(--highlight) inset, var(--shadow-md)' }}
          >
            <motion.span
              animate={{ rotate: open ? 0 : 180 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="flex"
            >
              <ChevronLeft size={11} strokeWidth={2.6} />
            </motion.span>
          </span>
        </motion.button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" sideOffset={8} className="rounded-md border border-line bg-overlay px-2 py-1 shadow-[var(--shadow-md)]">
          <div className="text-[11.5px] text-primary">{label}</div>
          {hint ? <div className="text-[10.5px] text-tertiary">{hint}</div> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
