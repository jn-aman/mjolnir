import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Command as CommandIcon,
  Hexagon,
  Keyboard,
  MousePointerClick,
  Server,
  Ship,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { api, type AppSettings, type ClustersResponse, type DockerContextInfo } from '../lib/api.ts';
import { modules } from '../lib/tools.ts';
import { Button } from './ui/Button.tsx';
import { Switch } from './ui/Switch.tsx';
import { MarkTile } from './ui/Mark.tsx';
import { useFlags } from '../lib/flags.tsx';

/**
 * The first five minutes.
 *
 * Mjolnir opens onto a cluster it found by itself, which is the right default
 * and a confusing one: there is no sign of what else is here, that the rail is
 * a set of peers, that every row has a menu, or that nothing has left the
 * machine. So the first run says those things once, in order, with the real
 * answers filled in from this machine rather than a screenshot of someone
 * else's.
 *
 * It is skippable from the first frame and repeatable from settings. An
 * onboarding you cannot leave is a hostage situation, and one you cannot get
 * back is a thing people ask about in support.
 */

type StepId = 'intro' | 'clusters' | 'containers' | 'assistant' | 'privacy' | 'ready';

const STEPS: readonly StepId[] = ['intro', 'clusters', 'containers', 'assistant', 'privacy', 'ready'];

interface WelcomeProps {
  readonly settings: AppSettings | null;
  readonly clusters: ClustersResponse | null;
  readonly onFinish: () => void;
  readonly onOpenSettings: (section: string) => void;
}

export function Welcome({ settings, clusters, onFinish, onOpenSettings }: WelcomeProps) {
  const [index, setIndex] = useState(0);
  const [docker, setDocker] = useState<{ contexts: DockerContextInfo[] } | null>(null);
  const [usage, setUsage] = useState(settings?.telemetry.usage ?? false);
  const [crashes, setCrashes] = useState(settings?.telemetry.crashes ?? true);
  const step = STEPS[index] ?? 'intro';

  useEffect(() => {
    void api.docker.contexts().then(setDocker).catch(() => setDocker({ contexts: [] }));
  }, []);

  useEffect(() => {
    void api.telemetry.event('welcome.step', { step, outcome: 'ok' });
  }, [step]);

  const finish = async (): Promise<void> => {
    await api.telemetry.consent(usage, crashes).catch(() => undefined);
    await api.settings.update({ onboarding: { completed: true, step: 'ready', version: 1 } }).catch(() => undefined);
    onFinish();
  };

  const skip = async (): Promise<void> => {
    await api.settings.update({ onboarding: { completed: true, step, version: 1 } }).catch(() => undefined);
    onFinish();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void skip();
      if (event.key === 'ArrowRight') setIndex((current) => Math.min(current + 1, STEPS.length - 1));
      if (event.key === 'ArrowLeft') setIndex((current) => Math.max(current - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <motion.div
      data-testid="welcome"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[color-mix(in_oklab,var(--surface-ground)_86%,transparent)] p-6 backdrop-blur-md"
    >
      <motion.div
        initial={{ y: 14, scale: 0.985 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="surface-card relative flex max-h-[min(760px,92vh)] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border border-line"
        style={{ boxShadow: 'var(--shadow-lift)' }}
      >
        <button
          type="button"
          data-testid="welcome-close"
          onClick={() => void skip()}
          aria-label="Skip the welcome"
          title="Skip. Settings can bring it back."
          className="absolute right-3 top-3 z-10 flex h-[28px] w-[28px] items-center justify-center rounded-md text-tertiary transition-colors duration-100 hover:bg-hover hover:text-primary"
        >
          <X size={15} strokeWidth={2} />
        </button>

        <div className="hero-band shrink-0 border-b border-line px-7 py-5" style={{ ['--hero-tint' as string]: 'var(--accent-base)' }}>
          <div className="flex items-center gap-2.5">
            <MarkTile size={30} />
            <div className="min-w-0">
              <div className="text-[15px] font-semibold tracking-[-0.01em] text-primary">Welcome to Mjolnir</div>
              <div className="text-[12px] text-tertiary">Six short screens. Escape leaves at any point.</div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {step === 'intro' ? <Intro /> : null}
              {step === 'clusters' ? <Clusters clusters={clusters} onOpenSettings={onOpenSettings} /> : null}
              {step === 'containers' ? <Containers docker={docker} /> : null}
              {step === 'assistant' ? <Assistant settings={settings} onOpenSettings={onOpenSettings} /> : null}
              {step === 'privacy' ? (
                <Privacy usage={usage} crashes={crashes} onUsage={setUsage} onCrashes={setCrashes} />
              ) : null}
              {step === 'ready' ? <Ready /> : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line bg-raised px-7 py-4">
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Welcome steps">
            {STEPS.map((id, i) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Step ${i + 1}`}
                onClick={() => setIndex(i)}
                className="group flex h-[18px] w-[18px] items-center justify-center"
              >
                <motion.span
                  animate={{ width: i === index ? 20 : 7, opacity: i <= index ? 1 : 0.35 }}
                  transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                  className={`h-[7px] rounded-full ${i <= index ? 'bg-accent' : 'bg-[var(--text-tertiary)]'}`}
                />
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => void skip()} data-testid="welcome-skip">Skip</Button>
          {index > 0 ? (
            <Button variant="ghost" onClick={() => setIndex(index - 1)} icon={<ArrowLeft size={12} strokeWidth={2} />}>Back</Button>
          ) : null}
          {index < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => setIndex(index + 1)} data-testid="welcome-next" icon={<ArrowRight size={12} strokeWidth={2} />}>
              Next
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void finish()} data-testid="welcome-done" icon={<Check size={12} strokeWidth={2.4} />}>
              Start using Mjolnir
            </Button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function Heading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-primary">{title}</h2>
      <p className="mt-1 max-w-[62ch] text-[13px] leading-[1.55] text-secondary">{blurb}</p>
    </div>
  );
}

function Intro() {
  const { values } = useFlags();
  const rail = [{ id: 'kubernetes', label: 'Kubernetes', tint: 'var(--series-1)', icon: Hexagon, built: true }, ...modules(values).map((m) => ({ id: m.id, label: m.label, tint: m.tint, icon: m.icon, built: m.built === true }))];
  return (
    <>
      <Heading
        title="Eight modules, no favourites"
        blurb="The rail down the left is a set of peers. Kubernetes is one of them, not the app. Clusters live inside the Kubernetes module the way buckets live inside object storage, and switching modules keeps whatever you were looking at in each."
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rail.map((entry) => {
          const Icon = entry.icon;
          return (
            <div key={entry.id} className="surface-card flex flex-col gap-2 rounded-xl border border-line p-3">
              <span className="icon-chip !h-[28px] !w-[28px]" style={{ ['--chip-tint' as string]: entry.tint }} aria-hidden>
                <Icon size={15} strokeWidth={1.9} />
              </span>
              <span className="break-words text-[12.5px] font-medium leading-[1.2] text-primary [overflow-wrap:anywhere]">{entry.label}</span>
              <span className={`text-[10px] font-semibold uppercase tracking-[0.06em] ${entry.built ? 'text-[var(--status-ok)]' : 'text-tertiary'}`}>
                {entry.built ? 'ready' : 'planned'}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Clusters({ clusters, onOpenSettings }: { clusters: ClustersResponse | null; onOpenSettings: (section: string) => void }) {
  const contexts = clusters?.contexts ?? [];
  const real = contexts.filter((context) => context.name !== 'demo');
  return (
    <>
      <Heading
        title={real.length ? `Found ${real.length} cluster${real.length === 1 ? '' : 's'}` : 'No cluster found yet'}
        blurb="Mjolnir reads the same kubeconfig your kubectl does, from KUBECONFIG and ~/.kube/config. Nothing is uploaded and no agent is installed: it talks to the API server directly, as you."
      />
      <div className="flex flex-col gap-1.5">
        {contexts.map((context) => (
          <div key={context.name} data-testid="welcome-cluster" className="surface-card flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5">
            <span className="icon-chip !h-[26px] !w-[26px]" style={{ ['--chip-tint' as string]: context.name === 'demo' ? 'var(--series-4)' : 'var(--series-1)' }} aria-hidden>
              <Server size={13} strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words font-mono text-[12.5px] text-primary [overflow-wrap:anywhere]">{context.name}</span>
              <span className="block break-words text-[11px] text-tertiary [overflow-wrap:anywhere]">
                {context.name === 'demo' ? 'Built in. A fake cluster to click around in, with no connection at all.' : context.server}
              </span>
            </span>
          </div>
        ))}
        {contexts.length === 0 ? (
          <p className="text-[13px] text-secondary">There is still the built-in demo cluster to explore.</p>
        ) : null}
      </div>
      <div className="mt-3">
        <Button variant="secondary" onClick={() => onOpenSettings('kubeconfig')}>Add another kubeconfig</Button>
      </div>
    </>
  );
}

function Containers({ docker }: { docker: { contexts: DockerContextInfo[] } | null }) {
  const reachable = (docker?.contexts ?? []).filter((context) => context.reachable);
  return (
    <>
      <Heading
        title={reachable.length ? 'A container engine is running' : 'No container engine found'}
        blurb="The Containers module speaks to the local Docker socket: Docker Desktop, OrbStack, Colima, Rancher Desktop, or plain dockerd. Images carry a Trivy scan on the right-click menu when Trivy is installed."
      />
      <div className="flex flex-col gap-1.5">
        {(docker?.contexts ?? []).map((context) => (
          <div key={context.name} className="surface-card flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5">
            <span className="icon-chip !h-[26px] !w-[26px]" style={{ ['--chip-tint' as string]: context.reachable ? 'var(--series-3)' : 'var(--text-tertiary)' }} aria-hidden>
              <Ship size={13} strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-[12.5px] text-primary [overflow-wrap:anywhere]">{context.name}</span>
              <span className="block break-words font-mono text-[11px] text-tertiary [overflow-wrap:anywhere]">{context.endpoint}</span>
            </span>
            <span className={`shrink-0 text-[11px] font-medium ${context.reachable ? 'text-[var(--status-ok)]' : 'text-tertiary'}`}>
              {context.reachable ? 'answering' : 'not answering'}
            </span>
          </div>
        ))}
        {(docker?.contexts ?? []).length === 0 ? (
          <p className="text-[13px] text-secondary">Start Docker or OrbStack and the module lights up on its own. Nothing to configure.</p>
        ) : null}
      </div>
    </>
  );
}

function Assistant({ settings, onOpenSettings }: { settings: AppSettings | null; onOpenSettings: (section: string) => void }) {
  const configured = Boolean(settings?.ai.apiKey);
  return (
    <>
      <Heading
        title="The assistant is yours, and optional"
        blurb="It runs against whichever provider you point it at: Anthropic, OpenAI, Azure, Gemini, Ollama on this machine, OpenRouter, Groq, Mistral, xAI or MiMo. The key is stored in ~/.mjolnir/settings.json at mode 0600 and is sent to that provider only. With no key configured, the assistant simply does not appear."
      />
      <div className="surface-card flex items-center gap-3 rounded-xl border border-line p-4">
        <span className="icon-chip !h-[32px] !w-[32px]" style={{ ['--chip-tint' as string]: 'var(--series-5)' }} aria-hidden>
          <Bot size={16} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-primary">{configured ? `Configured: ${settings?.ai.model}` : 'Not configured'}</div>
          <div className="text-[12px] text-tertiary">{configured ? 'Right-click anything and pick "Ask the assistant" to start with that object in context.' : 'Set it up now, or later, or never.'}</div>
        </div>
        <Button variant="secondary" onClick={() => onOpenSettings('ai')} icon={<Sparkles size={12} strokeWidth={2} />}>
          {configured ? 'Change' : 'Set up'}
        </Button>
      </div>
    </>
  );
}

function Privacy({ usage, crashes, onUsage, onCrashes }: { usage: boolean; crashes: boolean; onUsage: (next: boolean) => void; onCrashes: (next: boolean) => void }) {
  return (
    <>
      <Heading
        title="Nothing leaves without a yes"
        blurb="Mjolnir contacts mjolnir.sh and nothing else, and only for the things below. Your clusters, containers and buckets are reached directly from this machine. Cluster names, namespaces, resource names, labels, logs and keys are not in any payload and cannot be: the events that exist are a fixed list, and anything not on it is dropped rather than sent."
      />
      <div className="flex flex-col gap-2">
        <Toggle
          checked={crashes}
          onChange={onCrashes}
          testId="welcome-crashes"
          title="Crash reports"
          detail="A stack trace when something breaks, with file paths reduced to file names and your home directory removed. This is how bugs you hit get fixed without you having to write them up."
        />
        <Toggle
          checked={usage}
          onChange={onUsage}
          testId="welcome-usage"
          title="Anonymous usage"
          detail="Counters only: which modules get opened, whether a shell attached, how long a session ran. Tied to a random installation id that is not derived from anything about you or this machine."
        />
      </div>
      <p className="mt-3 text-[12px] text-tertiary">
        Both can be changed later in Settings, Privacy, where the exact queue waiting to be sent is shown as JSON before it goes.
      </p>
    </>
  );
}

function Toggle({ checked, onChange, title, detail, testId }: { checked: boolean; onChange: (next: boolean) => void; title: string; detail: string; testId: string }) {
  return (
    <div className="surface-card flex items-start gap-3 rounded-xl border border-line p-4">
      <span className="icon-chip !h-[28px] !w-[28px] shrink-0" style={{ ['--chip-tint' as string]: 'var(--series-2)' }} aria-hidden>
        <ShieldCheck size={14} strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-primary">{title}</div>
        <div className="mt-0.5 break-words text-[12px] leading-[1.5] text-tertiary [overflow-wrap:anywhere]">{detail}</div>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} testId={testId} />
    </div>
  );
}

function Ready() {
  const tips = useMemo(
    () => [
      { icon: CommandIcon, keys: 'Cmd K', text: 'Search everything: resources, modules, actions, settings.' },
      { icon: MousePointerClick, keys: 'Right-click', text: 'Every named thing has a menu, and every menu can hand that thing to the assistant.' },
      { icon: Keyboard, keys: 'Cmd B', text: 'Collapse the navigation. Alt B opens the module rail into full names.' },
      { icon: Sparkles, keys: 'Shift-click', text: 'Pick a range of rows, then act on all of them at once.' },
    ],
    [],
  );
  return (
    <>
      <Heading title="Four things worth knowing" blurb="Everything else you can find by right-clicking." />
      <div className="flex flex-col gap-1.5">
        {tips.map((tip) => {
          const Icon = tip.icon;
          return (
            <div key={tip.keys} className="surface-card flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
              <span className="icon-chip !h-[26px] !w-[26px]" style={{ ['--chip-tint' as string]: 'var(--accent-base)' }} aria-hidden>
                <Icon size={13} strokeWidth={1.9} />
              </span>
              <kbd className="shrink-0 rounded border border-line bg-sunken px-1.5 py-[2px] font-mono text-[11px] text-secondary">{tip.keys}</kbd>
              <span className="min-w-0 break-words text-[12.5px] text-secondary [overflow-wrap:anywhere]">{tip.text}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
