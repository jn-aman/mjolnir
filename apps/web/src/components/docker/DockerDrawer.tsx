import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import * as Tabs from '@radix-ui/react-tabs';
import { X } from 'lucide-react';
import { api, type DockerContainer } from '../../lib/api.ts';
import { ResizeHandle, useResizable } from '../../lib/useResizable.tsx';
import { formatBytes } from '../columns.tsx';
import { StatusChip } from '../StatusChip.tsx';
import { LogViewer } from '../LogViewer.tsx';
import { YamlEditor, toEditableYaml } from '../YamlEditor.tsx';
import { Button } from '../ui/Button.tsx';
import { Menu, type MenuEntry } from '../ui/ContextMenu.tsx';
import { formatDateTime } from '../../lib/time.ts';
import { LoadingState } from '../ui/States.tsx';

/** One container: what it is, its logs, and everything the engine knows. */
interface DockerDrawerProps {
  readonly context: string;
  readonly container: DockerContainer;
  readonly onClose: () => void;
  readonly onOpenDock: (tab: { kind: 'logs' | 'terminal'; context: string; id: string; name: string }) => void;
  readonly menu: (c: DockerContainer) => MenuEntry[];
}

export function DockerDrawer({ context, container, onClose, onOpenDock, menu }: DockerDrawerProps) {
  const size = useResizable({ key: 'docker-drawer', initial: 680, min: 420, max: 1200, direction: 'left' });
  const [tab, setTab] = useState('overview');
  const [inspect, setInspect] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    setInspect(null);
    if (tab !== 'inspect') return;
    void api.docker.container(context, container.id).then(setInspect).catch(() => setInspect({ error: 'could not inspect' }));
  }, [tab, context, container.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows: Array<[string, string]> = [
    ['Image', container.image],
    ['Id', container.id.slice(0, 12)],
    ['Status', container.status],
    ['Created', formatDateTime(container.created)],
    ...(container.project ? ([['Compose', `${container.project} / ${container.service ?? ''}`]] as Array<[string, string]>) : []),
    ['CPU', container.cpuPercent === undefined ? '-' : `${container.cpuPercent.toFixed(1)}%`],
    ['Memory', container.memoryBytes === undefined ? '-' : `${formatBytes(container.memoryBytes)}${container.memoryLimit ? ` of ${formatBytes(container.memoryLimit)}` : ''}`],
    ['Network', container.rxBytes === undefined ? '-' : `${formatBytes(container.rxBytes)} in · ${formatBytes(container.txBytes)} out`],
    ['Ports', container.ports.length ? container.ports.map((p) => `${p.host ? `${p.host}→` : ''}${p.container}/${p.protocol}`).join(', ') : 'none published'],
    ['Networks', container.networks.map((n) => `${n.name}${n.ip ? ` (${n.ip})` : ''}`).join(', ') || '-'],
    ['Mounts', container.mounts.length ? container.mounts.map((m) => `${m.source ?? ''} → ${m.destination}`).join('\n') : 'none'],
  ];

  return (
    <motion.aside
      data-testid="docker-drawer"
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className="absolute inset-y-0 right-0 z-20 flex max-w-[calc(100%-120px)] flex-col border-l border-line bg-ground shadow-[var(--shadow-lg)]"
      style={{ width: size.width }}
    >
      <ResizeHandle side="left" label="Resize details panel" dragging={size.dragging} onPointerDown={size.onPointerDown} />
      <header className="shrink-0 border-b border-line bg-raised px-4 pb-3 pt-3">
        <Menu label={container.name} entries={menu(container)} testId="drawer-menu">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-xs bg-accent-subtle px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-accent">Container</span>
                <StatusChip status={container.state.replace(/^./, (c) => c.toUpperCase())} tone={container.state === 'running' ? 'ok' : container.state === 'paused' ? 'warn' : 'neutral'} />
              </div>
              <h2 data-testid="drawer-name" className="break-words [overflow-wrap:anywhere] font-mono text-[14px] text-primary">{container.name}</h2>
              <p className="break-words [overflow-wrap:anywhere] text-[11.5px] text-tertiary">{container.image}</p>
            </div>
            <Button iconOnly aria-label="Close" variant="ghost" onClick={onClose} icon={<X size={15} strokeWidth={2} />} />
          </div>
        </Menu>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button onClick={() => onOpenDock({ kind: 'logs', context, id: container.id, name: container.name })}>Logs in the dock</Button>
          <Button disabled={container.state !== 'running'} onClick={() => onOpenDock({ kind: 'terminal', context, id: container.id, name: container.name })}>Shell</Button>
        </div>
      </header>
      <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex shrink-0 gap-1 border-b border-line bg-raised px-3">
          {([['overview', 'Overview'], ['logs', 'Logs'], ['inspect', 'Inspect']] as Array<[string, string]>).map(([id, label]) => (
            <Tabs.Trigger key={id} value={id} data-testid={`tab-${id}`} className="relative px-2 py-2 text-[12.5px] text-secondary outline-none data-[state=active]:text-primary">
              {label}
              {tab === id ? <motion.span layoutId="docker-drawer-tab" className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-accent" /> : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview" className="min-h-0 flex-1 overflow-y-auto p-4 outline-none">
          <dl className="space-y-2">
            {rows.map(([k, v]: [string, string]) => (
              <div key={k} className="flex gap-3 text-[12px]">
                <dt className="w-[86px] shrink-0 text-secondary">{k}</dt>
                <dd className="m-0 min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-primary">{v}</dd>
              </div>
            ))}
          </dl>
          {Object.keys(container.labels).length ? (
            <div className="mt-4">
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">Labels</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(container.labels).map(([k, v]) => (
                  <span key={k} title={`${k}=${v}`} className="rounded-md border border-[var(--border-strong)] bg-overlay px-2 py-[3px] font-mono text-[11px]"><span className="text-secondary">{k}</span><span className="text-tertiary">=</span><span className="max-w-[220px] break-words [overflow-wrap:anywhere] text-primary">{v}</span></span>
                ))}
              </div>
            </div>
          ) : null}
        </Tabs.Content>
        <Tabs.Content value="logs" className="flex min-h-0 flex-1 flex-col outline-none">
          {tab === 'logs' ? <LogViewer source="docker" context={context} namespace="" pod={container.id} containers={[container.name]} /> : null}
        </Tabs.Content>
        <Tabs.Content value="inspect" className="flex min-h-0 flex-1 flex-col outline-none">
          {inspect ? <YamlEditor key={container.id} value={toEditableYaml(inspect)} /> : <LoadingState title="Inspecting the container" rows={0} />}
        </Tabs.Content>
      </Tabs.Root>
    </motion.aside>
  );
}
