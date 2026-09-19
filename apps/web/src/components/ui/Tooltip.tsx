import * as Radix from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

/**
 * The label on an icon.
 *
 * An icon-only button is a rebus. It works once you know it, and until then
 * the only way to find out is to press it and see, which for "drain" or
 * "delete" is not an acceptable way to find out. The native `title` attribute
 * nominally solves this and does not: it waits about a second, it renders in
 * the operating system's own style rather than the app's, it cannot hold a
 * shortcut, it never appears for keyboard focus, and it does not appear at all
 * on a touch screen.
 *
 * So: instant. `delayDuration` is zero because the delay exists to stop
 * tooltips firing on a pointer that is merely passing over prose, and these
 * are on controls a pointer only reaches deliberately. `skipDelayDuration` is
 * generous, so moving along a row of buttons reads as one continuous label
 * rather than a sequence of pop-ins.
 *
 * The shortcut goes in the tooltip rather than beside the icon, because the
 * place to learn a shortcut is the moment you were about to use the mouse
 * instead.
 */
export function Tip({
  label,
  shortcut,
  hint,
  side = 'top',
  align = 'center',
  children,
  disabled = false,
}: {
  /** What the control does, in the words the menu would use. */
  readonly label: ReactNode;
  /** The chord, shown as a key cap. */
  readonly shortcut?: string | undefined;
  /** A second line, for the consequence or the caveat. */
  readonly hint?: ReactNode;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly align?: 'start' | 'center' | 'end';
  readonly children: ReactNode;
  /** For a control whose label is already visible; keeps call sites uniform. */
  readonly disabled?: boolean;
}) {
  if (disabled || (!label && !hint)) return <>{children}</>;

  return (
    <Radix.Root delayDuration={0}>
      <Radix.Trigger asChild>{children}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={10}
          data-testid="tip"
          className="z-[95] max-w-[280px] rounded-md border border-line bg-overlay px-2.5 py-1.5 shadow-[var(--shadow-lift)]"
          style={{ transformOrigin: 'var(--radix-tooltip-content-transform-origin)', animation: 'mjolnir-tip-in 110ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] leading-[1.45] text-primary">{label}</span>
            {shortcut ? (
              <kbd className="shrink-0 rounded-[4px] border border-line bg-sunken px-1.5 py-[1px] font-sans text-[10.5px] text-tertiary">
                {shortcut}
              </kbd>
            ) : null}
          </div>
          {hint ? <div className="mt-0.5 text-[11px] leading-[1.45] text-tertiary">{hint}</div> : null}
          <Radix.Arrow className="fill-[var(--surface-overlay)]" />
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
