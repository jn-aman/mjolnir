import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { KindMark } from '../ui/KindMark.tsx';
import { Truncate } from '../ui/Truncate.tsx';
import { BIG_VALUE, ValueViewer } from '../ui/ValueViewer.tsx';

/**
 * The pieces every detail pane is built from.
 *
 * One vocabulary across twenty-seven kinds, so a Node and a RoleBinding read
 * the same way: a titled section, a two-column field list, chips for anything
 * repeated, a table for anything with rows, and a bar for anything that is a
 * share of a total. Kind-specific cleverness goes in the renderer; the shapes
 * live here, and none of them can drift apart.
 */

export function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-tertiary">
        <span aria-hidden className="h-[10px] w-[3px] rounded-full bg-accent" />
        {title}
        {hint ? <span className="font-normal normal-case tracking-normal text-[10.5px] text-tertiary opacity-80">{hint}</span> : null}
        {action ? <span className="ml-auto">{action}</span> : null}
      </h3>
      {children}
    </section>
  );
}

export type FieldRow = readonly [label: string, value: ReactNode, mono?: boolean];

export function Fields({ rows }: { rows: readonly (FieldRow | null | false)[] }) {
  const kept = rows.filter(Boolean) as FieldRow[];
  if (kept.length === 0) return null;
  return (
    <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-[7px] text-[12.5px]">
      {kept.map(([label, value, mono]) => (
        <div key={label} className="contents">
          <dt className="text-secondary">{label}</dt>
          <dd className={`m-0 min-w-0 break-words text-primary [overflow-wrap:anywhere] ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A key=value pill. Used for labels, annotations, selectors and node labels. */
export function Chips({ values, empty = 'none' }: { values: Record<string, string> | undefined; empty?: string }) {
  const entries = Object.entries(values ?? {});
  const [opened, setOpened] = useState<{ key: string; value: string } | null>(null);
  if (entries.length === 0) return <span className="text-[12px] text-tertiary">{empty}</span>;

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([key, value]) => {
          // `last-applied-configuration` is a whole manifest in an annotation.
          // Showing it in a tooltip gives someone eight lines of dense JSON
          // they cannot select, search or fold, which is a worse answer than
          // not showing it. Anything this long opens properly instead.
          const big = value.length > BIG_VALUE;
          const content = <Truncate mode="middle" tail={10} text={`${key}=${value}`} className="max-w-[420px]" />;
          return big ? (
            <button
              key={key}
              type="button"
              data-testid="chip-open"
              onClick={() => setOpened({ key, value })}
              title={`Open ${key}`}
              className="flex max-w-full items-baseline rounded-md border border-[var(--border-strong)] bg-overlay px-2 py-[3px] font-mono text-[11px] transition-colors duration-100 hover:border-accent hover:text-accent"
            >
              {content}
            </button>
          ) : (
            <span key={key} className="flex max-w-full items-baseline rounded-md border border-[var(--border-strong)] bg-overlay px-2 py-[3px] font-mono text-[11px]">
              {content}
            </span>
          );
        })}
      </div>
      <ValueViewer
        open={opened !== null}
        title={opened?.key ?? ''}
        subtitle="annotation"
        value={opened?.value ?? ''}
        onClose={() => setOpened(null)}
      />
    </>
  );
}

/** A flat list of strings as pills, for taints, finalizers, access modes. */
export function Tags({ values, tint = 'var(--text-tertiary)', empty = 'none' }: { values: readonly string[]; tint?: string; empty?: string }) {
  if (values.length === 0) return <span className="text-[12px] text-tertiary">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="rounded-md border px-2 py-[3px] font-mono text-[11px]"
          style={{ color: tint, borderColor: `color-mix(in oklab, ${tint} 35%, transparent)`, background: `color-mix(in oklab, ${tint} 10%, transparent)` }}
        >
          {value}
        </span>
      ))}
    </div>
  );
}

/**
 * A table, for anything with rows: ports, rules, subjects, conditions.
 *
 * Built here rather than reusing the virtualised list, because a detail pane
 * has ten rows and no need for a scroll container, a filter or a header menu.
 */
export function Table({
  head,
  rows,
  empty = 'none',
  align,
}: {
  head: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  empty?: string;
  align?: readonly ('left' | 'right')[];
}) {
  if (rows.length === 0) return <span className="text-[12px] text-tertiary">{empty}</span>;
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="bg-sunken">
            {head.map((label, index) => (
              <th
                key={label}
                className={`border-b border-line px-2.5 py-[6px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-tertiary ${
                  align?.[index] === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="row-hover">
              {row.map((cell, index) => (
                <td
                  key={index}
                  className={`border-b border-[var(--border-subtle)] px-2.5 py-[7px] align-top text-secondary last:border-b-0 ${
                    align?.[index] === 'right' ? 'text-right tabular-nums' : ''
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A share of a total, with the numbers beside it rather than in a tooltip. */
export function Bar({ label, used, total, unit, tint = 'var(--accent-base)' }: { label: string; used: number; total: number; unit?: string; tint?: string }) {
  const share = total > 0 ? Math.min(1, used / total) : 0;
  const percent = Math.round(share * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-secondary">{label}</span>
        <span className="font-mono text-[11.5px] tabular-nums text-primary">
          {format(used)}
          {unit ? ` ${unit}` : ''} <span className="text-tertiary">of {format(total)}{unit ? ` ${unit}` : ''}</span>{' '}
          <span style={{ color: percent > 90 ? 'var(--status-error)' : percent > 75 ? 'var(--status-warn)' : 'var(--text-tertiary)' }}>{percent}%</span>
        </span>
      </div>
      <span className="block h-[6px] w-full overflow-hidden rounded-full bg-sunken">
        <motion.span
          className="block h-full rounded-full"
          style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${tint} 70%, white 12%), ${tint})` }}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ type: 'spring', stiffness: 220, damping: 30 }}
        />
      </span>
    </div>
  );
}

function format(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2).replace(/\.?0+$/, '');
}

export interface ConditionShape {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  lastUpdateTime?: string;
}

/**
 * Conditions, with the interesting ones first.
 *
 * Kubernetes reports conditions in whatever order the controller wrote them,
 * and the one that matters is almost always the one that is false. So anything
 * unhealthy sorts to the top: the point of this block is to answer "what is
 * wrong" without reading nine rows of True.
 */
export function Conditions({ conditions }: { conditions: readonly ConditionShape[] | undefined }) {
  const list = [...(conditions ?? [])];
  if (list.length === 0) return <span className="text-[12px] text-tertiary">none reported</span>;
  const bad = (condition: ConditionShape): boolean => {
    const negative = /Pressure$|^NetworkUnavailable$|Failed|Unreachable/.test(condition.type ?? '');
    return negative ? condition.status === 'True' : condition.status !== 'True';
  };
  list.sort((a, b) => Number(bad(b)) - Number(bad(a)));
  return (
    <Table
      head={['Condition', 'Status', 'Reason', 'Message']}
      rows={list.map((condition) => [
        <span key="t" className="font-medium text-primary">{condition.type ?? ''}</span>,
        <span key="s" style={{ color: bad(condition) ? 'var(--status-warn)' : 'var(--status-ok)' }}>{condition.status ?? ''}</span>,
        <span key="r">{condition.reason ?? '-'}</span>,
        <span key="m" className="break-words [overflow-wrap:anywhere]">{condition.message ?? '-'}</span>,
      ])}
    />
  );
}

/** A link to another object, with its kind mark. The way you walk the graph. */
export function RefChip({
  kind,
  name,
  hint,
  onOpen,
  testId,
}: {
  kind: string;
  name: string;
  hint?: string | undefined;
  onOpen?: (() => void) | undefined;
  testId?: string;
}) {
  const body = (
    <>
      <KindMark kind={kind} />
      <span className="min-w-0 font-mono text-[11.5px] text-primary">
        <Truncate text={name} />
      </span>
      {hint ? <span className="shrink-0 text-[10.5px] text-tertiary">{hint}</span> : null}
      {onOpen ? <ArrowUpRight size={11} strokeWidth={2.2} aria-hidden className="shrink-0 text-tertiary" /> : null}
    </>
  );
  const className = 'flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-[4px] text-left';
  if (!onOpen) return <span className={className}>{body}</span>;
  return (
    <motion.button
      type="button"
      data-testid={testId}
      onClick={onOpen}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 520, damping: 30 }}
      className={`${className} transition-colors duration-100 hover:border-accent hover:bg-accent-subtle`}
    >
      {body}
    </motion.button>
  );
}

export function Callout({ tone, title, children }: { tone: 'error' | 'warn' | 'info'; title: string; children?: ReactNode }) {
  const border = tone === 'error' ? 'var(--status-error)' : tone === 'warn' ? 'var(--status-warn)' : 'var(--accent-base)';
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: `color-mix(in oklab, ${border} 45%, transparent)`, background: `color-mix(in oklab, ${border} 8%, transparent)` }}>
      <div className="mb-1 text-[12.5px] font-semibold" style={{ color: border }}>{title}</div>
      {children ? <div className="text-[12px] leading-[18px] text-secondary">{children}</div> : null}
    </div>
  );
}

/** Kubernetes quantities: 100m, 2, 1Gi, 500Mi, 1e3. Returned in base units. */
export function parseQuantity(value: string | undefined): number {
  if (!value) return 0;
  const match = /^([0-9.]+)([a-zA-Z]*)$/.exec(value.trim());
  if (!match) return 0;
  const amount = Number(match[1]);
  const suffix = match[2] ?? '';
  const factors: Record<string, number> = {
    '': 1,
    n: 1e-9,
    u: 1e-6,
    m: 1e-3,
    k: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
  };
  return amount * (factors[suffix] ?? 1);
}

export function bytes(value: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}
