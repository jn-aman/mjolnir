import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api.ts';
import { EditableText } from './ui/EditableText.tsx';
import { copyEntry, Menu, type MenuEntry } from './ui/ContextMenu.tsx';

/**
 * The cluster, at the top of its overview.
 *
 * A name you can change (the kubeconfig context stays as it is; this is
 * how you want to see it), a colour you can pick (the strip tile follows),
 * and a health ring that says at a glance how much of the cluster is fine.
 */
const COLOURS = ['var(--series-1)', 'var(--series-3)', 'var(--series-2)', 'var(--series-4)', 'var(--log-pod-b)', 'var(--status-error)'];

interface ClusterHeroProps {
  readonly context: string;
  readonly cluster?: { name: string; server?: string | null | undefined; provider: string } | undefined;
  readonly ready: boolean;
  readonly pods: number;
  readonly nodes: number;
  readonly health: { ok: number; warn: number; error: number };
  readonly version?: string | undefined;
  readonly onDecorChanged?: (() => void) | undefined;
  readonly usage?: { cpu: number | null; cpuText: string; memory: number | null; memoryText: string } | undefined;
  readonly onOpenPods?: ((filter?: string) => void) | undefined;
  readonly onOpenNodes?: (() => void) | undefined;
}

export function ClusterHero({ context, cluster, ready, pods, nodes, health, version, onDecorChanged, usage, onOpenPods, onOpenNodes }: ClusterHeroProps) {
  const [label, setLabel] = useState<string>('');
  const [colour, setColour] = useState<string>('');
  useEffect(() => {
    void api.settings.get().then((response) => {
      const per = response.settings.clusters.perContext[context];
      setLabel(per?.label ?? '');
      setColour(per?.color ?? '');
    }).catch(() => undefined);
  }, [context]);

  const save = async (patch: { label?: string; color?: string }) => {
    try {
      await api.settings.update({ clusters: { perContext: { [context]: patch } } });
      if (patch.label !== undefined) setLabel(patch.label);
      if (patch.color !== undefined) setColour(patch.color);
      onDecorChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const tint = colour || 'var(--series-1)';
  const total = health.ok + health.warn + health.error;
  const okPct = total ? health.ok / total : 1;
  const warnPct = total ? health.warn / total : 0;
  const errPct = total ? health.error / total : 0;
  const R = 26;
  const C = 2 * Math.PI * R;
  const grade = errPct > 0 ? 'error' : warnPct > 0 ? 'warn' : 'ok';
  const word = !ready ? 'connecting' : grade === 'ok' ? 'healthy' : grade === 'warn' ? 'degraded' : 'needs attention';
  const initials = (label || context).split(/[-_./\s]/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || context.slice(0, 2).toUpperCase();

  const entries: MenuEntry[] = [
    ...copyEntry('copy-context', 'Copy context name', context),
    ...copyEntry('copy-server', 'Copy server URL', cluster?.server),
    ...copyEntry('copy-kubectl', 'Copy kubectl --context', `kubectl --context ${context}`),
  ];

  return (
    <Menu label={context} entries={entries} testId="hero-menu">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        data-testid="cluster-hero"
        className="hero-band surface-card mb-4 flex items-center gap-4 overflow-hidden px-5 py-3.5"
        style={{ ['--hero-tint' as string]: tint }}
      >
        <span
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl text-[15px] font-bold tracking-wide text-white"
          style={{ background: `linear-gradient(145deg, color-mix(in oklab, ${tint} 100%, white 18%), color-mix(in oklab, ${tint} 100%, black 25%))`, boxShadow: `0 1px 0 rgb(255 255 255 / 0.25) inset, 0 10px 24px color-mix(in oklab, ${tint} 45%, transparent)` }}
          aria-hidden
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-primary">
              <EditableText label="cluster name" value={label || context} mono={false} validate={(v) => (v.length > 40 ? 'Keep it under 40 characters.' : null)} onCommit={(next) => save({ label: next === context ? '' : next })} testId="cluster-label" />
            </h1>
            {label && label !== context ? <span className="font-mono text-[12px] text-tertiary">{context}</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-secondary">
            {cluster?.server ? <span className="font-mono text-[12px]">{cluster.server}</span> : null}
            {version ? <span className="font-mono text-[12px]">{version}</span> : null}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2" data-testid="hero-facts">
            <Fact label="pods" value={String(pods)} onClick={onOpenPods ? () => onOpenPods() : undefined} />
            {health.error + health.warn > 0 ? <Fact label="not running" value={String(health.error + health.warn)} tone={health.error ? 'error' : 'warn'} onClick={onOpenPods ? () => onOpenPods(health.error ? 'tone:error' : 'tone:warn') : undefined} /> : null}
            <Fact label={nodes === 1 ? 'node' : 'nodes'} value={String(nodes)} onClick={onOpenNodes} />
            {usage ? <Gauge label="CPU" fraction={usage.cpu} text={usage.cpuText} onClick={onOpenNodes} /> : null}
            {usage ? <Gauge label="Memory" fraction={usage.memory} text={usage.memoryText} onClick={onOpenNodes} /> : null}
          </div>
          <div className="mt-2 flex items-center gap-1.5" data-testid="cluster-colours">
            {COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Use colour ${c}`}
                onClick={() => void save({ color: c })}
                className="flex h-[16px] w-[16px] items-center justify-center rounded-full transition-transform duration-150 hover:scale-125"
                style={{ background: c, boxShadow: tint === c ? '0 0 0 2px var(--surface-raised), 0 0 0 3px ' + c : 'none' }}
              >
                {tint === c ? <Check size={9} strokeWidth={3} className="text-white" /> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4" data-testid="health-ring">
          <svg width="60" height="60" viewBox="0 0 72 72" aria-label={`${Math.round(okPct * 100)}% of pods healthy`}>
            <circle cx="36" cy="36" r={R} fill="none" stroke="var(--border-default)" strokeWidth="7" />
            {[
              ['var(--status-ok)', okPct, 0],
              ['var(--status-warn)', warnPct, okPct],
              ['var(--status-error)', errPct, okPct + warnPct],
            ].map(([stroke, fraction, offset]) => (
              <motion.circle
                key={String(stroke)}
                cx="36"
                cy="36"
                r={R}
                fill="none"
                stroke={String(stroke)}
                strokeWidth="7"
                strokeLinecap="butt"
                strokeDasharray={`${Number(fraction) * C} ${C}`}
                initial={{ strokeDashoffset: C }}
                animate={{ strokeDashoffset: -Number(offset) * C }}
                transition={{ type: 'spring', stiffness: 60, damping: 20 }}
                transform="rotate(-90 36 36)"
                style={{ filter: `drop-shadow(0 0 4px color-mix(in oklab, ${String(stroke)} 60%, transparent))` }}
              />
            ))}
            <text x="36" y="40" textAnchor="middle" className="fill-[var(--text-primary)] font-mono text-[14px] font-semibold">{ready ? `${Math.round(okPct * 100)}%` : '…'}</text>
          </svg>
          <div>
            <div className={`text-[13px] font-semibold ${grade === 'ok' ? 'text-ok' : grade === 'warn' ? 'text-warn' : 'text-error'}`}>{word}</div>
            <div className="text-[11.5px] text-tertiary">{health.ok} running{health.warn ? `, ${health.warn} pending` : ''}{health.error ? `, ${health.error} failing` : ''}</div>
          </div>
        </div>
      </motion.section>
    </Menu>
  );
}

function Fact({ label, value, tone = 'default', onClick }: { label: string; value: string; tone?: 'default' | 'warn' | 'error'; onClick?: (() => void) | undefined }) {
  const colour = tone === 'error' ? 'text-error' : tone === 'warn' ? 'text-warn' : 'text-primary';
  const Element = onClick ? 'button' : 'span';
  return (
    <Element {...(onClick ? { type: 'button' as const, onClick } : {})} className={`flex h-[28px] items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 text-[12px] ${onClick ? 'lift cursor-pointer' : ''}`} style={{ boxShadow: '0 1px 0 var(--highlight) inset' }}>
      <span className={`font-mono text-[13px] font-semibold tabular-nums ${colour}`}>{value}</span>
      <span className="text-secondary">{label}</span>
    </Element>
  );
}

/** A small ring for one fraction, the same drawing as the health ring, smaller. */
function Gauge({ label, fraction, text, onClick }: { label: string; fraction: number | null; text: string; onClick?: (() => void) | undefined }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  const f = fraction === null ? 0 : Math.min(1, Math.max(0, fraction));
  const tone = f > 0.9 ? 'var(--status-error)' : f > 0.75 ? 'var(--status-warn)' : 'var(--series-1)';
  const Element = onClick ? 'button' : 'span';
  return (
    <Element {...(onClick ? { type: 'button' as const, onClick } : {})} title={text} className={`flex h-[28px] items-center gap-2 rounded-full border border-line bg-raised pl-1.5 pr-2.5 text-[12px] ${onClick ? 'lift cursor-pointer' : ''}`} style={{ boxShadow: '0 1px 0 var(--highlight) inset' }}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <circle cx="11" cy="11" r={r} fill="none" stroke="var(--border-default)" strokeWidth="3" />
        <motion.circle cx="11" cy="11" r={r} fill="none" stroke={tone} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${f * c} ${c}`} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: 0 }} transition={{ type: 'spring', stiffness: 60, damping: 20 }} transform="rotate(-90 11 11)" style={{ filter: `drop-shadow(0 0 3px color-mix(in oklab, ${tone} 60%, transparent))` }} />
      </svg>
      <span className="font-mono text-[13px] font-semibold tabular-nums text-primary">{fraction === null ? '-' : `${Math.round(f * 100)}%`}</span>
      <span className="text-secondary">{label}</span>
    </Element>
  );
}
