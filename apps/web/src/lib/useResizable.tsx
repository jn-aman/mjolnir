import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A width that can be dragged and is remembered.
 *
 * One hook for every resizable edge in the app, the sidebar, the drawer, a
 * split pane, so they all behave the same way: a wide invisible grip, a live
 * drag, a clamp to sane bounds, and the result stored per surface so the layout
 * someone set is the layout they get back tomorrow.
 *
 * `direction` says which way the edge grows: `right` for a panel anchored on
 * the left (dragging right widens it), `left` for one anchored on the right,
 * `up` for a panel anchored at the bottom (the dock), where the "width" is a
 * height and dragging up makes it taller.
 */

interface Options {
  readonly key: string;
  readonly initial: number;
  readonly min: number;
  readonly max: number;
  readonly direction: 'left' | 'right' | 'up';
}

const STORAGE_PREFIX = 'mjolnir.width.';

function stored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function useResizable({ key, initial, min, max, direction }: Options) {
  const [width, setWidth] = useState(() => Math.min(max, Math.max(min, stored(key, initial))));
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; width: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, String(Math.round(width)));
    } catch {
      // A width that cannot be saved still applies for this session.
    }
  }, [key, width]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      start.current = { x: event.clientX, y: event.clientY, width };
      setDragging(true);
      // Dragging past the handle must not select text or fire hover states
      // across the whole window; the cursor is locked for the drag's duration.
      document.body.style.cursor = direction === 'up' ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';

      const move = (moveEvent: PointerEvent) => {
        const origin = start.current;
        if (!origin) return;
        const next =
          direction === 'up'
            ? origin.width + (origin.y - moveEvent.clientY)
            : direction === 'right'
              ? origin.width + (moveEvent.clientX - origin.x)
              : origin.width - (moveEvent.clientX - origin.x);
        setWidth(Math.min(max, Math.max(min, next)));
      };
      const stop = () => {
        start.current = null;
        setDragging(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
    },
    [width, min, max, direction],
  );

  const reset = useCallback(() => setWidth(initial), [initial]);

  return { width, dragging, onPointerDown, reset };
}

/**
 * The grip itself. 8px wide, invisible until hovered, sitting over the edge it
 * resizes. A 1px border is not a target anyone can hit; this is.
 */
export function ResizeHandle({
  side,
  onPointerDown,
  dragging,
  label,
}: {
  side: 'left' | 'right' | 'top';
  onPointerDown: (event: React.PointerEvent) => void;
  dragging: boolean;
  label: string;
}) {
  const horizontal = side === 'top';
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-label={label}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        // Double-click is a common "snap back" gesture on split panes.
        event.currentTarget.dispatchEvent(new CustomEvent('mjolnir:reset', { bubbles: true }));
      }}
      className={`group absolute z-30 ${
        horizontal
          ? 'inset-x-0 -top-[4px] h-[8px] cursor-row-resize'
          : `inset-y-0 w-[8px] cursor-col-resize ${side === 'left' ? '-left-[4px]' : '-right-[4px]'}`
      }`}
    >
      <span
        aria-hidden
        className={`absolute transition-colors duration-100 ${
          horizontal ? 'inset-x-0 top-[3px] h-[2px]' : 'inset-y-0 left-[3px] w-[2px]'
        } ${dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-[var(--border-strong)]'}`}
      />
    </div>
  );
}
