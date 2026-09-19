import { useState } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/Button.tsx';
import { copyEntry, copyText, Menu, type MenuEntry } from '../ui/ContextMenu.tsx';
import { EditableKeyValues } from './EditableKeyValues.tsx';
import { annotationValue, labelKey, labelValue } from '../../lib/validate.ts';

/**
 * A ConfigMap or a Secret, key by key.
 *
 * ConfigMap values are shown as they are. Secret values are hidden until
 * asked for, one key at a time, and decoded here from base64; nothing is
 * stored and nothing is sent anywhere. Copy gives the decoded value, which
 * is what you were going to paste anyway.
 */
interface ConfigDataDetailProps {
  readonly kind: 'ConfigMap' | 'Secret';
  readonly object: { metadata?: { name?: string; labels?: Record<string, string>; annotations?: Record<string, string> }; type?: string; data?: Record<string, string>; binaryData?: Record<string, string>; stringData?: Record<string, string>; immutable?: boolean };
  readonly onPatchMetadata?: ((patch: Record<string, unknown>) => Promise<void>) | undefined;
}

function decode(value: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
  } catch {
    return value;
  }
}

export function ConfigDataDetail({ kind, object, onPatchMetadata }: ConfigDataDetailProps) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const secret = kind === 'Secret';
  const entries = Object.entries(object.data ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const binary = Object.keys(object.binaryData ?? {});
  const show = (key: string) => revealed.has(key);

  return (
    <div className="space-y-5" data-testid="config-data">
      <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
        <span className="text-secondary">Kind</span><span className="font-mono text-primary">{kind}{object.type ? ` · ${object.type}` : ''}</span>
        <span className="text-secondary">Keys</span><span className="font-mono text-primary">{entries.length}{binary.length ? ` + ${binary.length} binary` : ''}</span>
        {object.immutable ? <><span className="text-secondary">Immutable</span><span className="text-warn">yes: values cannot change; recreate to edit</span></> : null}
      </div>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">{secret ? 'Secret data' : 'Data'}</h3>
          {secret && entries.length ? (
            <Button variant="ghost" onClick={() => setRevealed(revealed.size === entries.length ? new Set() : new Set(entries.map(([k]) => k)))} icon={revealed.size === entries.length ? <EyeOff size={12} strokeWidth={1.9} /> : <Eye size={12} strokeWidth={1.9} />}>
              {revealed.size === entries.length ? 'Hide all' : 'Reveal all'}
            </Button>
          ) : null}
        </div>
        {entries.length === 0 ? <p className="text-[12.5px] text-tertiary">No keys.</p> : null}
        <div className="space-y-1.5">
          {entries.map(([key, raw]) => {
            const value = secret ? decode(raw) : raw;
            const visible = !secret || show(key);
            const multiline = value.includes('\n');
            const menu: MenuEntry[] = [
              ...copyEntry('copy-value', secret ? 'Copy decoded value' : 'Copy value', value),
              ...copyEntry('copy-key', 'Copy key', key),
              ...(secret ? [{ id: 'reveal', label: visible ? 'Hide' : 'Reveal', onSelect: () => setRevealed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }) }] : []),
              ...copyEntry('copy-kubectl', 'Copy kubectl command', secret ? `kubectl get secret ${object.metadata?.name ?? ''} -o jsonpath='{.data.${key.replace(/\./g, '\\.')}}' | base64 -d` : `kubectl get configmap ${object.metadata?.name ?? ''} -o jsonpath='{.data.${key.replace(/\./g, '\\.')}}'`),
            ];
            return (
              <Menu key={key} label={key} entries={menu} testId="data-key-menu">
                <div className="rounded-lg border border-line bg-raised" data-testid="data-key">
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] font-mono text-[12px] text-accent">{key}</span>
                    <span className="font-mono text-[10.5px] text-tertiary">{value.length} chars</span>
                    {secret ? (
                      <Button variant="ghost" data-testid={`reveal-${key}`} aria-label={visible ? `Hide ${key}` : `Reveal ${key}`} onClick={() => setRevealed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })} icon={visible ? <EyeOff size={12} strokeWidth={1.9} /> : <Eye size={12} strokeWidth={1.9} />}>
                        {visible ? 'Hide' : 'Reveal'}
                      </Button>
                    ) : null}
                    <Button variant="ghost" aria-label={`Copy ${key}`} onClick={() => copyText(value, `${key} copied`)} icon={<Copy size={12} strokeWidth={1.9} />}>Copy</Button>
                  </div>
                  <pre className={`max-h-[260px] overflow-auto border-t border-line px-3 py-2 font-mono text-[11.5px] leading-[17px] ${visible ? 'text-primary' : 'text-tertiary'} ${multiline ? '' : 'whitespace-pre-wrap [overflow-wrap:anywhere]'}`}>
                    {visible ? value : '•'.repeat(Math.min(48, Math.max(8, value.length)))}
                  </pre>
                </div>
              </Menu>
            );
          })}
          {binary.map((key) => (
            <div key={key} className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-1.5 text-[12px]" data-testid="data-key">
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] font-mono text-accent">{key}</span>
              <span className="text-tertiary">binary, {Math.round(((object.binaryData?.[key]?.length ?? 0) * 3) / 4)} bytes</span>
            </div>
          ))}
        </div>
      </section>

      {onPatchMetadata ? (
        <>
          <section>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">Labels</h3>
            <EditableKeyValues values={object.metadata?.labels ?? {}} onPatch={(patch) => onPatchMetadata({ labels: patch })} testId="labels" validateKey={labelKey} validateValue={labelValue} />
          </section>
          <section>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">Annotations</h3>
            <EditableKeyValues values={object.metadata?.annotations ?? {}} onPatch={(patch) => onPatchMetadata({ annotations: patch })} testId="annotations" validateKey={labelKey} validateValue={annotationValue} />
          </section>
        </>
      ) : null}
    </div>
  );
}
