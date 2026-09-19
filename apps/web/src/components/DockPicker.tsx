import { useEffect, useMemo, useState } from 'react';
import { ScrollText, Search, Terminal as TerminalIcon } from 'lucide-react';
import { api, type ResourceListResponse } from '../lib/api.ts';
import type { KubeItem } from './columns.tsx';
import { Modal } from './ui/Modal.tsx';
import { Field } from './ui/Field.tsx';

/**
 * Pick a pod, then do the thing.
 *
 * The dock's plus menu used to answer "Logs" by navigating to the pod list and
 * showing a toast telling you to click a button there. That is the same
 * failure as an empty state made of prose: a control whose response is
 * instructions for using a different control. A list of pods with a search box
 * is two lines longer and actually does it.
 */

export interface DockPickerProps {
  readonly open: boolean;
  readonly context: string | null;
  readonly namespace?: string | undefined;
  readonly intent: 'logs' | 'shell';
  readonly onClose: () => void;
  readonly onPick: (pod: KubeItem, container?: string) => void;
}

export function DockPicker({ open, context, namespace, intent, onClose, onPick }: DockPickerProps) {
  const [pods, setPods] = useState<KubeItem[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open || !context) return;
    setPods(null);
    setFilter('');
    let cancelled = false;
    void (async () => {
      try {
        const response = (await api.list(context, 'Pod', namespace)) as ResourceListResponse<KubeItem>;
        if (!cancelled) setPods(response.items ?? []);
      } catch {
        if (!cancelled) setPods([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, context, namespace]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = (pods ?? []).filter((pod) => {
      // A shell needs something running to exec into; logs of a dead pod are
      // often exactly what somebody wants, so only the shell filters.
      if (intent !== 'shell') return true;
      return (pod.status as { phase?: string } | undefined)?.phase === 'Running';
    });
    if (!needle) return list;
    return list.filter(
      (pod) =>
        (pod.metadata?.name ?? '').toLowerCase().includes(needle) ||
        (pod.metadata?.namespace ?? '').toLowerCase().includes(needle),
    );
  }, [pods, filter, intent]);

  const Icon = intent === 'logs' ? ScrollText : TerminalIcon;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={intent === 'logs' ? 'Tail a pod in the dock' : 'Open a shell in the dock'}
      description={
        intent === 'logs'
          ? 'It keeps streaming while you work on something else.'
          : 'The shell stays open while you navigate away.'
      }
      width={520}
      testId="dock-picker"
    >
      <Field
        id="dock-picker-filter"
        label="Filter pods"
        hideLabel
        mono
        autoFocus
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter pods"
        leading={<Search size={13} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />}
      />

      <div className="mt-3 max-h-[340px] min-h-[120px] overflow-y-auto rounded-lg border border-line">
        {pods === null ? (
          <p className="px-3 py-3 text-[12.5px] text-tertiary">Reading pods…</p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-3 text-[12.5px] text-tertiary">
            {(pods ?? []).length === 0 ? 'No pods in reach of this token.' : 'Nothing matches that.'}
          </p>
        ) : (
          <ul>
            {shown.map((pod) => {
              const containers = ((pod.spec as { containers?: Array<{ name?: string }> } | undefined)?.containers ?? [])
                .map((container) => container.name ?? '')
                .filter(Boolean);
              return (
                <li key={`${pod.metadata?.namespace}/${pod.metadata?.name}`} className="border-b border-subtle last:border-b-0">
                  <button
                    type="button"
                    data-testid="dock-picker-pod"
                    onClick={() => {
                      onPick(pod);
                      onClose();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-100 hover:bg-hover"
                  >
                    <Icon size={13} strokeWidth={1.9} aria-hidden className="shrink-0 text-tertiary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12.5px] text-primary">{pod.metadata?.name}</span>
                      <span className="text-[11px] text-tertiary">
                        {pod.metadata?.namespace}
                        {containers.length > 1 ? ` · ${containers.length} containers` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-tertiary">
                      {(pod.status as { phase?: string } | undefined)?.phase}
                    </span>
                  </button>
                  {/*
                    More than one container means the choice matters, so it is
                    offered here rather than defaulted to the first and
                    corrected afterwards.
                  */}
                  {containers.length > 1 ? (
                    <div className="flex flex-wrap gap-1 px-3 pb-2 pl-[34px]">
                      {containers.map((container) => (
                        <button
                          key={container}
                          type="button"
                          onClick={() => {
                            onPick(pod, container);
                            onClose();
                          }}
                          className="rounded-xs border border-subtle bg-sunken px-1.5 py-[2px] font-mono text-[11px] text-tertiary transition-colors duration-100 hover:border-strong hover:text-secondary"
                        >
                          {container}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
