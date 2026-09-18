import { type RefObject } from 'react';
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
export declare function useOutsideClick(ref: RefObject<HTMLElement | null>, active: boolean, onOutside: () => boolean | void): void;
//# sourceMappingURL=useOutsideClick.d.ts.map