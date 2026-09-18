import type { ReactNode } from 'react';

interface CardProps {
  readonly title?: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

/** A panel. Border and surface only — no shadow at rest, no gradient, ever. */
export function Card({ title, subtitle, actions, children, className = '' }: CardProps) {
  return (
    <section className={`rounded-lg border border-line bg-raised ${className}`}>
      {title ? (
        <header className="flex items-center gap-3 border-b border-subtle px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-primary">{title}</h2>
            {subtitle ? (
              <p className="truncate text-[11.5px] text-tertiary">{subtitle}</p>
            ) : null}
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
}

const TONE: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-primary',
  ok: 'text-ok',
  warn: 'text-warn',
  error: 'text-error',
};

/**
 * A single number, given room.
 *
 * Not every measure deserves a chart. One value with no trend is a stat tile,
 * and drawing it as a one-bar chart wastes the space and says less.
 */
export function Stat({ label, value, hint, tone = 'default' }: StatProps) {
  return (
    <div className="rounded-lg border border-line bg-raised px-4 py-3">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-tertiary">
        {label}
      </div>
      <div className={`font-mono text-[26px] leading-none tabular-nums ${TONE[tone]}`}>{value}</div>
      {hint ? <div className="mt-1.5 text-[11.5px] text-tertiary">{hint}</div> : null}
    </div>
  );
}
