import { useRef, useState } from 'react';
import { AskSave } from '../ui/AskSave.tsx';
import { useOutsideClick } from '../../lib/useOutsideClick.ts';
import { Check, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'motion/react';
import { copyEntry, Menu, SEPARATOR, type MenuEntry } from '../ui/ContextMenu.tsx';
import { BIG_VALUE, ValueViewer } from '../ui/ValueViewer.tsx';

/**
 * Labels and annotations, edited in place.
 *
 * These are the one thing that is patchable on every object in the cluster, so
 * they are where "the overview is editable" starts. Each chip edits on click;
 * a key is removed with its ×; a new pair is added from the trailing +. Every
 * change is one merge patch, `{ [key]: value }` to set, `{ [key]: null }` to
 * remove, so nothing else on the object is touched and a concurrent change to
 * a different field cannot be overwritten.
 *
 * Keys are not renamed in place: Kubernetes has no rename, only remove-and-add,
 * and pretending otherwise would hide that two operations happen.
 */

interface EditableKeyValuesProps {
  readonly values: Record<string, string>;
  /** Sends a merge patch for this map alone and resolves when applied. */
  readonly onPatch: (patch: Record<string, string | null>) => Promise<void>;
  readonly testId?: string;
  readonly validateKey?: ((key: string) => string | null) | undefined;
  readonly validateValue?: ((value: string) => string | null) | undefined;
}

export function EditableKeyValues({ values, onPatch, testId, validateKey, validateValue }: EditableKeyValuesProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ key: string; value: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [askingEdit, setAskingEdit] = useState(false);
  const [askingAdd, setAskingAdd] = useState(false);
  const editBox = useRef<HTMLSpanElement>(null);
  const addBox = useRef<HTMLSpanElement>(null);
  useOutsideClick(editBox, editingKey !== null, () => {
    if (editingKey !== null && draft.trim() !== values[editingKey]) {
      setAskingEdit(true);
      return true;
    }
    setEditingKey(null);
    setAskingEdit(false);
    return false;
  });
  useOutsideClick(addBox, adding, () => {
    if (newKey.trim() || newValue.trim()) {
      setAskingAdd(true);
      return true;
    }
    setAdding(false);
    return false;
  });
  const stopAdding = () => {
    setAdding(false);
    setAskingAdd(false);
    setNewKey('');
    setNewValue('');
  };

  const run = async (label: string, patch: Record<string, string | null>) => {
    setBusy(label);
    try {
      await onPatch(patch);
    } catch (error) {
      toast.error(`Could not update: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const editProblem = editingKey !== null ? (validateValue?.(draft.trim()) ?? null) : null;
  const addProblem = adding ? (validateKey?.(newKey.trim()) ?? (newKey.trim() ? (validateValue?.(newValue.trim()) ?? null) : null)) : null;

  const commitEdit = async (key: string) => {
    const next = draft.trim();
    if (validateValue?.(next)) return;
    setEditingKey(null);
    setAskingEdit(false);
    if (next === values[key]) return;
    await run(key, { [key]: next });
  };

  const commitAdd = async () => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key) {
      stopAdding();
      return;
    }
    if (validateKey?.(key) || validateValue?.(value)) return;
    stopAdding();
    await run(key, { [key]: value });
  };

  const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={testId}>
      <ValueViewer
        open={opened !== null}
        title={opened?.key ?? ''}
        subtitle={testId === 'annotations' ? 'annotation' : 'label'}
        value={opened?.value ?? ''}
        onClose={() => setOpened(null)}
      />
      <AnimatePresence initial={false}>
      {entries.map(([key, value]) => {
        const isEditing = editingKey === key;
        const isBusy = busy === key;
        const chipMenu: MenuEntry[] = [
          ...(value.length > BIG_VALUE
            ? [{ id: 'open', label: 'Open the value', onSelect: () => setOpened({ key, value }) }]
            : []),
          {
            id: 'edit',
            label: 'Edit value',
            onSelect: () => {
              setEditingKey(key);
              setDraft(value);
            },
          },
          SEPARATOR,
          ...copyEntry('copy-pair', 'Copy key=value', `${key}=${value}`),
          ...copyEntry('copy-key', 'Copy key', key),
          ...copyEntry('copy-value', 'Copy value', value),
          SEPARATOR,
          { id: 'remove', label: 'Remove', danger: true, onSelect: () => void run(key, { [key]: null }) },
        ];
        return (
          <Menu key={key} label={key} entries={chipMenu} testId="kv-menu">
          <motion.span
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 520, damping: 32 }}
            data-testid="kv-chip"
            className={`group inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border bg-overlay py-[3px] pl-2 pr-1 font-mono text-[11px] transition-colors duration-100 ${
              isEditing ? 'border-focus' : 'border-[var(--border-strong)] hover:border-focus'
            } ${isBusy ? 'opacity-50' : ''}`}
          >
            <span className="max-w-[280px] shrink-0 truncate text-secondary">{key}</span>
            <span className="shrink-0 text-tertiary">=</span>
            {isEditing ? (
              <span ref={editBox} className="relative inline-flex">
              <input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void commitEdit(key);
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingKey(null);
                    setAskingEdit(false);
                  }
                }}
                aria-label={`Value for ${key}`}
                style={{ width: `${Math.max(value.length, draft.length, 6) + 2}ch`, maxWidth: '60vw' }}
                className="bg-transparent text-primary outline-none"
              />
              {editProblem ? (
                <span className="absolute left-0 top-full z-20 mt-1.5 whitespace-nowrap rounded-md border border-[var(--status-error-border)] bg-error-bg px-2 py-1 font-sans text-[11px] text-error shadow-[var(--shadow-md)]" data-testid="edit-error">{editProblem}</span>
              ) : null}
              {askingEdit && !editProblem ? (
                <span className="absolute left-0 top-full z-20 mt-1.5">
                  <AskSave what={key} onSave={() => void commitEdit(key)} onDiscard={() => { setEditingKey(null); setAskingEdit(false); }} />
                </span>
              ) : null}
              </span>
            ) : value.length > BIG_VALUE ? (
              // `last-applied-configuration` is a whole manifest inside an
              // annotation. An inline edit box is the wrong tool for it and a
              // tooltip is worse: eight lines of dense JSON nobody can select,
              // search or fold. Anything this size opens in the same viewer a
              // file gets.
              <button
                type="button"
                data-testid="kv-open"
                onClick={() => setOpened({ key, value })}
                aria-label={`Open ${key}`}
                className="min-w-0 max-w-[360px] truncate border-b border-dashed border-[var(--border-strong)] text-left text-primary transition-colors duration-100 hover:border-accent hover:text-accent"
              >
                {value}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingKey(key);
                  setDraft(value);
                }}
                aria-label={`Edit ${key}`}
                className="max-w-[360px] truncate border-b border-dashed border-[var(--border-strong)] text-left text-primary transition-colors duration-100 hover:border-accent"
              >
                {value || <span className="text-tertiary">(empty)</span>}
              </button>
            )}
            {isEditing ? (
              <Check size={12} strokeWidth={2.4} aria-hidden className="ml-0.5 text-accent" />
            ) : (
              <>
                <button
                  type="button"
                  aria-label={`Remove ${key}`}
                  disabled={isBusy}
                  onClick={() => void run(key, { [key]: null })}
                  className="ml-0.5 rounded-xs p-[1px] text-transparent hover:bg-error-bg hover:text-error group-hover:text-tertiary"
                >
                  <X size={11} strokeWidth={2.4} />
                </button>
              </>
            )}
          </motion.span>
          </Menu>
        );
      })}
      </AnimatePresence>

      {adding ? (
        <span ref={addBox} className="relative inline-flex items-center gap-1 rounded-md border border-focus bg-overlay py-[3px] pl-2 pr-1 font-mono text-[11px]" data-testid="kv-add-row">
          <input
            autoFocus
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                stopAdding();
              }
            }}
            placeholder="key"
            aria-label="New key"
            className="w-[120px] bg-transparent text-secondary outline-none placeholder:text-tertiary"
          />
          <span className="text-tertiary">=</span>
          <input
            value={newValue}
            onChange={(event) => setNewValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commitAdd();
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                stopAdding();
              }
            }}
            placeholder="value"
            aria-label="New value"
            className="w-[140px] bg-transparent text-primary outline-none placeholder:text-tertiary"
          />
          <button
            type="button"
            aria-label="Add"
            onClick={() => void commitAdd()}
            className="rounded-xs p-[1px] text-accent hover:bg-hover"
          >
            <Check size={12} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            aria-label="Cancel"
            onClick={stopAdding}
            className="rounded-xs p-[1px] text-tertiary hover:bg-hover hover:text-primary"
          >
            <X size={12} strokeWidth={2.4} />
          </button>
          {addProblem && (newKey.trim() || newValue.trim()) ? (
            <span className="absolute left-0 top-full z-20 mt-1.5 whitespace-nowrap rounded-md border border-[var(--status-error-border)] bg-error-bg px-2 py-1 font-sans text-[11px] text-error shadow-[var(--shadow-md)]" data-testid="edit-error">{addProblem}</span>
          ) : null}
          {askingAdd && !addProblem ? (
            <span className="absolute left-0 top-full z-20 mt-1.5">
              <AskSave what="entry" onSave={() => void commitAdd()} onDiscard={stopAdding} />
            </span>
          ) : null}
        </span>
      ) : (
        <button
          type="button"
          data-testid="kv-add"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--border-strong)] px-2 py-[3px] font-mono text-[11px] text-tertiary transition-colors duration-100 hover:border-accent hover:text-accent"
        >
          <Plus size={11} strokeWidth={2.4} aria-hidden />
          add
        </button>
      )}
    </div>
  );
}
