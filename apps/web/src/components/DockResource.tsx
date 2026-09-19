import { useCallback, useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api.ts';
import { Button } from './ui/Button.tsx';
import { YamlEditor, toEditableYaml } from './YamlEditor.tsx';
import { ResourceDetail, type KubeObject } from './detail/ResourceDetail.tsx';
import { LoadingState } from './ui/States.tsx';


/**
 * One object, kept open in the dock.
 *
 * The drawer is modal-ish: it covers the list and it belongs to the list you
 * opened it from. That is the wrong shape for the thing you are working on
 * while you look at five others. Lens solved this with a bottom dock and it is
 * the right answer: the deployment you are rolling out stays pinned while you
 * read the pods, the events and the config map it mounts.
 *
 * It re-reads on an interval rather than watching, because a pinned object is
 * one object and a watch per pinned tab is a socket per tab. Ten seconds is
 * fast enough to see a rollout move and slow enough to be free.
 */
export function DockResource({
  context,
  kind,
  name,
  namespace,
  onNavigate,
}: {
  context: string;
  kind: string;
  name: string;
  namespace?: string | undefined;
  onNavigate?: ((target: { kind: string; name?: string; namespace?: string }) => void) | undefined;
}) {
  const [item, setItem] = useState<KubeObject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');

  const load = useCallback(async () => {
    try {
      setItem(await api.get<KubeObject>(context, kind, name, namespace));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [context, kind, name, namespace]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-[12.5px] text-error">
        {error}
      </div>
    );
  }
  if (!item) return <LoadingState title={`Reading ${kind.toLowerCase()}`} rows={0} />;

  return (
    <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-3">
        <Tabs.List className="flex gap-1">
          {([
            ['overview', 'Overview'],
            ['yaml', 'YAML'],
          ] as const).map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="relative px-2 py-[7px] text-[12px] text-tertiary transition-colors duration-100 hover:text-secondary data-[state=active]:text-primary"
            >
              {label}
              {tab === value ? <span aria-hidden className="absolute inset-x-1 bottom-0 h-[2px] rounded-t-full bg-accent" /> : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <div className="flex-1" />
        <Button
          variant="ghost"
          onClick={() => void load().then(() => toast.success(`${name} refreshed`))}
          icon={<RotateCw size={11} strokeWidth={2} />}
          aria-label={`Refresh ${name}`}
        >
          Refresh
        </Button>
      </div>

      <Tabs.Content value="overview" className="min-h-0 flex-1 overflow-y-auto p-4 outline-none">
        <ResourceDetail context={context} kind={kind} item={item} {...(onNavigate ? { onNavigate } : {})} />
      </Tabs.Content>

      <Tabs.Content value="yaml" className="flex min-h-0 flex-1 flex-col outline-none">
        {tab === 'yaml' ? (
          <YamlEditor
            key={`${namespace ?? ''}/${name}`}
            value={toEditableYaml(item as unknown as Record<string, unknown>)}
            onApply={async (text) => {
              await api.apply(context, kind, name, text, namespace);
              toast.success(`${name} applied`);
              await load();
            }}
          />
        ) : null}
      </Tabs.Content>
    </Tabs.Root>
  );
}
