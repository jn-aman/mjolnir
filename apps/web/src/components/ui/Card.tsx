import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface CardProps {
  readonly title?: string;
  readonly subtitle?: string;
  readonly icon?: LucideIcon | undefined;
  readonly tint?: string | undefined;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  /** Lifts on hover, for cards that open something. */
  readonly interactive?: boolean;
}

/** A panel with depth: lit top edge, soft shadow, an icon chip when it has a subject. */
export function Card({ title, subtitle, icon: Icon, tint, actions, children, className = '', interactive = false }: CardProps) {
  return (
    <section className={`surface-card ${interactive ? 'lift' : ''} ${className}`}>
      {title ? (
        <header className="flex items-center gap-3 border-b border-subtle px-4 py-2.5">
          {Icon ? (
            <span className="icon-chip" style={{ ['--chip-tint' as string]: tint ?? 'var(--accent-base)' }} aria-hidden>
              <Icon size={14} strokeWidth={1.9} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="break-words [overflow-wrap:anywhere] text-[13.5px] font-semibold tracking-[-0.005em] text-primary">{title}</h2>
            {subtitle ? <p className="break-words [overflow-wrap:anywhere] text-[11.5px] text-tertiary">{subtitle}</p> : null}
          </div>
          <div className="flex-1" />
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

interface StatProps {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly tone?: 'default' | 'ok' | 'warn' | 'error';
  readonly icon?: LucideIcon | undefined;
  /** A small trend under the number, e.g. "+2 in the last hour". */
  readonly trend?: ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly loading?: boolean;
}

const TONE_TEXT: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-primary',
  ok: 'text-ok',
  warn: 'text-warn',
  error: 'text-error',
};
const TONE_TINT: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'var(--accent-base)',
  ok: 'var(--status-ok)',
  warn: 'var(--status-warn)',
  error: 'var(--status-error)',
};

/**
 * A single number, given room and light. The tone colours a soft glow in
 * the corner and the icon chip; the number stays the loudest thing.
 */
export function Stat({ label, value, hint, tone = 'default', icon: Icon, trend, onClick, loading = false }: StatProps) {
  const Element = onClick ? 'button' : 'div';
  const tint = TONE_TINT[tone];
  return (
    <Element
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      data-testid="stat-tile"
      className={`surface-card relative w-full overflow-hidden px-4 py-3 text-left ${onClick ? 'lift cursor-pointer' : ''}`}
      style={{ ['--hero-tint' as string]: tint }}
    >
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-[120px] w-[120px] rounded-full opacity-70" style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${tint} 22%, transparent), transparent)` }} />
      <div className="relative flex items-start gap-3">
        {Icon ? (
          <span className="icon-chip icon-chip-lg" style={{ ['--chip-tint' as string]: tint }} aria-hidden>
            <Icon size={19} strokeWidth={1.9} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-tertiary">{label}</div>
          {loading ? (
            <div className="h-[30px] w-[56px] animate-pulse rounded-sm bg-[var(--border-default)]" />
          ) : (
            <div className={`font-mono text-[27px] leading-none tabular-nums tracking-[-0.02em] ${TONE_TEXT[tone]}`}>{value}</div>
          )}
          {hint ? <div className="mt-1.5 text-[12px] text-secondary">{loading ? ' ' : hint}</div> : null}
          {trend ? <div className="mt-1 text-[11.5px] text-tertiary">{trend}</div> : null}
        </div>
      </div>
    </Element>
  );
}
