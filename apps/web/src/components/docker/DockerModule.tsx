import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { ArrowDownToLine, Download, Pause, Play, RefreshCw, RotateCw, Search, ShieldAlert, Square, Terminal as TerminalIcon, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { api, type DockerContainer, type DockerContextInfo, type DockerImage, type DockerNetwork, type DockerVolume } from '../../lib/api.ts';
import { ResourceList } from '../ResourceList.tsx';
import { formatBytes, type KubeItem } from '../columns.tsx';
import { Field } from '../ui/Field.tsx';
import { Select } from '../ui/Select.tsx';
import { Button } from '../ui/Button.tsx';
import { Card, Stat } from '../ui/Card.tsx';
import { ConfirmDialog, Modal } from '../ui/Modal.tsx';
import { askEntry, copyEntry, SEPARATOR, type MenuEntry } from '../ui/ContextMenu.tsx';
import { scanImage } from '../ScanDialog.tsx';
import { DockerDrawer } from './DockerDrawer.tsx';
import type { ToolDefinition } from '../../lib/tools.ts';
import { ToolPanel } from '../ToolPanel.tsx';

/**
 * The Containers module.
 *
 * Every engine on this machine (OrbStack, Docker Desktop, Colima, rootless)
 * is a context in the picker. Each section is the same list component the
 * Kubernetes module uses, so columns resize, reorder, hide and remember the
 * same way, and every row has its menu.
 */
export type DockerSection = 'containers' | 'images' | 'volumes' | 'networks' | 'compose' | 'system' | 'registries';

interface DockerModuleProps {
  readonly tool: ToolDefinition;
  readonly section: DockerSection;
  readonly onOpenDock: (tab: { kind: 'logs' | 'terminal'; context: string; id: string; name: string }) => void;
}

const icon = (Icon: typeof Play) => <Icon size={13} strokeWidth={1.9} />;

function toItem<T extends { name: string; created?: string | undefined }>(entry: T, spec: Record<string, unknown>, status: Record<string, unknown> = {}): KubeItem {
  return { metadata: { name: entry.name, ...(entry.created ? { creationTimestamp: entry.created } : {}) }, spec, status } as KubeItem;
}

export function DockerModule({ tool, section, onOpenDock }: DockerModuleProps) {
  const [contexts, setContexts] = useState<DockerContextInfo[]>([]);
  const [context, setContext] = useState<string>(() => {
    try {
      return localStorage.getItem('mjolnir.docker.context') ?? '';
    } catch {
      return '';
    }
  });
  const [filter, setFilter] = useState('');
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [system, setSystem] = useState<{ info: Record<string, unknown>; df: Record<string, unknown>; version: Record<string, unknown> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DockerContainer | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; label: string; run: () => Promise<unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullName, setPullName] = useState('');
  const [project, setProject] = useState<string | null>(null);

  useEffect(() => {
    void api.docker.contexts().then((response) => {
      setContexts(response.contexts);
      setContext((current) => (current && response.contexts.some((c) => c.name === current) ? current : response.current || response.contexts[0]?.name || ''));
    });
  }, []);
  useEffect(() => {
    try {
      if (context) localStorage.setItem('mjolnir.docker.context', context);
    } catch {
      // fine
    }
  }, [context]);

  const load = useCallback(async () => {
    if (!context) return;
    try {
      setError(null);
      if (section === 'containers' || section === 'compose') setContainers((await api.docker.containers(context)).containers);
      else if (section === 'images') setImages((await api.docker.images(context)).images);
      else if (section === 'volumes') setVolumes((await api.docker.volumes(context)).volumes);
      else if (section === 'networks') setNetworks((await api.docker.networks(context)).networks);
      else if (section === 'system') setSystem(await api.docker.system(context));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [context, section]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), section === 'containers' || section === 'compose' ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [load, section]);

  const act = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
      toast.success(label, { duration: 1400 });
      await load();
    } catch (cause) {
      toast.error(`${label} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const containerMenu = (c: DockerContainer): MenuEntry[] => {
    const running = c.state === 'running';
    return [
      { id: 'open', label: 'Open details', onSelect: () => setSelected(c) },
      askEntry('Ask the assistant about this', `Docker container ${c.name} (image ${c.image}, state ${c.state}, status "${c.status}"): what does it run and is it healthy? I will paste logs if you need them.`),
      SEPARATOR,
      { id: 'logs', label: 'Logs in the dock', icon: icon(ArrowDownToLine), onSelect: () => onOpenDock({ kind: 'logs', context, id: c.id, name: c.name }) },
      { id: 'shell', label: 'Shell', icon: icon(TerminalIcon), disabled: !running, onSelect: () => onOpenDock({ kind: 'terminal', context, id: c.id, name: c.name }) },
      { id: 'scan', label: 'Scan image with Trivy', icon: icon(ShieldAlert), onSelect: () => scanImage(c.image) },
      SEPARATOR,
      running
        ? { id: 'stop', label: 'Stop', icon: icon(Square), onSelect: () => void act(`Stopped ${c.name}`, () => api.docker.action(context, c.id, 'stop')) }
        : { id: 'start', label: 'Start', icon: icon(Play), onSelect: () => void act(`Started ${c.name}`, () => api.docker.action(context, c.id, 'start')) },
      { id: 'restart', label: 'Restart', icon: icon(RotateCw), onSelect: () => void act(`Restarted ${c.name}`, () => api.docker.action(context, c.id, 'restart')) },
      c.state === 'paused'
        ? { id: 'unpause', label: 'Unpause', icon: icon(Play), onSelect: () => void act(`Unpaused ${c.name}`, () => api.docker.action(context, c.id, 'unpause')) }
        : { id: 'pause', label: 'Pause', icon: icon(Pause), disabled: !running, onSelect: () => void act(`Paused ${c.name}`, () => api.docker.action(context, c.id, 'pause')) },
      { id: 'kill', label: 'Kill', icon: icon(Zap), disabled: !running, onSelect: () => void act(`Killed ${c.name}`, () => api.docker.action(context, c.id, 'kill')) },
      SEPARATOR,
      ...copyEntry('copy-id', 'Copy id', c.id),
      ...copyEntry('copy-name', 'Copy name', c.name),
      ...copyEntry('copy-image', 'Copy image', c.image),
      ...copyEntry('copy-cmd', 'Copy docker exec command', `docker --context ${context} exec -it ${c.name} sh`),
      SEPARATOR,
      { id: 'remove', label: 'Remove…', icon: icon(Trash2), danger: true, onSelect: () => setConfirm({ title: `Remove ${c.name}?`, body: running ? 'The container is running; it is stopped first, then removed. Named volumes stay.' : 'The container is removed. Named volumes stay.', label: 'Remove', run: () => api.docker.removeContainer(context, c.id, { force: running }) }) },
    ];
  };

  const imageMenu = (i: DockerImage): MenuEntry[] => [
    { id: 'scan', label: 'Scan with Trivy', icon: icon(ShieldAlert), onSelect: () => scanImage(i.tags[0] ?? i.id) },
    askEntry('Ask the assistant about this image', `Docker image ${i.tags.join(', ') || i.id}: what is it, is it a sensible base, and what should I check before using it?`),
    SEPARATOR,
    ...copyEntry('copy-tag', 'Copy tag', i.tags[0]),
    ...copyEntry('copy-id', 'Copy id', i.id),
    ...copyEntry('copy-digest', 'Copy digest', i.digests[0]),
    SEPARATOR,
    { id: 'remove', label: 'Remove…', icon: icon(Trash2), danger: true, disabled: i.usedBy.length > 0, onSelect: () => setConfirm({ title: `Remove image ${i.tags[0] ?? i.id.slice(7, 19)}?`, body: `${formatBytes(i.size)} is freed. Containers using it would block this; none do.`, label: 'Remove', run: () => api.docker.removeImage(context, i.id) }) },
  ];
  const volumeMenu = (v: DockerVolume): MenuEntry[] => [
    ...copyEntry('copy-name', 'Copy name', v.name),
    ...copyEntry('copy-path', 'Copy mountpoint', v.mountpoint),
    SEPARATOR,
    { id: 'remove', label: 'Remove…', icon: icon(Trash2), danger: true, disabled: v.usedBy.length > 0, onSelect: () => setConfirm({ title: `Remove volume ${v.name}?`, body: 'Its data is deleted. This cannot be undone.', label: 'Remove volume', run: () => api.docker.removeVolume(context, v.name) }) },
  ];
  const networkMenu = (n: DockerNetwork): MenuEntry[] => [
    ...copyEntry('copy-name', 'Copy name', n.name),
    ...copyEntry('copy-id', 'Copy id', n.id),
    SEPARATOR,
    { id: 'remove', label: 'Remove…', icon: icon(Trash2), danger: true, disabled: n.containers.length > 0 || ['bridge', 'host', 'none'].includes(n.name), onSelect: () => setConfirm({ title: `Remove network ${n.name}?`, body: 'Containers must be disconnected first; none are.', label: 'Remove network', run: () => api.docker.removeNetwork(context, n.id) }) },
  ];

  const containerItems = useMemo(
    () =>
      containers
        .filter((c) => !project || c.project === project)
        .map((c) => toItem(c, { image: c.image, ports: c.ports, project: c.project, service: c.service, id: c.id }, { state: c.state, status: c.status, cpuPercent: c.cpuPercent, memoryBytes: c.memoryBytes, memoryLimit: c.memoryLimit })),
    [containers, project],
  );
  const byName = useMemo(() => new Map(containers.map((c) => [c.name, c])), [containers]);
  const projects = useMemo(() => [...new Set(containers.map((c) => c.project).filter(Boolean))].sort() as string[], [containers]);
  const imageItems = useMemo(() => images.map((i) => toItem({ name: i.tags[0] ?? i.id.replace(/^sha256:/, '').slice(0, 12), created: i.created }, { size: i.size, usedBy: i.usedBy, id: i.id, tags: i.tags })), [images]);
  const volumeItems = useMemo(() => volumes.map((v) => toItem({ name: v.name, created: v.created }, { driver: v.driver, usedBy: v.usedBy, mountpoint: v.mountpoint })), [volumes]);
  const networkItems = useMemo(() => networks.map((n) => toItem({ name: n.name, created: n.created }, { driver: n.driver, scope: n.scope, subnets: n.subnets, containers: n.containers })), [networks]);

  const current = contexts.find((c) => c.name === context);
  const kind = section === 'images' ? 'DockerImage' : section === 'volumes' ? 'DockerVolume' : section === 'networks' ? 'DockerNetwork' : 'DockerContainer';
  const items = section === 'images' ? imageItems : section === 'volumes' ? volumeItems : section === 'networks' ? networkItems : containerItems;
  const label = section === 'images' ? 'images' : section === 'volumes' ? 'volumes' : section === 'networks' ? 'networks' : 'containers';
  const menuFor = (item: KubeItem): MenuEntry[] => {
    const name = item.metadata?.name ?? '';
    if (section === 'images') {
      const image = images.find((i) => (i.tags[0] ?? i.id.replace(/^sha256:/, '').slice(0, 12)) === name);
      return image ? imageMenu(image) : [];
    }
    if (section === 'volumes') {
      const volume = volumes.find((v) => v.name === name);
      return volume ? volumeMenu(volume) : [];
    }
    if (section === 'networks') {
      const network = networks.find((n) => n.name === name);
      return network ? networkMenu(network) : [];
    }
    const container = byName.get(name);
    return container ? containerMenu(container) : [];
  };

  if (section === 'registries') return <ToolPanel tool={tool} section="Registries" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="docker-module">
      <div className="flex h-[48px] shrink-0 items-center gap-2 border-b border-line bg-raised px-3">
        <Select
          label="Docker context"
          value={context}
          onChange={setContext}
          testId="docker-context"
          mono
          options={contexts.map((c) => ({ value: c.name, label: c.name, hint: c.reachable ? (c.version ?? 'up') : 'unreachable' }))}
        />
        {section !== 'system' ? (
          <Field id="docker-filter" label={`Filter ${label}`} hideLabel mono value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${label}`} className="w-[280px] min-w-[160px] shrink" leading={<Search size={13} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />} data-testid="docker-filter" />
        ) : null}
        {section === 'compose' ? (
          <Select label="Project" value={project ?? ''} onChange={(v) => setProject(v || null)} testId="compose-project" options={[{ value: '', label: 'All projects' }, ...projects.map((p) => ({ value: p, label: p, hint: String(containers.filter((c) => c.project === p).length) }))]} />
        ) : null}
        {section === 'images' ? (
          <Button data-testid="docker-pull" onClick={() => setPulling(true)} icon={<Download size={13} strokeWidth={2} />}>Pull…</Button>
        ) : null}
        <div className="flex-1" />
        {current ? (
          <span className="font-mono text-[11.5px] text-tertiary" data-testid="docker-engine">{current.reachable ? `engine ${current.version ?? ''} · ${current.platform ?? ''}` : `unreachable: ${current.error ?? ''}`}</span>
        ) : null}
        <Button iconOnly variant="ghost" aria-label="Refresh" onClick={() => void load()} icon={<RefreshCw size={13} strokeWidth={2} />} />
      </div>

      {error ? <div className="border-b border-[var(--status-error-border)] bg-error-bg px-3 py-2 text-[12.5px] text-error">{error}</div> : null}

      {section === 'system' ? (
        <SystemPage system={system} onPrune={(what) => setConfirm({ title: `Prune ${what}?`, body: what === 'system' ? 'Stopped containers, unused images, unused volumes and unused networks are removed.' : `Unused ${what} are removed. Anything in use stays.`, label: `Prune ${what}`, run: () => api.docker.prune(context, what).then((r) => toast.success(`Reclaimed ${formatBytes(r.reclaimed)}`)) })} />
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <ResourceList
            kind={kind}
            label={label}
            items={items}
            state={items.length || error ? 'synced' : 'connecting'}
            error={error}
            filter={filter}
            selectedName={selected?.name}
            menu={menuFor}
            onSelect={(item) => {
              if (section === 'containers' || section === 'compose') setSelected(byName.get(item.metadata?.name ?? '') ?? null);
            }}
          />
          <AnimatePresence>
            {selected ? (
              <DockerDrawer
                key="docker-drawer"
                context={context}
                container={containers.find((c) => c.id === selected.id) ?? selected}
                onClose={() => setSelected(null)}
                onOpenDock={onOpenDock}
                menu={containerMenu}
              />
            ) : null}
          </AnimatePresence>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        body={confirm?.body ?? ''}
        confirmLabel={confirm?.label ?? 'Confirm'}
        danger
        busy={busy}
        testId="docker-confirm"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          setBusy(true);
          void act(confirm.label, confirm.run).finally(() => {
            setBusy(false);
            setConfirm(null);
          });
        }}
      />
      <Modal
        open={pulling}
        onClose={() => setPulling(false)}
        title="Pull an image"
        description="Tag or digest, from any registry the engine is logged into."
        guard={{ dirty: pullName.trim() !== '', message: 'The image name was not pulled.' }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPulling(false)}>Cancel</Button>
            <Button variant="primary" disabled={!pullName.trim() || busy} onClick={() => { setBusy(true); void act(`Pulled ${pullName.trim()}`, () => api.docker.pull(context, pullName.trim())).finally(() => { setBusy(false); setPulling(false); setPullName(''); }); }}>{busy ? 'Pulling…' : 'Pull'}</Button>
          </>
        }
      >
        <Field id="pull-image" label="Image" mono value={pullName} onChange={(e) => setPullName(e.target.value)} placeholder="nginx:1.27" onKeyDown={(e) => { if (e.key === 'Enter' && pullName.trim()) { setBusy(true); void act(`Pulled ${pullName.trim()}`, () => api.docker.pull(context, pullName.trim())).finally(() => { setBusy(false); setPulling(false); setPullName(''); }); } }} />
        <div className="pb-2" />
      </Modal>
    </div>
  );
}

function SystemPage({ system, onPrune }: { system: { info: Record<string, unknown>; df: Record<string, unknown>; version: Record<string, unknown> } | null; onPrune: (what: string) => void }) {
  if (!system) return <div className="p-4 text-[12.5px] text-tertiary">Loading…</div>;
  const info = system.info;
  const df = system.df as { LayersSize?: number; Images?: Array<{ Size: number; Containers: number }>; Containers?: Array<{ SizeRw?: number }>; Volumes?: Array<{ UsageData?: { Size: number; RefCount: number } }>; BuildCache?: Array<{ Size: number; InUse: boolean }> };
  const imagesSize = df.LayersSize ?? (df.Images ?? []).reduce((n, i) => n + i.Size, 0);
  const containersSize = (df.Containers ?? []).reduce((n, c) => n + (c.SizeRw ?? 0), 0);
  const volumesSize = (df.Volumes ?? []).reduce((n, v) => n + (v.UsageData?.Size ?? 0), 0);
  const cacheSize = (df.BuildCache ?? []).reduce((n, b) => n + b.Size, 0);
  const unusedImages = (df.Images ?? []).filter((i) => i.Containers === 0).length;
  const unusedVolumes = (df.Volumes ?? []).filter((v) => (v.UsageData?.RefCount ?? 0) === 0).length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="docker-system">
      <div className="mb-4 grid grid-cols-4 gap-3">
        <Stat label="Containers" value={String(info['Containers'] ?? 0)} hint={`${info['ContainersRunning'] ?? 0} running, ${info['ContainersStopped'] ?? 0} stopped`} />
        <Stat label="Images" value={String(info['Images'] ?? 0)} hint={`${unusedImages} unused`} />
        <Stat label="CPUs" value={String(info['NCPU'] ?? '-')} hint={`${formatBytes(Number(info['MemTotal'] ?? 0))} memory`} />
        <Stat label="Engine" value={String(system.version['Version'] ?? '-')} hint={`${info['OperatingSystem'] ?? ''} · ${info['Architecture'] ?? ''}`} />
      </div>
      <Card title="Disk usage" subtitle="What the engine holds, and what prune would free">
        <div className="space-y-2">
          {[
            ['Images', imagesSize, 'images', `${unusedImages} not used by any container`],
            ['Containers', containersSize, 'containers', 'writable layers of stopped containers'],
            ['Volumes', volumesSize, 'volumes', `${unusedVolumes} not mounted anywhere`],
            ['Build cache', cacheSize, 'system', 'freed with a full prune'],
          ].map(([label, size, what, hint]) => (
            <div key={String(label)} className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2">
              <span className="w-[110px] text-[12.5px] text-primary">{String(label)}</span>
              <span className="w-[90px] font-mono text-[12.5px] tabular-nums text-secondary">{formatBytes(Number(size))}</span>
              <span className="flex-1 text-[11.5px] text-tertiary">{String(hint)}</span>
              <Button variant="ghost" data-testid={`prune-${String(what)}`} onClick={() => onPrune(String(what))} icon={<Trash2 size={12} strokeWidth={1.9} />}>Prune</Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end"><Button variant="danger" onClick={() => onPrune('system')} icon={<Trash2 size={12} strokeWidth={1.9} />}>Prune everything unused</Button></div>
      </Card>
      <Card title="Engine" className="mt-3">
        <dl className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
          {[['Name', info['Name']], ['Server version', system.version['Version']], ['API version', system.version['ApiVersion']], ['Storage driver', info['Driver']], ['Cgroup', `${info['CgroupDriver'] ?? ''} v${info['CgroupVersion'] ?? ''}`], ['Kernel', info['KernelVersion']], ['Root directory', info['DockerRootDir']], ['Logging driver', info['LoggingDriver']]].map(([k, v]) => (
            <div key={String(k)} className="contents"><dt className="text-tertiary">{String(k)}</dt><dd className="m-0 font-mono text-primary">{String(v ?? '-')}</dd></div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
