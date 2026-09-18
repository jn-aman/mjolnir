import { useEffect, type RefObject } from 'react';

/**
 * Calls `onOutside` on a pointer press outside `ref`, ignoring anything in a
 * floating layer (menus, dialogs, tooltips, toasts), which belongs to the
 * element even though it is portalled elsewhere.
 *
 * When `onOutside` returns `true` the press is swallowed: the thing that was
 * clicked does not get it. That is how "you have unsaved changes" holds the
 * page still until Save or Discard is answered, instead of asking while the
 * row you clicked already replaced what you were editing.
 */
export function useOutsideClick(ref: RefObject<HTMLElement | null>, active: boolean, onOutside: () => boolean | void): void {
  useEffect(() => {
    if (!active) return;
    const swallowClick = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    const handler = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || !ref.current) return;
      if (ref.current.contains(target)) return;
      if (target.closest('[data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [role="alertdialog"], [data-sonner-toaster], [cmdk-dialog], [data-ask-save]')) return;
      if (onOutside() === true) {
        swallowClick(event);
        window.addEventListener('click', swallowClick, { capture: true, once: true });
        window.addEventListener('mousedown', swallowClick, { capture: true, once: true });
      }
    };
    window.addEventListener('pointerdown', handler, true);
    return () => window.removeEventListener('pointerdown', handler, true);
  }, [ref, active, onOutside]);
}
