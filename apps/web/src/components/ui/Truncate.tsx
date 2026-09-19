import { useRef, useState, type ReactNode } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

/**
 * One line of text that ends in an ellipsis, and a tooltip that does not.
 *
 * A table whose rows grow to three lines because one container is called
 * `k8s_local-path-provisioner_local-path-provisioner-5db9d5cbbb-rlv8d_kube-system_64c61dd6-…_0`
 * has stopped being a table. But an ellipsis that hides the answer is just as
 * useless, so the full value is always one hover away, selectable, and still in
 * the right-click menu as "Copy".
 *
 * Which end to cut is a judgement about the string, not a global setting:
 *
 * - `end` for names and images. Kubernetes identifiers are front-loaded, so
 *   the workload is in the first thirty characters and the replica-set hash,
 *   the pod suffix and the container UID are not.
 * - `middle` for paths and object keys, where the last segment is the file
 *   name and the first is the bucket, and only the directories between them
 *   are skippable.
 *
 * Middle mode pins the tail in its own element rather than measuring text, so
 * it costs nothing per row and the ellipsis appears exactly when the browser
 * decides the head no longer fits.
 */
interface TruncateProps {
  readonly text: string;
  readonly mode?: 'end' | 'middle';
  /** How many characters stay pinned at the end in middle mode. */
  readonly tail?: number;
  readonly className?: string;
  readonly mono?: boolean;
  readonly testId?: string;
  /** Rendered in place of the plain text, for highlighted matches. */
  readonly children?: ReactNode;
  /** A second line under the tooltip's value, for a hint or a full path. */
  readonly hint?: string | undefined;
}

export function Truncate({ text, mode = 'end', tail = 12, className = '', mono = false, testId, children, hint }: TruncateProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Only offer the tooltip when something is actually hidden. A tooltip that
  // repeats what is already on screen is noise on every single row.
  const check = (): void => {
    const element = ref.current;
    if (!element) return;
    setOpen(element.scrollWidth > element.clientWidth + 1);
  };

  const base = `${mono ? 'font-mono' : ''} ${className}`;
  const splitAt = mode === 'middle' && text.length > tail + 4 ? text.length - tail : text.length;
  const head = text.slice(0, splitAt);
  const rest = text.slice(splitAt);

  return (
    <Tooltip.Root delayDuration={220}>
      <Tooltip.Trigger asChild>
        <span
          data-testid={testId}
          className={`flex min-w-0 items-baseline ${base}`}
          onPointerEnter={check}
          onPointerLeave={() => setOpen(false)}
          onFocus={check}
          onBlur={() => setOpen(false)}
          tabIndex={-1}
        >
          <span ref={ref} className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {children ?? head}
          </span>
          {rest ? <span className="shrink-0 whitespace-pre">{rest}</span> : null}
        </span>
      </Tooltip.Trigger>
      {open ? (
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          data-testid="truncate-tip"
          className="z-[90] max-w-[min(720px,88vw)] select-text rounded-md border border-line bg-overlay px-2.5 py-1.5 shadow-[var(--shadow-lift)]"
        >
          <div className={`break-words text-[12px] leading-[1.5] text-primary [overflow-wrap:anywhere] ${mono ? 'font-mono' : ''}`}>{text}</div>
          {hint ? <div className="mt-0.5 break-words text-[11px] text-tertiary [overflow-wrap:anywhere]">{hint}</div> : null}
          <Tooltip.Arrow className="fill-[var(--surface-overlay)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
      ) : null}
    </Tooltip.Root>
  );
}

/**
 * Which way a value should be cut, from what kind of value it is.
 *
 * Kept here rather than at each call site so the answer is the same in a table,
 * a drawer and a palette result.
 */
export function truncateMode(kind: 'name' | 'image' | 'path' | 'key' | 'url' | 'id' | 'text'): 'end' | 'middle' {
  return kind === 'path' || kind === 'key' || kind === 'url' ? 'middle' : 'end';
}
