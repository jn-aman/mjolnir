import { useEffect, useRef, useState } from 'react';
import { AskSave } from './AskSave.tsx';
import { useOutsideClick } from '../../lib/useOutsideClick.ts';
import * as Tooltip from '@radix-ui/react-tooltip';
import { toast } from 'sonner';

/**
 * A value you can click to change.
 *
 * The affordance is a dashed underline, always visible. A pencil that appears
 * on hover tells you nothing until you are already hovering, and then it does
 * not say what it edits. An underline on the value itself says "this, here".
 * Where a value cannot change, the underline is gone and the tooltip says why.
 */
interface EditableTextProps {
  readonly value: string;
  readonly label: string;
  readonly onCommit: (next: string) => Promise<void>;
  readonly mono?: boolean;
  readonly disabledReason?: string | undefined;
  readonly className?: string;
  readonly testId?: string;
  /** Returns a sentence when the draft is not acceptable; saving is blocked. */
  readonly validate?: ((next: string) => string | null) | undefined;
}

export function EditableText({ value, label, onCommit, mono = true, disabledReason, className = '', testId, validate }: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const changed = draft.trim() !== value && draft.trim() !== '';
  const problem = editing && changed ? (validate?.(draft.trim()) ?? null) : null;
  // Click away: unchanged closes, changed asks. Never a silent save, never a silent loss.
  useOutsideClick(box, editing, () => {
    if (!changed) {
      setEditing(false);
      setAsking(false);
      return false;
    }
    setAsking(true);
    return true;
  });

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = async () => {
    const next = draft.trim();
    if (next && next !== value && validate?.(next)) return; // the sentence under the box says why
    setEditing(false);
    setAsking(false);
    if (!next || next === value) return;
    setBusy(true);
    try {
      await onCommit(next);
    } catch (error) {
      toast.error(`Could not update ${label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <span ref={box} className="relative inline-flex items-center gap-1.5">
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void commit();
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setEditing(false);
            setAsking(false);
          }
        }}
        aria-label={label}
        data-testid={testId ? `${testId}-input` : undefined}
        style={{ width: `${Math.max(value.length, draft.length, 4) + 2}ch`, maxWidth: '100%' }}
        aria-invalid={problem ? true : undefined}
        className={`rounded-xs border bg-sunken px-1 text-primary outline-none ${problem ? 'border-[var(--status-error)]' : 'border-focus'} ${mono ? 'font-mono' : ''} ${className}`}
      />
      {problem ? (
        <span className="absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded-md border border-[var(--status-error-border)] bg-error-bg px-2 py-1 font-sans text-[11px] text-error shadow-[var(--shadow-md)]" data-testid="edit-error">
          {problem}
        </span>
      ) : null}
      {asking && !problem ? (
        <span className="absolute left-0 top-full z-20 mt-1">
          <AskSave what={label} busy={busy} onSave={() => void commit()} onDiscard={() => { setEditing(false); setAsking(false); }} />
        </span>
      ) : null}
      </span>
    );
  }

  const inner = disabledReason ? (
    <span
      tabIndex={0}
      data-testid={testId}
      className={`cursor-not-allowed ${mono ? 'font-mono' : ''} ${className}`}
    >
      {value}
    </span>
  ) : (
    <button
      type="button"
      data-testid={testId}
      aria-label={`Edit ${label}`}
      disabled={busy}
      onClick={() => setEditing(true)}
      className={`max-w-full break-words border-b border-dashed border-[var(--border-strong)] text-left transition-colors duration-100 hover:border-accent hover:text-primary ${
        mono ? 'font-mono' : ''
      } ${busy ? 'opacity-50' : ''} ${className}`}
    >
      {value}
    </button>
  );

  return (
    <Tooltip.Root delayDuration={500}>
      <Tooltip.Trigger asChild>{inner}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          className="z-50 max-w-[280px] rounded-md border border-line bg-overlay px-2 py-1 text-[11.5px] text-primary shadow-[var(--shadow-md)]"
        >
          {disabledReason ?? `Click to edit ${label}`}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
