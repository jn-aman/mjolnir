import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeftRight, ExternalLink, Plus, Search, Square } from 'lucide-react';
import { toast } from 'sonner';
import { api, type ForwardRecord, type ForwardTarget } from '../lib/api.ts';
import { Button } from './ui/Button.tsx';
import { Field } from './ui/Field.tsx';
import { copyEntry, copyText, Menu, SEPARATOR, type MenuEntry } from './ui/ContextMenu.tsx';
import { usePolling } from '../lib/usePolling.ts';

/**
 * Port forwards: the ones running, and the ones you could start.
 *
 * The empty state used to be a sentence explaining where else to go, which is
 * the same mistake the dock made: a page that tells you to right-click
 * something on another screen is a page that has given up. Everything in the
 * cluster with a port is listed right here with a button on it, so the page
 * does the thing instead of describing it.
 *
 * Services come before pods, because a Service is what a person means.
 * "Forward Redis" is a sentence about a service; `redis-7c9f-x4k2p` is an
 * implementation detail that changes on every rollout.
 */

interface ForwardsPanelProps {
  readonly context?: string | undefined;
  readonly namespace?: string | undefined;
  readonly onOpenPod?: ((record: ForwardRecord) => void) | undefined;
}

export function ForwardsPanel({ context, namespace, onOpenPod }: ForwardsPanelProps) {
  const [forwards, setForwards] = useState<ForwardRecord[] | null>(null);
  const [targets, setTargets] = useState<ForwardTarget[] | null>(null);
  const [filter, setFilter] = useState('');
  const [starting, setStarting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setForwards((await api.forwards.list()).forwards);
    } catch {
      setForwards([]);
    }
  }, []);

  const loadTargets = useCallback(async () => {
    if (!context) {
      setTargets([]);
      return;
    }
    try {
      setTargets((await api.forwards.targets(context, namespace)).targets);
    } catch {
      setTargets([]);
    }
  }, [context, namespace]);

  useEffect(() => {
    void refresh();
    void loadTargets();
  }, [refresh, loadTargets]);
  // Stops when the window is not on screen, and refreshes the moment it is.
  usePolling(refresh, 2000);

  /** Ports already forwarded, so a target does not offer a second one. */
  const live = useMemo(
    () => new Set((forwards ?? []).map((record) => `${record.namespace}/${record.pod}:${record.port}`)),
    [forwards],
  );

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = targets ?? [];
    if (!needle) return list;
    return list.filter(
      (target) =>
        target.name.toLowerCase().includes(needle) ||
        target.namespace.toLowerCase().includes(needle) ||
        (target.hint ?? '').toLowerCase().includes(needle) ||
        target.ports.some((port) => String(port.port).includes(needle) || (port.name ?? '').includes(needle)),
    );
  }, [targets, filter]);

  const start = async (target: ForwardTarget, port: number) => {
    if (!context) return;
    const key = `${target.namespace}/${target.pod}:${port}`;
    setStarting(key);
    try {
      const record = await api.forwards.start({ context, namespace: target.namespace, pod: target.pod, port });
      await refresh();
      toast.success(`localhost:${record.localPort} → ${target.name}:${port}`, {
        action: { label: 'Open', onClick: () => window.open(`http://localhost:${record.localPort}`, '_blank') },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(null);
    }
  };

  const active = forwards ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="forwards-panel">
      <div className="flex h-[50px] shrink-0 items-center gap-2 border-b border-line bg-raised px-3.5">
        <ArrowLeftRight size={14} strokeWidth={1.9} aria-hidden style={{ color: 'var(--series-3)' }} />
        <span className="text-[13px] font-semibold text-primary">Port forwards</span>
        <span className="text-[12px] text-tertiary" data-testid="forward-count">
          {active.length === 0 ? 'none running' : `${active.length} running`}
        </span>
        <Field
          id="forward-filter"
          label="Filter targets"
          hideLabel
          mono
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name, port or namespace"
          className="ml-2 w-[260px] min-w-[150px] shrink"
          leading={<Search size={13} strokeWidth={2} aria-hidden className="shrink-0 text-tertiary" />}
        />
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => void loadTargets()}>
          Refresh
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[880px] px-6 py-5">
          {active.length > 0 ? (
            <ul className="space-y-1.5" data-testid="forward-list">
              {active.map((record) => (
                <ForwardRow key={record.id} record={record} onStopped={refresh} {...(onOpenPod ? { onOpenPod } : {})} />
              ))}
            </ul>
          ) : null}

          <div className={active.length > 0 ? 'mt-7' : ''}>
            <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">
              {active.length > 0 ? 'Forward something else' : 'Forward something'}
            </h2>
            {targets === null ? (
              <p className="mt-2 text-[12.5px] text-tertiary">Looking for services and pods with ports…</p>
            ) : shown.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-tertiary">
                {targets.length === 0
                  ? context
                    ? 'Nothing in reach of this token exposes a port.'
                    : 'Pick a cluster first.'
                  : 'Nothing matches that.'}
              </p>
            ) : (
              <ul className="mt-2 space-y-1" data-testid="forward-targets">
                {shown.map((target) => (
                  <li
                    key={`${target.kind}:${target.namespace}/${target.name}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-raised px-3 py-2"
                  >
                    <span
                      className="rounded-xs border border-subtle px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-tertiary"
                      style={target.kind === 'Service' ? { color: 'var(--series-3)', borderColor: 'color-mix(in oklab, var(--series-3) 35%, transparent)' } : {}}
                    >
                      {target.kind === 'Service' ? 'svc' : 'pod'}
                    </span>
                    <span className="min-w-0 break-words font-mono text-[12.5px] text-primary [overflow-wrap:anywhere]">{target.name}</span>
                    <span className="text-[11.5px] text-tertiary">{target.namespace}</span>
                    {target.workload ? <span className="text-[11.5px] text-tertiary">{target.workload}</span> : null}
                    {/* Only ever a hint: 5432 is almost always Postgres, and
                        occasionally something else entirely. */}
                    {target.hint ? <span className="text-[11.5px] text-tertiary">{target.hint}</span> : null}
                    <div className="flex-1" />
                    <span className="flex flex-wrap items-center gap-1">
                      {target.ports.map((port) => {
                        const key = `${target.namespace}/${target.pod}:${port.port}`;
                        const already = live.has(key);
                        return (
                          <Button
                            key={port.port}
                            variant={already ? 'ghost' : 'secondary'}
                            disabled={already || starting !== null || !context}
                            onClick={() => void start(target, port.port)}
                            icon={already ? undefined : <Plus size={11} strokeWidth={2.2} />}
                            hint={already ? 'Already forwarded' : `Forward ${port.port}${port.name ? ` (${port.name})` : ''} to a free local port`}
                          >
                            {starting === key ? '…' : already ? `${port.port} forwarded` : String(port.port)}
                          </Button>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-6 text-[11.5px] leading-[1.6] text-tertiary">
            A forward is a local socket, so it stays open while you work elsewhere and dies with the app. The local port is chosen
            for you unless you ask for one from a pod's own menu.
          </p>
        </div>
      </div>
    </div>
  );
}

function ForwardRow({
  record,
  onStopped,
  onOpenPod,
}: {
  record: ForwardRecord;
  onStopped: () => Promise<void>;
  onOpenPod?: ((record: ForwardRecord) => void) | undefined;
}) {
  const url = `http://localhost:${record.localPort}`;
  const broken = Boolean(record.lastError);
  const entries: MenuEntry[] = [
    { id: 'open', label: 'Open in browser', onSelect: () => window.open(url, '_blank') },
    ...(onOpenPod ? [{ id: 'pod', label: 'Open pod', onSelect: () => onOpenPod(record) }] : []),
    SEPARATOR,
    ...copyEntry('copy-url', 'Copy URL', url),
    ...copyEntry('copy-address', 'Copy host and port', `localhost:${record.localPort}`),
    ...copyEntry(
      'copy-kubectl',
      'Copy kubectl command',
      `kubectl --context ${record.context} -n ${record.namespace} port-forward pod/${record.pod} ${record.localPort}:${record.port}`,
    ),
    SEPARATOR,
    { id: 'stop', label: 'Stop', danger: true, onSelect: () => void api.forwards.stop(record.id).then(onStopped) },
  ];

  return (
    <Menu label={record.id} entries={entries} testId="forward-menu">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5"
        style={{
          borderColor: broken ? 'color-mix(in oklab, var(--status-error) 40%, transparent)' : 'var(--border-line)',
          background: broken ? 'var(--status-error-bg)' : 'var(--surface-raised)',
        }}
        data-testid="forward-row"
      >
        <span
          aria-hidden
          className="h-[7px] w-[7px] shrink-0 rounded-full"
          style={{ background: broken ? 'var(--status-error)' : 'var(--status-ok)' }}
        />
        <button
          type="button"
          onClick={() => copyText(`localhost:${record.localPort}`, 'Address copied')}
          className="font-mono text-[13px] font-semibold text-ok underline-offset-2 hover:underline"
          title="Copy the address"
        >
          localhost:{record.localPort}
        </button>
        <span aria-hidden className="text-tertiary">
          →
        </span>
        <span className="min-w-0 break-words font-mono text-[12.5px] text-primary [overflow-wrap:anywhere]">
          {record.pod}:{record.port}
        </span>
        <span className="text-[11.5px] text-tertiary">
          {record.namespace} · {record.context}
        </span>
        {/* Connections rather than bytes: it answers "is anything using this",
            which is the question when a forward looks dead. */}
        <span className="text-[11.5px] text-tertiary">
          {record.connections > 0 ? `${record.connections} open` : 'idle'}
        </span>
        {record.lastError ? (
          <span className="min-w-0 basis-full break-words text-[11.5px] text-error [overflow-wrap:anywhere]">{record.lastError}</span>
        ) : null}
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => window.open(url, '_blank')} icon={<ExternalLink size={12} strokeWidth={1.9} />}>
          Open
        </Button>
        <Button
          variant="ghost"
          onClick={() => void api.forwards.stop(record.id).then(onStopped)}
          icon={<Square size={11} strokeWidth={2} />}
        >
          Stop
        </Button>
      </motion.div>
    </Menu>
  );
}
