import { useEffect, useState } from 'react';
import { ArrowLeftRight, ExternalLink, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from './ui/Modal.tsx';
import { Button } from './ui/Button.tsx';
import { Field } from './ui/Field.tsx';
import { api, type ForwardRecord } from '../lib/api.ts';
import type { KubeItem } from './columns.tsx';
import { port as portRule } from '../lib/validate.ts';

/**
 * `kubectl port-forward`, from the pod's own list of ports.
 *
 * Every container port is a row with a Forward button; the local port is
 * chosen for you unless you type one. A port the pod does not declare can be
 * typed too, because plenty of images never fill `ports:` in. Active forwards
 * for this pod show here with Open and Stop, and the same list lives under
 * Tools › Port forwards for every pod at once.
 */
interface PortForwardDialogProps {
  readonly context: string;
  readonly pod: KubeItem | null;
  readonly onClose: () => void;
  readonly onStarted?: ((record: ForwardRecord) => void) | undefined;
}

interface PortRow {
  readonly container: string;
  readonly port: number;
  readonly name?: string | undefined;
  readonly protocol?: string | undefined;
}

export function declaredPorts(pod: KubeItem | null): PortRow[] {
  const spec = pod?.spec as { containers?: Array<{ name?: string; ports?: Array<{ containerPort?: number; name?: string; protocol?: string }> }> } | undefined;
  const rows: PortRow[] = [];
  for (const container of spec?.containers ?? []) {
    for (const port of container.ports ?? []) {
      if (typeof port.containerPort === 'number') {
        rows.push({ container: container.name ?? '', port: port.containerPort, name: port.name, protocol: port.protocol });
      }
    }
  }
  return rows;
}

export function PortForwardDialog({ context, pod, onClose, onStarted }: PortForwardDialogProps) {
  const name = pod?.metadata?.name ?? '';
  const namespace = pod?.metadata?.namespace ?? '';
  const [active, setActive] = useState<ForwardRecord[]>([]);
  const [custom, setCustom] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const refresh = async () => {
    try {
      const { forwards } = await api.forwards.list();
      setActive(forwards.filter((f) => f.context === context && f.namespace === namespace && f.pod === name));
    } catch {
      // The list is decoration here; a failure to fetch it is not a failure to forward.
    }
  };

  useEffect(() => {
    if (!pod) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pod, context]);

  const start = async (port: number) => {
    setBusy(port);
    try {
      const requested = Number(local[String(port)] ?? '');
      const record = await api.forwards.start({ context, namespace, pod: name, port, ...(requested ? { localPort: requested } : {}) });
      toast.success(`localhost:${record.localPort} → ${name}:${port}`, {
        action: { label: 'Open', onClick: () => window.open(`http://localhost:${record.localPort}`, '_blank') },
      });
      onStarted?.(record);
      await refresh();
    } catch (error) {
      toast.error(`Could not forward port ${port}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const stop = async (record: ForwardRecord) => {
    await api.forwards.stop(record.id);
    await refresh();
  };

  const ports = declaredPorts(pod);
  const forwardedPorts = new Set(active.map((f) => f.port));

  return (
    <Modal
      open={pod !== null}
      onClose={onClose}
      title="Port forward"
      description={<span className="font-mono">{namespace}/{name}</span>}
      width={560}
      testId="forward-dialog"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      {ports.length === 0 ? (
        <p className="mb-3 text-[12px] text-tertiary">This pod declares no ports. Type the one the process listens on.</p>
      ) : null}
      <div className="space-y-1.5" data-testid="forward-ports">
        {ports.map((row) => {
          const record = active.find((f) => f.port === row.port);
          return (
            <div key={`${row.container}:${row.port}`} className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2">
              <ArrowLeftRight size={13} strokeWidth={1.9} aria-hidden className="shrink-0 text-tertiary" />
              <span className="font-mono text-[12.5px] text-primary">{row.port}</span>
              <span className="text-[11.5px] text-tertiary">
                {row.protocol ?? 'TCP'}
                {row.name ? ` · ${row.name}` : ''} · {row.container}
              </span>
              <div className="flex-1" />
              {record ? (
                <>
                  <span className="font-mono text-[11.5px] text-ok">localhost:{record.localPort}</span>
                  <Button variant="ghost" onClick={() => window.open(`http://localhost:${record.localPort}`, '_blank')} icon={<ExternalLink size={12} strokeWidth={1.9} />}>
                    Open
                  </Button>
                  <Button variant="ghost" onClick={() => void stop(record)} icon={<Square size={11} strokeWidth={2} />}>
                    Stop
                  </Button>
                </>
              ) : (
                <>
                  <Field
                    id={`local-${row.port}`}
                    label="Local port"
                    hideLabel
                    mono
                    placeholder="auto"
                    className="w-[84px]"
                    value={local[String(row.port)] ?? ''}
                    onChange={(event) => setLocal((current) => ({ ...current, [String(row.port)]: event.target.value }))}
                    validate={portRule}
                  />
                  <Button data-testid={`forward-${row.port}`} disabled={busy === row.port || forwardedPorts.has(row.port) || portRule(local[String(row.port)] ?? '') !== null} onClick={() => void start(row.port)}>
                    {busy === row.port ? 'Starting…' : 'Forward'}
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <Field
          id="custom-port"
          label="Another port"
          mono
          placeholder="8080"
          className="w-[140px]"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          validate={(v) => (v ? portRule(v) : null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && custom && !portRule(custom)) void start(Number(custom));
          }}
        />
        <Button disabled={!custom || portRule(custom) !== null || busy !== null} onClick={() => void start(Number(custom))}>
          Forward
        </Button>
      </div>
      <div className="pb-1" />
    </Modal>
  );
}
