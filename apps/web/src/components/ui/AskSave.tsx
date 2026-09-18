import { motion } from 'motion/react';
import { Check, X } from 'lucide-react';

/**
 * "You changed this and clicked away." The one rule for every inline editor:
 * nothing changed, it just closes; something changed, this asks, right where
 * the edit was, and nothing is lost until the person says so.
 */
export function AskSave({ what, onSave, onDiscard, busy = false }: { what: string; onSave: () => void; onDiscard: () => void; busy?: boolean }) {
  return (
    <motion.span
      data-ask-save
      data-testid="ask-save"
      initial={{ opacity: 0, y: 4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 32 }}
      className="inline-flex items-center gap-1 rounded-md border border-[var(--status-warn)] bg-warn-bg py-[2px] pl-2 pr-1 font-sans text-[11px] text-warn shadow-[var(--shadow-md)]"
    >
      <span className="whitespace-nowrap">Unsaved {what}</span>
      <button type="button" data-testid="ask-save-save" disabled={busy} onClick={onSave} className="inline-flex items-center gap-1 rounded-xs px-1.5 py-[1px] font-medium text-primary hover:bg-hover">
        <Check size={11} strokeWidth={2.4} aria-hidden /> Save
      </button>
      <button type="button" data-testid="ask-save-discard" disabled={busy} onClick={onDiscard} className="inline-flex items-center gap-1 rounded-xs px-1.5 py-[1px] text-secondary hover:bg-hover hover:text-primary">
        <X size={11} strokeWidth={2.4} aria-hidden /> Discard
      </button>
    </motion.span>
  );
}
