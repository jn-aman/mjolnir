import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { FileText, ScrollText, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api.ts';
import { LogViewer } from './LogViewer.tsx';
import { PodDetail, type PodShape as PodDetailShape } from './detail/PodDetail.tsx';
import { YamlEditor, toEditableYaml } from './YamlEditor.tsx';
import { StatusChip } from './StatusChip.tsx';
import { Button } from './ui/Button.tsx';
import { Modal } from './ui/Modal.tsx';
import { askEntry, copyEntry, copyText, Menu, SEPARATOR, type MenuEntry } from './ui/ContextMenu.tsx';
import { editContainer, resolveController } from '../lib/edits.ts';
import { ConfigDataDetail } from './detail/ConfigDataDetail.tsx';
import { Terminal as TerminalIcon } from 'lucide-react';
import { ResizeHandle, useResizable } from '../lib/useResizable.tsx';
import { age, podStatus, type KubeItem } from './columns.tsx';

/**
 * The detail panel.
 *
 * It overlays the list rather than squeezing it: a table that loses its Name
 * column the moment you open something is not a table any more. Escape closes.
 *
 * Every action the right-click menu offers is also here, in the header. A
 * context menu is a shortcut, never the only route.
 */

interface DrawerProps {
  readonly context: string;
  readonly kind: string;
  readonly item: KubeItem | null;
  readonly metrics?: { cpu: Array<{ t: number; v: number }>; memory: Array<{ t: number; v: number }> };
  readonly initialTab?: string;
  readonly onClose: () => void;
  readonly onNavigate?: (target: { kind: string; name?: string; namespace?: string; workspace?: string }) => void;
  /** Called after a successful delete so the list can drop the row at once. */
  readonly onDeleted?: () => void;
  readonly onForward?: ((item: KubeItem, port?: number) => void) | undefined;
  readonly onShell?: ((item: KubeItem, container?: string) => void) | undefined;
}

interface PodShape extends KubeItem {
  spec?: { containers?: Array<{ name?: string }> };
  status?: { containerStatuses?: Array<{ name?: string }> };
}

interface EventShape extends KubeItem {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  involvedObject?: { kind?: string; name?: string; namespace?: string };
}

export function ResourceDrawer({
  context,
  kind,
  item,
  metrics,
  initialTab,
  onClose,
  onNavigate,
  onDeleted,
  onForward,
  onShell,
}: DrawerProps) {
  const [yaml, setYaml] = useState<string | null>(null);
  const [tab, setTab] = useState(initialTab ?? 'overview');
  const [expanded, setExpanded] = useState(false);
  const [logContainer, setLogContainer] = useState<string | undefined>(undefined);
  const [logPrevious, setLogPrevious] = useState(false);
  const [events, setEvents] = useState<EventShape[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [yamlDirty, setYamlDirty] = useState(false);
  const [parent, setParent] = useState<{ kind: string; name: string } | undefined>(undefined);
  useEffect(() => {
    setParent(undefined);
    if (!item || kind !== 'Pod') return;
    let cancelled = false;
    const owner = (item.metadata as { ownerReferences?: Array<{ kind?: string; name?: string }> } | undefined)?.ownerReferences?.[0];
    if (owner?.kind !== 'ReplicaSet') return;
    void resolveController(context, item).then((controller) => {
      if (!cancelled && controller && controller.kind !== 'ReplicaSet') setParent({ kind: controller.kind, name: controller.name });
    });
    return () => {
      cancelled = true;
    };
  }, [item, kind, context]);
  const yamlApi = useRef<{ apply: () => Promise<void>; discard: () => void } | null>(null);
  /** What to do once unsaved YAML is resolved. */
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guarded = (action: () => void) => {
    if (yamlDirty && tab === 'yaml') setPending(() => action);
    else action();
  };
  const [deleting, setDeleting] = useState(false);
  // Anchored on the right, so dragging its left edge leftward widens it.
  const size = useResizable({ key: 'drawer', initial: 680, min: 420, max: 1200, direction: 'left' });

  const pod = item as PodShape | null;
  const isPod = kind === 'Pod';
  const name = item?.metadata?.name ?? '';
  const namespace = item?.metadata?.namespace ?? '';

  const containers = useMemo(
    () =>
      pod?.status?.containerStatuses?.map((status) => status.name ?? '').filter(Boolean) ??
      pod?.spec?.containers?.map((container) => container.name ?? '').filter(Boolean) ??
      [],
    [pod],
  );

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setTab(initialTab ?? 'overview');
    setYaml(null);
    setEvents(null);
    setExpanded(false);
    setLogContainer(undefined);
    setLogPrevious(false);
    setConfirmDelete(false);
    // initialTab is applied by its own effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, namespace]);

  useEffect(() => {
    if (tab !== 'yaml' || yaml !== null || !item) return;
    void (async () => {
      try {
        const object = await api.get(context, kind, name, namespace || undefined);
        setYaml(toEditableYaml(object));
      } catch (error) {
        toast.error(`Could not load YAML: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }, [tab, yaml, item, context, kind, name, namespace]);

  // Events for this object only. Kubernetes keeps them as a flat list keyed by
  // involvedObject, so the filter is on name and namespace rather than a link.
  useEffect(() => {
    if (tab !== 'events' || events !== null || !item) return;
    void (async () => {
      const response = await api.list<EventShape>(context, 'Event', namespace || undefined);
      setEvents(
        response.items
          .filter((event) => event.involvedObject?.name === name)
          .sort((a, b) => (b.lastTimestamp ?? '').localeCompare(a.lastTimestamp ?? '')),
      );
    })();
  }, [tab, events, item, context, name, namespace]);

  // A click outside the panel closes it, the way a popover would. Rows are
  // exempt because clicking one means "show that instead", and anything in a
  // portal (menus, dialogs, tooltips, toasts) is part of the panel's business.
  useEffect(() => {
    if (!item) return;
    const onPointerDown = (event: PointerEvent) => {
      if (confirmDelete || expanded || pending) return;
      if (event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (!target) return;
      if (
        target.closest('[data-testid="resource-drawer"]') ||
        target.closest('[data-testid="resource-row"]') ||
        target.closest('[data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [role="alertdialog"], [data-sonner-toaster], [cmdk-dialog]')
      ) {
        return;
      }
      guarded(onClose);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [item, onClose, confirmDelete, expanded]);

  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      // A menu or dialog that consumed Escape has already used it; closing the
      // panel too would make "close the menu" mean "lose my place".
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && !confirmDelete && !expanded && !pending) guarded(onClose);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose, confirmDelete, expanded]);

  if (!item) return null;

  const remove = async () => {
    setDeleting(true);
    try {
      await api.remove(context, kind, name, namespace || undefined);
      toast.success(`Deleted ${kind.toLowerCase()} ${name}`);
      setConfirmDelete(false);
      onDeleted?.();
      onClose();
    } catch (error) {
      toast.error(`Delete failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDeleting(false);
    }
  };

  const openLogs = (container: string, previous: boolean) => {
    setLogContainer(container);
    setLogPrevious(previous);
    setTab('logs');
  };

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

  const headerMenu: MenuEntry[] = [
    askEntry('Ask the assistant about this', `Look at ${kind} ${name}${namespace ? ` in namespace ${namespace}` : ''}: describe it, check logs and events, and tell me anything that needs attention.`),
    ...(isPod ? [{ id: 'logs', label: 'Logs', onSelect: () => openLogs(containers[0] ?? '', false) }] : []),
    ...(isPod && onShell ? [{ id: 'shell', label: 'Shell', onSelect: () => onShell(item, containers[0]) }] : []),
    ...(isPod && onForward ? [{ id: 'forward', label: 'Port forward…', onSelect: () => onForward(item) }] : []),
    { id: 'yaml', label: 'Edit YAML', onSelect: () => setTab('yaml') },
    { id: 'events', label: 'Events', onSelect: () => setTab('events') },
    SEPARATOR,
    ...copyEntry('copy-name', 'Copy name', name),
    ...copyEntry('copy-namespace', 'Copy namespace', namespace),
    {
      id: 'copy-yaml',
      label: 'Copy YAML',
      onSelect: () => {
        void api
          .get(context, kind, name, namespace || undefined)
          .then((object) => copyText(toEditableYaml(object), 'YAML copied'))
          .catch((error: unknown) => toast.error(`Could not load YAML: ${error instanceof Error ? error.message : String(error)}`));
      },
    },
    SEPARATOR,
    { id: 'delete', label: 'Delete…', danger: true, onSelect: () => setConfirmDelete(true) },
    { id: 'close', label: 'Close', shortcut: 'esc', onSelect: onClose },
  ];

  const tabs = [
    { id: 'overview', label: 'Overview' },
    ...(isPod ? [{ id: 'logs', label: 'Logs' }] : []),
    { id: 'events', label: 'Events' },
    { id: 'yaml', label: 'YAML' },
  ];

  return (
    <motion.aside
      data-testid="resource-drawer"
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className="absolute inset-y-0 right-0 z-20 flex max-w-[calc(100%-120px)] flex-col border-l border-line bg-ground shadow-[var(--shadow-lg)]"
      style={{ width: size.width }}
    >
      <ResizeHandle
        side="left"
        label="Resize details panel"
        dragging={size.dragging}
        onPointerDown={size.onPointerDown}
      />
      <header className="shrink-0 border-b border-line bg-raised px-4 pb-3 pt-3">
        <Menu label={name} entries={headerMenu} testId="drawer-menu">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-xs bg-accent-subtle px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-accent">
                {kind}
              </span>
              {isPod && pod ? <StatusChip status={podStatus(pod as never)} /> : null}
              <span className="text-[11px] text-tertiary">{age(item.metadata?.creationTimestamp)} old</span>
            </div>
            <h2 data-testid="drawer-name" className="truncate font-mono text-[14px] text-primary">
              {name}
            </h2>
            {namespace ? <p className="truncate text-[11.5px] text-tertiary">{namespace}</p> : null}
          </div>
          <Button iconOnly aria-label="Close" variant="ghost" onClick={() => guarded(onClose)} icon={<X size={15} strokeWidth={2} />} />
        </div>
        </Menu>

        {/* The same actions the right-click menu offers, where you can see them. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="drawer-actions">
          {isPod && onShell ? (
            <Button data-testid="drawer-shell" onClick={() => onShell(item, containers[0])} icon={<TerminalIcon size={13} strokeWidth={1.9} />}>
              Shell
            </Button>
          ) : null}
          {isPod ? (
            <Button
              onClick={() => openLogs(containers[0] ?? '', false)}
              icon={<ScrollText size={13} strokeWidth={1.9} />}
            >
              Logs
            </Button>
          ) : null}
          <Button onClick={() => setTab('yaml')} icon={<FileText size={13} strokeWidth={1.9} />}>
            Edit YAML
          </Button>
          <div className="flex-1" />
          <Button
            variant="danger"
            data-testid="drawer-delete"
            onClick={() => setConfirmDelete(true)}
            icon={<Trash2 size={13} strokeWidth={1.9} />}
          >
            Delete
          </Button>
        </div>
      </header>

      <Tabs.Root value={tab} onValueChange={(next) => guarded(() => setTab(next))} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex shrink-0 gap-0 border-b border-line bg-raised px-2">
          {tabs.map((entry) => (
            <Tabs.Trigger
              key={entry.id}
              value={entry.id}
              data-testid={`tab-${entry.id}`}
              className="relative px-3 py-2 text-[12.5px] font-medium text-secondary outline-none transition-colors duration-100 data-[state=active]:text-primary"
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
              key={`${namespace}/${name}`}
              pod={pod as PodDetailShape}
              metrics={metrics}
              onOpenLogs={openLogs}
              {...(onNavigate ? { onNavigate } : {})}
              onPatchMetadata={async (patch) => {
                await api.patch(context, kind, name, { metadata: patch }, namespace || undefined);
                onDeleted?.(); // reuses the list refresh; the row re-renders with the new value
              }}
              onRevealSecret={async (secret, key) => {
                const object = await api.get<{ data?: Record<string, string> }>(context, 'Secret', secret, namespace || undefined);
                const encoded = object.data?.[key];
                if (encoded === undefined) throw new Error(`Secret ${secret} has no key ${key}`);
                return atob(encoded);
              }}
              onOpenWorkspace={(id) => onNavigate?.({ kind: 'Pod', workspace: id })}
              onForward={onForward ? (port) => onForward(item, port) : undefined}
              onShell={onShell ? (container) => onShell(item, container) : undefined}
              parent={parent}
              onEditContainer={async (container, change) => {
                const where = await editContainer(context, item, container, change);
                toast.success(where);
                onDeleted?.();
              }}
            />
          ) : kind === 'ConfigMap' || kind === 'Secret' ? (
            <ConfigDataDetail
              key={`${namespace}/${name}`}
              kind={kind}
              object={item as never}
              onPatchMetadata={async (patch) => {
                await api.patch(context, kind, name, { metadata: patch }, namespace || undefined);
                onDeleted?.();
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

        <Tabs.Content value="events" className="min-h-0 flex-1 overflow-auto p-4 outline-none">
          {events === null ? (
            <p className="text-[12.5px] text-tertiary">Loading…</p>
          ) : events.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-tertiary">
              No events recorded for this {kind.toLowerCase()}.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="drawer-events">
              {events.map((event) => {
                const warning = event.type === 'Warning';
                return (
                  <li
                    key={event.metadata?.name}
                    className="rounded-md border border-line bg-raised px-3 py-2"
                    style={{ borderLeft: `2px solid ${warning ? 'var(--status-warn)' : 'var(--status-ok)'}` }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className={`text-[12px] font-medium ${warning ? 'text-warn' : 'text-ok'}`}>
                        {event.reason}
                      </span>
                      <div className="flex-1" />
                      <span className="shrink-0 font-mono text-[10.5px] text-tertiary">
                        {event.count && event.count > 1 ? `×${event.count} · ` : ''}
                        {age(event.lastTimestamp)} ago
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-[17px] text-secondary">{event.message}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Tabs.Content>

        <Tabs.Content value="yaml" className="flex min-h-0 flex-1 flex-col outline-none">
          {yaml === null ? (
            <div className="flex flex-1 items-center justify-center text-[13px] text-tertiary">Loading…</div>
          ) : (
            <YamlEditor
              key={`${name}:${namespace}`}
              value={yaml}
              onDirtyChange={setYamlDirty}
              controller={(api) => {
                yamlApi.current = api;
              }}
              onApply={async (text) => {
                await api.apply(context, kind, name, text, namespace || undefined);
                toast.success(`Applied ${kind.toLowerCase()} ${name}`);
                setYaml(null);
              }}
            />
          )}
        </Tabs.Content>
      </Tabs.Root>

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Unsaved YAML changes"
        description="Apply them to the cluster, discard them, or keep editing."
        testId="yaml-unsaved"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              data-testid="yaml-unsaved-discard"
              onClick={() => {
                yamlApi.current?.discard();
                setYamlDirty(false);
                const action = pending;
                setPending(null);
                action?.();
              }}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              data-testid="yaml-unsaved-save"
              onClick={() => {
                const action = pending;
                void yamlApi.current?.apply().then(() => {
                  setPending(null);
                  action?.();
                });
              }}
            >
              Apply and continue
            </Button>
          </>
        }
      />

      <Dialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <Dialog.Portal>
          <Dialog.Overlay
            className="fixed inset-0 z-40 bg-black/50"
            style={{ animation: 'mjolnir-fade-in 160ms ease-out' }}
          />
          <Dialog.Content
            data-testid="delete-dialog"
            className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-overlay p-5 shadow-[var(--shadow-lg)] outline-none"
            style={{ animation: 'mjolnir-menu-in 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          >
            <Dialog.Title className="mb-1 text-[15px] font-semibold text-primary">
              Delete this {kind.toLowerCase()}?
            </Dialog.Title>
            <Dialog.Description className="mb-4 text-[12.5px] leading-[19px] text-secondary">
              <span className="font-mono text-primary">{name}</span>
              {namespace ? (
                <>
                  {' '}in <span className="font-mono text-primary">{namespace}</span>
                </>
              ) : null}{' '}
              will be deleted from the cluster. This cannot be undone. A controller may recreate it.
            </Dialog.Description>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button disabled={deleting}>Cancel</Button>
              </Dialog.Close>
              <Button
                variant="danger"
                data-testid="delete-confirm"
                disabled={deleting}
                onClick={() => void remove()}
                icon={<Trash2 size={13} strokeWidth={1.9} />}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </motion.aside>
  );
}
