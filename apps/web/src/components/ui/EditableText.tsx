import { useEffect, useState } from 'react';
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
}

export function EditableText({ value, label, onCommit, mono = true, disabledReason, className = '', testId }: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
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
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void commit();
          if (event.key === 'Escape') setEditing(false);
        }}
        aria-label={label}
        data-testid={testId ? `${testId}-input` : undefined}
        size={Math.max(8, Math.min(60, draft.length + 2))}
        className={`rounded-xs border border-focus bg-sunken px-1 text-primary outline-none ${mono ? 'font-mono' : ''} ${className}`}
      />
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
