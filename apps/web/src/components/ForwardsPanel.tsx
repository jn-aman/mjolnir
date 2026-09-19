import { useEffect, useState } from 'react';
import { ArrowLeftRight, ExternalLink, Square } from 'lucide-react';
import { api, type ForwardRecord } from '../lib/api.ts';
import { Button } from './ui/Button.tsx';
import { copyEntry, Menu, SEPARATOR, type MenuEntry } from './ui/ContextMenu.tsx';
import { usePolling } from '../lib/usePolling.ts';

/** Every active port forward, across clusters, with what to do about each. */
export function ForwardsPanel({ onOpenPod }: { readonly onOpenPod?: ((record: ForwardRecord) => void) | undefined }) {
  const [forwards, setForwards] = useState<ForwardRecord[] | null>(null);

  const refresh = async () => {
    try {
      setForwards((await api.forwards.list()).forwards);
    } catch {
      setForwards([]);
    }
  };
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Stops when the window is not on screen, and refreshes the moment it is.
  usePolling(refresh, 2000);

  return (
    <div className="mjolnir-fade-in min-h-0 flex-1 overflow-y-auto p-4" data-testid="forwards-panel">
      <div className="mb-3 flex items-center gap-2">
        <ArrowLeftRight size={15} strokeWidth={1.9} aria-hidden style={{ color: 'var(--series-3)' }} />
        <h1 className="text-[15px] font-semibold text-primary">Port forwards</h1>
        <span className="text-[12px] text-tertiary">{forwards ? `${forwards.length} active` : ''}</span>
      </div>
      {forwards && forwards.length === 0 ? (
        <p className="text-[12.5px] text-tertiary">
          None yet. Right-click a pod › <span className="text-secondary">Port forward…</span>, or use the Forward buttons beside a container’s ports in its details.
        </p>
      ) : null}
      <div className="space-y-1.5">
        {(forwards ?? []).map((record) => {
          const url = `http://localhost:${record.localPort}`;
          const entries: MenuEntry[] = [
            { id: 'open', label: 'Open in browser', onSelect: () => window.open(url, '_blank') },
            ...(onOpenPod ? [{ id: 'pod', label: 'Open pod', onSelect: () => onOpenPod(record) }] : []),
            SEPARATOR,
            ...copyEntry('copy-url', 'Copy URL', url),
            ...copyEntry('copy-kubectl', 'Copy kubectl command', `kubectl --context ${record.context} -n ${record.namespace} port-forward pod/${record.pod} ${record.localPort}:${record.port}`),
            SEPARATOR,
            { id: 'stop', label: 'Stop', danger: true, onSelect: () => void api.forwards.stop(record.id).then(refresh) },
          ];
          return (
            <Menu key={record.id} label={record.id} entries={entries} testId="forward-menu">
              <div className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2" data-testid="forward-row">
                <span className="font-mono text-[12.5px] text-ok">localhost:{record.localPort}</span>
                <span className="text-tertiary">→</span>
                <span className="font-mono text-[12.5px] text-primary">
                  {record.pod}:{record.port}
                </span>
                <span className="text-[11.5px] text-tertiary">
                  {record.namespace} · {record.context}
                  {record.connections ? ` · ${record.connections} open` : ''}
                </span>
                {record.lastError ? <span className="break-words [overflow-wrap:anywhere] text-[11.5px] text-error">{record.lastError}</span> : null}
                <div className="flex-1" />
                <Button variant="ghost" onClick={() => window.open(url, '_blank')} icon={<ExternalLink size={12} strokeWidth={1.9} />}>
                  Open
                </Button>
                <Button variant="ghost" onClick={() => void api.forwards.stop(record.id).then(refresh)} icon={<Square size={11} strokeWidth={2} />}>
                  Stop
                </Button>
              </div>
            </Menu>
          );
        })}
      </div>
    </div>
  );
}
