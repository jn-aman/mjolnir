import { useCallback, useEffect, useState } from 'react';
import { Eye, Globe, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type TelemetryView } from '../../lib/api.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Switch } from '../ui/Switch.tsx';
import { Modal } from '../ui/Modal.tsx';

/**
 * Privacy, stated rather than promised.
 *
 * Every privacy page says the right words. This one shows the queue: the exact
 * JSON that would be posted, before it is posted, and the complete list of
 * event shapes that can ever exist. A claim you can read the source of is worth
 * more than a paragraph, and a person who can see that the list has no field
 * for a namespace does not have to take anyone's word for it.
 */

const HOSTS = [
  { host: 'updates.mjolnir.sh', what: 'The update feed and the installer, when update checks are on.' },
  { host: 'telemetry.mjolnir.sh', what: 'Crash reports and usage counters, when you have said yes below.' },
  { host: 'unleash.mjolnir.sh', what: 'Feature toggles, when a flag server is configured.' },
  { host: 'api.mjolnir.sh', what: 'Licence activation, when you enter a key.' },
];

export function PrivacySection({ onReplayWelcome }: { onReplayWelcome: () => void }) {
  const [view, setView] = useState<TelemetryView | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const [showCatalogue, setShowCatalogue] = useState(false);

  const load = useCallback(async () => {
    setView(await api.telemetry.get());
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const consent = view?.consent;
  const set = async (usage: boolean, crashes: boolean): Promise<void> => {
    await api.telemetry.consent(usage, crashes);
    await load();
  };

  return (
    <>
      <Card
        title="Where Mjolnir connects"
        subtitle="Only these four names, all under one apex, so a network policy of 'allow *.mjolnir.sh' covers the whole app. Your clusters, container engines and object stores are reached directly from this machine and never proxied through us."
      >
        <div className="flex flex-col gap-1.5">
          {HOSTS.map((entry) => (
            <div key={entry.host} className="flex items-start gap-2.5 rounded-md border border-line bg-sunken px-3 py-2">
              <span className="icon-chip !h-[24px] !w-[24px] shrink-0" style={{ ['--chip-tint' as string]: 'var(--series-1)' }} aria-hidden>
                <Globe size={12} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <code className="block break-words font-mono text-[12px] text-primary [overflow-wrap:anywhere]">{entry.host}</code>
                <div className="break-words text-[11.5px] text-tertiary [overflow-wrap:anywhere]">{entry.what}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="What may leave this machine" subtitle="Both start off. Neither sends anything before you turn it on, and turning them off empties whatever is waiting.">
        <div className="flex items-center gap-6 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-primary">Crash reports</div>
            <div className="mt-0.5 text-[11.5px] leading-[16px] text-tertiary">
              A message and a stack trace, with your home directory replaced by ~ and every path reduced to a file name.
            </div>
          </div>
          <Switch checked={consent?.crashes ?? false} onChange={(next) => void set(consent?.usage ?? false, next)} label="Send crash reports" testId="telemetry-crashes" />
        </div>
        <div className="my-1 h-px bg-[var(--border-subtle)]" />
        <div className="flex items-center gap-6 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-primary">Anonymous usage</div>
            <div className="mt-0.5 text-[11.5px] leading-[16px] text-tertiary">
              Counters against a random installation id. No cluster names, namespaces, resource names, labels, images, buckets, log lines or keys, and no field exists that could carry one.
            </div>
          </div>
          <Switch checked={consent?.usage ?? false} onChange={(next) => void set(next, consent?.crashes ?? false)} label="Send anonymous usage" testId="telemetry-usage" />
        </div>
      </Card>

      <Card title="The queue" subtitle="Nothing is sent on a schedule you cannot see. This is what is waiting right now.">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-line bg-sunken px-2 py-[2px] text-[11.5px] text-secondary" data-testid="telemetry-count">
            {view?.queue.length ?? 0} waiting
          </span>
          {view?.lastSend ? <span className="text-[11.5px] text-tertiary">last sent {new Date(view.lastSend).toLocaleString()}</span> : <span className="text-[11.5px] text-tertiary">never sent</span>}
          {view?.lastError ? <span className="break-words text-[11.5px] text-[var(--status-warn)] [overflow-wrap:anywhere]">{view.lastError}</span> : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button variant="secondary" onClick={() => setShowQueue(true)} icon={<Eye size={12} strokeWidth={2} />} data-testid="telemetry-view">
            Show exactly what would be sent
          </Button>
          <Button variant="ghost" onClick={() => setShowCatalogue(true)} icon={<ShieldCheck size={12} strokeWidth={2} />}>
            Every event that can exist
          </Button>
          <Button variant="ghost" disabled={!view?.queue.length} onClick={() => void api.telemetry.flush().then((r) => { toast.success(r.sent ? `Sent ${r.sent}` : r.error ?? 'Nothing to send'); return load(); })} icon={<Send size={12} strokeWidth={2} />}>
            Send now
          </Button>
          <Button variant="ghost" disabled={!view?.queue.length} onClick={() => void api.telemetry.clear().then(() => { toast.success('Queue emptied'); return load(); })} icon={<Trash2 size={12} strokeWidth={2} />}>
            Delete the queue
          </Button>
        </div>
      </Card>

      <Card title="Welcome" subtitle="The six screens from the first run.">
        <Button variant="secondary" onClick={onReplayWelcome} data-testid="replay-welcome">Show the welcome again</Button>
      </Card>

      <Modal open={showQueue} onClose={() => setShowQueue(false)} title="Exactly what would be sent" width={780}>
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-sunken p-3 font-mono text-[11.5px] leading-[1.6] text-secondary [overflow-wrap:anywhere]" data-testid="telemetry-json">
          {JSON.stringify({ ...(view?.envelope ?? {}), events: view?.queue ?? [] }, null, 2)}
        </pre>
      </Modal>

      <Modal open={showCatalogue} onClose={() => setShowCatalogue(false)} title="Every event that can exist" width={780}>
        <p className="mb-3 text-[12.5px] leading-[1.55] text-secondary">
          This is the whole vocabulary, compiled into the app. An event not on this list is dropped rather than sent, and a value that is not one of the values listed for its field is dropped too, so there is nowhere for a cluster name to go even by mistake.
        </p>
        <div className="max-h-[56vh] overflow-auto">
          {(view?.catalogue ?? []).map((event) => (
            <div key={event.name} className="border-b border-[var(--border-subtle)] py-2 last:border-0">
              <code className="font-mono text-[12px] text-primary">{event.name}</code>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries(event.strings).map(([key, values]) => (
                  <span key={key} className="rounded border border-line bg-sunken px-1.5 py-[1px] font-mono text-[10.5px] text-tertiary">
                    {key}: {values.join(' | ')}
                  </span>
                ))}
                {event.numbers.map((key) => (
                  <span key={key} className="rounded border border-line bg-sunken px-1.5 py-[1px] font-mono text-[10.5px] text-tertiary">
                    {key}: number
                  </span>
                ))}
                {Object.keys(event.strings).length === 0 && event.numbers.length === 0 ? (
                  <span className="text-[11px] text-tertiary">no fields</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
