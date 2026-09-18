import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { tags } from '@lezer/highlight';
import { stringify } from 'yaml';
import { Check, Pencil, RotateCcw, X } from 'lucide-react';
import { Button } from './ui/Button.tsx';

/**
 * A YAML editor, because a tab called YAML has to show YAML.
 *
 * The API returns JSON. Rendering that JSON under a YAML label is not a small
 * wrong: YAML is what people paste into `kubectl apply`, what their manifests
 * are written in, and what they read in every other tool. So the object is
 * serialised as YAML here, edited as YAML, and parsed back on the way out.
 *
 * Fields the server owns are dropped before display, `managedFields`,
 * `resourceVersion`, `uid`, `creationTimestamp` and the like. They are noise to
 * read, and re-submitting them is how an apply fails with a conflict.
 */

const SERVER_OWNED = new Set([
  'managedFields',
  'resourceVersion',
  'uid',
  'creationTimestamp',
  'generation',
  'selfLink',
]);

export function toEditableYaml(object: unknown): string {
  if (!object || typeof object !== 'object') return stringify(object ?? null);
  const source = object as Record<string, unknown>;
  const metadata =
    source['metadata'] && typeof source['metadata'] === 'object'
      ? Object.fromEntries(
          Object.entries(source['metadata'] as Record<string, unknown>).filter(
            ([key]) => !SERVER_OWNED.has(key),
          ),
        )
      : source['metadata'];
  // Key order is meaningful to a reader: apiVersion and kind first, status last.
  const ordered: Record<string, unknown> = {};
  for (const key of ['apiVersion', 'kind', 'metadata', 'spec']) {
    if (key in source) ordered[key] = key === 'metadata' ? metadata : source[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in ordered) && key !== 'status') ordered[key] = value;
  }
  if ('status' in source) ordered['status'] = source['status'];
  return stringify(ordered, { lineWidth: 0 });
}

/** Colours come from the tokens, so the editor follows the theme with the app. */
const storm = EditorView.theme({
  '&': {
    backgroundColor: 'var(--surface-sunken)',
    color: 'var(--log-body)',
    fontSize: '12.5px',
    height: '100%',
  },
  '.cm-content': { fontFamily: 'var(--font-mono)', padding: '10px 0', caretColor: 'var(--accent-base)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '19px' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface-sunken)',
    color: 'var(--log-gutter)',
    border: 'none',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-hover)' },
  '.cm-activeLine': { backgroundColor: 'var(--surface-hover)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--accent-subtle) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--accent-base)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--accent-subtle)', outline: '1px solid var(--border-strong)' },
  '&.cm-focused': { outline: 'none' },
});

const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--accent-base)' },
  { tag: tags.string, color: 'var(--status-ok)' },
  { tag: tags.number, color: 'var(--status-warn)' },
  { tag: tags.bool, color: 'var(--log-pod-b)' },
  { tag: tags.null, color: 'var(--text-tertiary)' },
  { tag: tags.comment, color: 'var(--text-tertiary)', fontStyle: 'italic' },
  { tag: tags.punctuation, color: 'var(--text-tertiary)' },
]);

interface YamlEditorProps {
  readonly value: string;
  /** Called with the edited text. Absent means read-only. */
  readonly onApply?: ((text: string) => Promise<void>) | undefined;
  readonly testId?: string;
  /** Opens already editing, for a document that exists to be written. */
  readonly startEditing?: boolean;
  readonly applyLabel?: string;
  readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
  /** Hands the caller apply and discard, so a guard elsewhere can offer Save. */
  readonly controller?: ((api: { apply: () => Promise<void>; discard: () => void }) => void) | undefined;
}

export function YamlEditor({ value, onApply, testId = 'yaml-editor', startEditing = false, applyLabel = 'Apply', onDirtyChange, controller }: YamlEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const setDirty = (next: boolean) => {
    setDirtyState(next);
    onDirtyChange?.(next);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opens read-only. Reading is the common case; a cursor blinking in a
  // production manifest you only meant to look at is an invitation to an
  // accident. Edit is one click, and it is deliberate.
  const [editing, setEditing] = useState(startEditing);

  useEffect(() => {
    if (!host.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        yaml(),
        syntaxHighlighting(highlight),
        storm,
        EditorState.readOnly.of(!onApply || !editing),
        EditorView.editable.of(Boolean(onApply) && editing),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setDirty(update.state.doc.toString() !== value);
            setError(null);
          }
        }),
      ],
    });

    const editor = new EditorView({ state, parent: host.current });
    view.current = editor;
    return () => editor.destroy();
    // The editor owns its document after mount; a new `value` means a new
    // object was selected, and the drawer remounts this component for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, Boolean(onApply), editing]);

  const reset = () => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    setDirty(false);
    setError(null);
  };

  const cancel = () => {
    reset();
    setEditing(false);
  };

  const apply = async () => {
    const editor = view.current;
    if (!editor || !onApply) return;
    setBusy(true);
    setError(null);
    try {
      await onApply(editor.state.doc.toString());
      setDirty(false);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    controller?.({ apply, discard: cancel });
    // apply/cancel close over fresh state each render; re-handing them is the point.
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={testId}>
      {onApply ? (
        <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-line bg-raised px-3">
          {editing ? (
            <>
              <span className="text-[11.5px] text-tertiary">
                {dirty ? 'Unsaved changes' : 'Editing. Server-owned fields are hidden.'}
              </span>
              <div className="flex-1" />
              {startEditing ? null : (
                <Button variant="ghost" disabled={busy} onClick={cancel} icon={<X size={13} strokeWidth={2} />}>
                  Cancel
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={!dirty || busy}
                onClick={reset}
                icon={<RotateCcw size={13} strokeWidth={1.9} />}
              >
                Reset
              </Button>
              <Button
                variant="primary"
                data-testid="yaml-apply"
                disabled={!dirty || busy}
                onClick={() => void apply()}
                icon={<Check size={13} strokeWidth={2.2} />}
              >
                {busy ? `${applyLabel === 'Apply' ? 'Applying' : applyLabel.replace(/e$/, '')}ing…` : applyLabel}
              </Button>
            </>
          ) : (
            <>
              <span className="text-[11.5px] text-tertiary">Read-only. Server-owned fields are hidden.</span>
              <div className="flex-1" />
              <Button
                data-testid="yaml-edit"
                onClick={() => setEditing(true)}
                icon={<Pencil size={13} strokeWidth={1.9} />}
              >
                Edit
              </Button>
            </>
          )}
        </div>
      ) : null}
      {error ? (
        <div className="shrink-0 border-b border-[var(--status-error-border)] bg-error-bg px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      ) : null}
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}
