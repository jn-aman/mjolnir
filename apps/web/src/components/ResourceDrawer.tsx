import { useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { LogViewer } from './LogViewer.tsx';
import { PodDetail, type PodShape as PodDetailShape } from './detail/PodDetail.tsx';
import { StatusChip } from './StatusChip.tsx';
import { Button } from './ui/Button.tsx';
import { podStatus, type KubeItem } from './columns.tsx';

/**
 * The detail panel.
 *
 * Slides in from the edge it belongs to — the container animates, its contents
 * do not. Everything about one object lives here rather than on a separate
 * route, because the list is the context: losing it to look at a pod and then
 * navigating back is the interaction this replaces.
 */

interface DrawerProps {
  readonly context: string;
  readonly kind: string;
  readonly item: KubeItem | null;
  readonly metrics?: { cpu: Array<{ t: number; v: number }>; memory: Array<{ t: number; v: number }> };
  readonly initialTab?: string;
  readonly onClose: () => void;
}

interface PodShape extends KubeItem {
  spec?: { nodeName?: string; containers?: Array<{ name?: string; image?: string }>; serviceAccountName?: string };
  status?: {
    phase?: string;
    podIP?: string;
    qosClass?: string;
    containerStatuses?: Array<{
      name?: string;
      ready?: boolean;
      restartCount?: number;
      image?: string;
      state?: { waiting?: { reason?: string; message?: string }; running?: { startedAt?: string } };
      lastState?: { terminated?: { reason?: string; exitCode?: number; finishedAt?: string } };
    }>;
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
}

export function ResourceDrawer({ context, kind, item, metrics, initialTab, onClose }: DrawerProps) {
  const [yaml, setYaml] = useState<string | null>(null);
  const [tab, setTab] = useState(initialTab ?? 'overview');
  const [expanded, setExpanded] = useState(false);
  const [logContainer, setLogContainer] = useState<string | undefined>(undefined);
  const [logPrevious, setLogPrevious] = useState(false);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const pod = item as PodShape | null;
  const isPod = kind === 'Pod';
  const name = item?.metadata?.name ?? '';
  const namespace = item?.metadata?.namespace ?? '';

  const containers =
    pod?.status?.containerStatuses?.map((status) => status.name ?? '').filter(Boolean) ??
    pod?.spec?.containers?.map((container) => container.name ?? '').filter(Boolean) ??
    [];

  useEffect(() => {
    setTab(initialTab ?? 'overview');
    setYaml(null);
    setExpanded(false);
    setLogContainer(undefined);
    setLogPrevious(false);
    // initialTab is applied by its own effect; re-running on it here would
    // reset the tab every time the parent re-renders with the same value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, namespace]);

  useEffect(() => {
    if (tab !== 'yaml' || yaml !== null || !item) return;
    void (async () => {
      const object = await api.get(context, kind, name, namespace || undefined);
      setYaml(JSON.stringify(object, null, 2));
    })();
  }, [tab, yaml, item, context, kind, name, namespace]);

  // Escape closes, from anywhere inside. A panel you can only dismiss by
  // finding a small × is a panel people leave open.
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;


  // Full screen is a fixed layer over the whole window rather than a wider
  // drawer. Logs are the one thing people want the entire screen for, and a
  // panel that merely gets wider does not feel like it got out of the way.
  if (expanded && isPod && tab === 'logs') {
    return (
      <div
        data-testid="log-fullscreen"
        className="fixed inset-0 z-40 flex flex-col bg-ground"
        style={{ animation: 'mjolnir-fade-in 160ms ease-out' }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-4 py-2.5">
          <span className="rounded-xs bg-accent-subtle px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-accent">
            Logs
          </span>
          <span className="font-mono text-[13px] text-primary">{name}</span>
          <span className="text-[11.5px] text-tertiary">{namespace}</span>
          <div className="flex-1" />
          <span className="text-[11px] text-tertiary">esc to exit</span>
          <Button
            iconOnly
            aria-label="Exit full screen"
            variant="ghost"
            onClick={() => setExpanded(false)}
            icon={<X size={15} strokeWidth={2} />}
          />
        </header>
        <LogViewer
          context={context}
          namespace={namespace}
          pod={name}
          containers={containers}
          expanded
          onToggleExpand={() => setExpanded(false)}
          initialContainer={logContainer}
          initialPrevious={logPrevious}
        />
      </div>
    );
  }

  return (
    <aside
      data-testid="resource-drawer"
      className="flex w-[min(640px,48vw)] min-w-[420px] shrink-0 flex-col border-l border-line bg-ground"
      style={{ animation: 'mjolnir-drawer-in 260ms cubic-bezier(0.16, 1, 0.3, 1)' }}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-line bg-raised px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-xs bg-accent-subtle px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-accent">
              {kind}
            </span>
            {isPod && pod ? <StatusChip status={podStatus(pod as never)} /> : null}
          </div>
          <h2 data-testid="drawer-name" className="truncate font-mono text-[14px] text-primary">
            {name}
          </h2>
          {namespace ? (
            <p className="truncate text-[11.5px] text-tertiary">{namespace}</p>
          ) : null}
        </div>
        <Button iconOnly aria-label="Close" variant="ghost" onClick={onClose} icon={<X size={15} strokeWidth={2} />} />
      </header>

      <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex shrink-0 gap-0 border-b border-line bg-raised px-2">
          {[
            { id: 'overview', label: 'Overview' },
            ...(isPod ? [{ id: 'logs', label: 'Logs' }] : []),
            { id: 'yaml', label: 'YAML' },
          ].map((entry) => (
            <Tabs.Trigger
              key={entry.id}
              value={entry.id}
              data-testid={`tab-${entry.id}`}
              className="relative px-3 py-2 text-[12.5px] font-medium text-secondary outline-none data-[state=active]:text-primary"
              style={{ transitionProperty: 'color', transitionDuration: '90ms' }}
            >
              {entry.label}
              {tab === entry.id ? (
                <span
                  aria-hidden
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent"
                  style={{ animation: 'mjolnir-tab-in 180ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                />
              ) : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="overview" className="min-h-0 flex-1 overflow-auto p-4 outline-none">
          {isPod && pod ? (
            <PodDetail
              pod={pod as PodDetailShape}
              metrics={metrics}
              onOpenLogs={(container, previous) => {
                setLogContainer(container);
                setLogPrevious(previous);
                setTab('logs');
              }}
            />
          ) : (
            <p className="text-[12.5px] text-tertiary">
              A detailed view for {kind} is not built yet. The YAML tab has everything.
            </p>
          )}
        </Tabs.Content>

        {isPod ? (
          <Tabs.Content value="logs" className="flex min-h-0 flex-1 flex-col outline-none">
            {tab === 'logs' ? (
              <LogViewer
                context={context}
                namespace={namespace}
                pod={name}
                containers={containers}
                expanded={expanded}
                onToggleExpand={() => setExpanded((value) => !value)}
                initialContainer={logContainer}
                initialPrevious={logPrevious}
              />
            ) : null}
          </Tabs.Content>
        ) : null}

        <Tabs.Content value="yaml" className="min-h-0 flex-1 overflow-auto outline-none">
          <pre
            data-testid="yaml-editor"
            className="m-0 whitespace-pre-wrap break-words bg-sunken p-4 font-mono text-[12px] leading-[19px] text-[var(--log-body)]"
          >
            {yaml ?? 'Loading…'}
          </pre>
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}
