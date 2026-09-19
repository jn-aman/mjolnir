import { useSyncExternalStore } from 'react';

/**
 * What a module wants in the sidebar, beyond its fixed sections.
 *
 * The bucket store knows which buckets exist; the sidebar is where they
 * belong. They are rendered in different parts of the tree, so one of them
 * has to tell the other, and passing it up through the app's whole state
 * would make every module's contents part of the app shell's business.
 *
 * A module publishes a list here and the sidebar subscribes. Deliberately
 * tiny and deliberately not persisted: it describes what is on screen right
 * now, and on a fresh start there is nothing on screen yet.
 */

export interface NavItem {
  readonly id: string;
  readonly label: string;
  /** Shown dim after the label: a count, a size, a host. */
  readonly hint?: string | undefined;
  readonly active?: boolean;
  readonly onSelect: () => void;
}

export interface NavGroup {
  readonly title: string;
  readonly items: readonly NavItem[];
  /** Shown instead of the items when there are none. */
  readonly empty?: string | undefined;
  /** An action at the end of the group, such as "New bucket". */
  readonly action?: { readonly label: string; readonly onSelect: () => void } | undefined;
}

let groups: readonly NavGroup[] = [];
const listeners = new Set<() => void>();

export function setModuleNav(next: readonly NavGroup[]): void {
  groups = next;
  for (const listener of listeners) listener();
}

export function clearModuleNav(): void {
  if (groups.length === 0) return;
  groups = [];
  for (const listener of listeners) listener();
}

export function useModuleNav(): readonly NavGroup[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => groups,
    () => groups,
  );
}
