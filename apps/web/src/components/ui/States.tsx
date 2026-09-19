import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'motion/react';
import { MarkTile } from './Mark.tsx';

/**
 * The two screens nobody designs, and everybody sees.
 *
 * "No job in this cluster." set in grey in the middle of two thousand empty
 * pixels is not a neutral choice: it reads as a dead end, when the true
 * message is almost always "this worked, and the answer is none". So an empty
 * state names what was looked for, says why nothing is wrong, and offers the
 * next move.
 *
 * Loading is the same problem pointed the other way. A spinner in the middle
 * of a white rectangle says "wait" and nothing else, and it throws away the one
 * useful thing a loading screen can do, which is show the shape of what is
 * coming so the page does not jump when it arrives. So the skeleton is the
 * hero here and the status is a small lit badge floating over it, the way the
 * app itself is laid out.
 */

export function EmptyState({
  title,
  detail,
  icon,
  action,
  testId,
  tone = 'muted',
}: {
  title: string;
  detail?: ReactNode;
  /** Replaces the mark, for a state that is about one kind of thing. */
  icon?: ReactNode;
  action?: ReactNode;
  testId?: string;
  tone?: 'muted' | 'error';
}) {
  const tint = tone === 'error' ? 'var(--status-error)' : 'var(--accent-solid)';
  return (
    <div data-testid={testId} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-10">
      <Grid tint={tint} />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 330, damping: 30 }}
        className="relative flex max-w-[470px] flex-col items-center text-center"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-56px] h-[240px] w-[360px] -translate-x-1/2 rounded-full opacity-60 blur-[52px]"
          style={{ background: `radial-gradient(circle at 50% 42%, color-mix(in oklab, ${tint} 28%, transparent), transparent 70%)` }}
        />
        <span className="relative">
          {icon ?? (
            <span className="relative block">
              <Halo tint={tint} size={54} />
              <MarkTile size={54} tint={tint} />
            </span>
          )}
        </span>
        <h3 className="relative mt-5 break-words text-[16px] font-semibold tracking-[-0.015em] text-primary [overflow-wrap:anywhere]">{title}</h3>
        {detail ? (
          <p className="relative mt-2 break-words text-[12.5px] leading-[1.65] text-tertiary [overflow-wrap:anywhere]">{detail}</p>
        ) : null}
        {action ? <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
      </motion.div>
    </div>
  );
}

export function LoadingState({
  title = 'Connecting',
  detail,
  rows = 6,
  testId,
}: {
  title?: string;
  detail?: ReactNode;
  /** 0 for a panel, where a fake table would be a lie about the layout. */
  rows?: number;
  testId?: string;
}) {
  if (rows === 0) return <PanelLoading title={title} detail={detail} testId={testId} />;

  return (
    <div data-testid={testId} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <Grid tint="var(--accent-solid)" />

      {/* The skeleton carries the layout. Column widths roughly match a real
          table, so the arriving rows land where the grey ones were. */}
      <div className="relative min-h-0 flex-1 overflow-hidden px-4 pt-3" aria-hidden>
        <div className="flex items-center gap-3 border-b border-line px-2 pb-2.5">
          <Shimmer className="h-[9px] w-[64px] rounded-full" />
          <Shimmer className="h-[9px] w-[52px] rounded-full" />
          <div className="flex-1" />
          <Shimmer className="h-[9px] w-[44px] rounded-full" />
          <Shimmer className="h-[9px] w-[36px] rounded-full" />
        </div>
        {Array.from({ length: rows }, (_, index) => (
          <motion.div
            key={index}
            className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-2 py-[11px]"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: Math.max(0.18, 1 - index * 0.11), y: 0 }}
            transition={{ delay: index * 0.045, type: 'spring', stiffness: 400, damping: 34 }}
          >
            <Shimmer className="h-[20px] w-[20px] rounded-[7px]" delay={index * 0.08} />
            <Shimmer className="h-[10px] rounded-full" style={{ width: `${30 - (index % 3) * 6}%` }} delay={index * 0.08 + 0.05} />
            <Shimmer className="h-[10px] w-[70px] rounded-full" delay={index * 0.08 + 0.1} />
            <div className="flex-1" />
            <Shimmer className="h-[10px] w-[54px] rounded-full" delay={index * 0.08 + 0.15} />
            <Shimmer className="h-[10px] w-[38px] rounded-full" delay={index * 0.08 + 0.2} />
          </motion.div>
        ))}
      </div>

      {/* The status floats over the skeleton rather than replacing it, so the
          list is already in position underneath when the data lands. */}
      <div className="pointer-events-none absolute inset-x-0 top-[38%] flex justify-center">
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 330, damping: 28 }}
          className="surface-card flex items-center gap-3 rounded-2xl border border-line py-2.5 pl-2.5 pr-4"
          style={{ boxShadow: 'var(--shadow-lift)', background: 'color-mix(in oklab, var(--surface-raised) 88%, transparent)', backdropFilter: 'blur(10px)' }}
        >
          <span className="relative block">
            <Halo tint="var(--accent-solid)" size={34} />
            <MarkTile size={34} pulse />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-primary">
              {title}
              <Dots />
            </span>
            {detail ? <span className="mt-[1px] break-words text-[11.5px] text-tertiary [overflow-wrap:anywhere]">{detail}</span> : null}
            <Track />
          </span>
        </motion.div>
      </div>
    </div>
  );
}

function PanelLoading({ title, detail, testId }: { title: string; detail?: ReactNode; testId?: string | undefined }) {
  return (
    <div data-testid={testId} className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-10">
      <Grid tint="var(--accent-solid)" />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 330, damping: 30 }}
        className="relative flex flex-col items-center"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-50px] h-[210px] w-[300px] -translate-x-1/2 rounded-full opacity-60 blur-[50px]"
          style={{ background: 'radial-gradient(circle at 50% 42%, color-mix(in oklab, var(--accent-solid) 26%, transparent), transparent 70%)' }}
        />
        <span className="relative block">
          <Halo tint="var(--accent-solid)" size={52} />
          <MarkTile size={52} pulse />
        </span>
        <div className="relative mt-4 flex items-center gap-1.5 text-[13.5px] font-medium text-secondary">
          {title}
          <Dots />
        </div>
        {detail ? <p className="relative mt-1 max-w-[420px] text-center text-[12px] text-tertiary">{detail}</p> : null}
        <div className="relative mt-3 w-[190px]">
          <Track />
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Two rings leaving the mark on a long loop.
 *
 * A spinner asks you to wait. This says something is on its way, and it is
 * slow enough (2.4s) that it reads as a pulse rather than a fidget.
 */
function Halo({ tint, size }: { tint: string; size: number }) {
  return (
    <>
      {[0, 1].map((ring) => (
        <motion.span
          key={ring}
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 rounded-[30%] border"
          style={{ borderColor: `color-mix(in oklab, ${tint} 45%, transparent)`, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
          initial={{ opacity: 0.45, scale: 1 }}
          animate={{ opacity: 0, scale: 1.9 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut', delay: ring * 1.2 }}
        />
      ))}
    </>
  );
}

/** An indeterminate bar. It sweeps rather than fills, because nobody knows how long. */
function Track() {
  return (
    <span aria-hidden className="mt-2 block h-[3px] w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
      <motion.span
        className="block h-full w-[42%] rounded-full"
        style={{ background: 'linear-gradient(90deg, transparent, var(--accent-base), transparent)' }}
        animate={{ x: ['-110%', '260%'] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      />
    </span>
  );
}

/** A faint grid, so an empty region has a floor rather than being a void. */
function Grid({ tint }: { tint: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-[0.45]"
      style={{
        backgroundImage:
          'linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
        maskImage: `radial-gradient(ellipse 70% 60% at 50% 45%, color-mix(in oklab, ${tint} 100%, transparent), transparent 75%)`,
        WebkitMaskImage: `radial-gradient(ellipse 70% 60% at 50% 45%, black, transparent 75%)`,
      }}
    />
  );
}

function Dots() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="h-[3px] w-[3px] rounded-full bg-[var(--text-tertiary)]"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.16, ease: 'easeInOut' }}
        />
      ))}
    </span>
  );
}

/** A bar that catches the light as it passes, rather than blinking on and off. */
export function Shimmer({ className = '', style, delay = 0 }: { className?: string; style?: CSSProperties; delay?: number }) {
  return <span className={`shimmer block ${className}`} style={{ ...style, animationDelay: `${delay}s` }} />;
}
