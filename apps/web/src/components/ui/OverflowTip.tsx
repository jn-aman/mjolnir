import { useRef, useState, type ReactNode } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

/**
 * A cell that shows its whole value when the column is too narrow for it.
 *
 * Wrapping was the wrong answer: one container called
 * `k8s_local-path-provisioner_local-path-provisioner-5db9d5cbbb-rlv8d_kube-system_…_0`
 * turns every row in the table into three, and a table whose row height depends
 * on its worst string is not a table any more. Cutting it without a way back is
 * the other wrong answer.
 *
 * So cells clip to one line, and hovering one that is clipped shows the value
 * in full, selectable, wrapped, wide. The tooltip appears only when something
 * is genuinely hidden, which is measured at hover rather than guessed from a
 * character count, so a wide window simply never shows one. Nothing is
 * computed while scrolling; the measurement happens on the cell under the
 * pointer and nowhere else.
 */
export function OverflowTip({
  children,
  className = '',
  testId,
  align = 'start',
  mono = false,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
  align?: 'start' | 'end';
  mono?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);

  const check = (): void => {
    const element = ref.current;
    if (!element) return;
    const clipped =
      element.scrollWidth > element.clientWidth + 1 ||
      Array.from(element.querySelectorAll<HTMLElement>('*')).some((node) => node.scrollWidth > node.clientWidth + 1);
    const value = (element.textContent ?? '').trim();
    setText(clipped && value ? value : null);
  };

  return (
    <Tooltip.Root delayDuration={200}>
      <Tooltip.Trigger asChild>
        <div
          ref={ref}
          data-testid={testId}
          className={className}
          onPointerEnter={check}
          onPointerLeave={() => setText(null)}
        >
          {children}
        </div>
      </Tooltip.Trigger>
      {text === null ? null : (
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          align={align}
          sideOffset={6}
          collisionPadding={12}
          data-testid="overflow-tip"
          className="z-[90] max-w-[min(720px,88vw)] select-text rounded-md border border-line bg-overlay px-2.5 py-1.5 shadow-[var(--shadow-lift)]"
        >
          <div className={`break-words text-[12px] leading-[1.5] text-primary [overflow-wrap:anywhere] ${mono ? 'font-mono' : ''}`}>{text}</div>
          <Tooltip.Arrow className="fill-[var(--surface-overlay)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
      )}
    </Tooltip.Root>
  );
}
