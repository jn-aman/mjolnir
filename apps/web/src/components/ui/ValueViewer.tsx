import { useMemo, useState } from 'react';
import { Copy, Download, Maximize2, Minimize2 } from 'lucide-react';
import { parse as parseYaml } from 'yaml';
import { Modal } from './Modal.tsx';
import { Button } from './Button.tsx';
import { copyText } from './ContextMenu.tsx';
import { DataTree } from '../storage/DataTree.tsx';
import { YamlEditor, languageFor, type EditorLanguage } from '../YamlEditor.tsx';
import { formatBytes } from '../columns.tsx';

/**
 * One value, big enough to deserve a window.
 *
 * `kubectl.kubernetes.io/last-applied-configuration` is a whole manifest
 * squeezed into an annotation, and the honest answer to someone clicking it is
 * not a tooltip containing eight lines of dense JSON they cannot select,
 * search or fold. It is the same viewer a file gets: a tree with search when
 * the value parses, the source when it does not, and a way to copy the part
 * they came for rather than the whole thing.
 *
 * The threshold is deliberately low. A short value shows in place; anything
 * that would need wrapping is better as a window, because the moment a value
 * needs two lines it needs the ability to be read properly.
 */
export const BIG_VALUE = 200;

export function ValueViewer({
  open,
  title,
  subtitle,
  value,
  language: forced,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string | undefined;
  value: string;
  /** When the caller knows: a ConfigMap key ending .sh is shell, not JSON. */
  language?: EditorLanguage | undefined;
  onClose: () => void;
}) {
  const [view, setView] = useState<'tree' | 'source'>('tree');
  // Some values are a whole script or a whole manifest, and a modal two
  // thirds the height of the window is not where you read one.
  const [full, setFull] = useState(false);

  /**
   * JSON first, then YAML, then neither.
   *
   * An annotation's value is text as far as Kubernetes is concerned, so the
   * only way to know what it is, is to try. Failing to parse is not an error
   * worth showing: it means the source view is the honest one.
   */
  const structure = useMemo<{ value: unknown } | null>(() => {
    const text = value.trim();
    if (!text) return null;
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return { value: JSON.parse(text) as unknown };
      } catch {
        return null;
      }
    }
    if (/^\s*\w[\w.-]*\s*:/m.test(text)) {
      try {
        const parsed = parseYaml(text) as unknown;
        if (parsed !== null && typeof parsed === 'object') return { value: parsed };
      } catch {
        return null;
      }
    }
    return null;
  }, [value]);

  const language: EditorLanguage =
    forced ??
    (structure ? (value.trim().startsWith('{') || value.trim().startsWith('[') ? 'json' : 'yaml') : languageFor(title));
  const showing = structure ? view : 'source';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={
        <span className="font-mono">
          {subtitle ? `${subtitle} · ` : ''}
          {formatBytes(new TextEncoder().encode(value).length)}
          {structure ? ` · ${language}` : ''}
        </span>
      }
      width={full ? 2400 : 980}
      testId="value-viewer"
      footer={
        <>
          {structure ? (
            <span className="flex items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5" role="tablist" aria-label="View">
              {(['tree', 'source'] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  aria-selected={showing === entry}
                  data-testid={`value-view-${entry}`}
                  onClick={() => setView(entry)}
                  className={`h-[22px] rounded-sm px-2.5 text-[12px] capitalize transition-colors duration-100 ${
                    showing === entry ? 'bg-raised text-primary shadow-[0_1px_0_var(--highlight)_inset]' : 'text-tertiary hover:text-secondary'
                  }`}
                >
                  {entry}
                </button>
              ))}
            </span>
          ) : null}
          <Button
            variant="ghost"
            data-testid="value-fullscreen"
            onClick={() => setFull((current) => !current)}
            icon={full ? <Minimize2 size={12} strokeWidth={1.9} /> : <Maximize2 size={12} strokeWidth={1.9} />}
            hint={full ? 'Back to a window' : 'Use the whole window'}
          >
            {full ? 'Restore' : 'Full screen'}
          </Button>
          <Button variant="ghost" onClick={() => copyText(value, 'Value copied')} icon={<Copy size={12} strokeWidth={1.9} />}>
            Copy
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([value], { type: 'text/plain' }));
              const link = document.createElement('a');
              link.href = url;
              link.download = `${title.replace(/[^\w.-]+/g, '-')}.${language === 'plain' ? 'txt' : language}`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 10_000);
            }}
            icon={<Download size={12} strokeWidth={1.9} />}
          >
            Save
          </Button>
        </>
      }
    >
      <div className={`mb-4 flex flex-col overflow-hidden rounded-lg border border-line bg-sunken ${full ? 'h-[82vh]' : 'h-[62vh] min-h-[300px]'}`}>
        {showing === 'tree' && structure ? (
          <DataTree value={structure.value} testId="value-tree" />
        ) : (
          <YamlEditor value={value} language={language} wrap testId="value-source" />
        )}
      </div>
    </Modal>
  );
}
