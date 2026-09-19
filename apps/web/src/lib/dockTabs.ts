import type { DockTab } from '../components/Dock.tsx';

/**
 * How a tab gets into the dock, which is the part Lens gets right.
 *
 * A dock tab is **transient until you pin it**. Open the logs for one pod,
 * then another, and the second replaces the first: you were looking at logs,
 * you are still looking at logs, and a row of eleven abandoned tabs is not a
 * feature. Pin one and it stays, and the next log tab opens beside it instead
 * of on top of it.
 *
 * Without that rule a dock is either a tab graveyard, because nothing ever
 * closes, or amnesiac, because everything replaces everything. The pin is
 * what lets the same gesture mean both "show me this" and "keep this".
 *
 * Pinning is a double-click on the tab, which is the same gesture that makes
 * an editor tab permanent in every editor people already use.
 */

/** Two tabs are the same slot when they are the same kind and neither is pinned. */
function reusable(tab: DockTab, kind: DockTab['kind']): boolean {
  return tab.kind === kind && !tab.pinned;
}

export interface OpenResult {
  readonly tabs: DockTab[];
  readonly activeId: string;
}

/**
 * Adds a tab, or takes over the unpinned one of its kind.
 *
 * Opening something already in the dock always just selects it, pinned or
 * not: asking for a thing you already have should never destroy it.
 */
export function openTab(current: readonly DockTab[], tab: DockTab): OpenResult {
  const existing = current.find((entry) => entry.id === tab.id);
  if (existing) {
    return { tabs: [...current], activeId: existing.id };
  }

  const slot = current.findIndex((entry) => reusable(entry, tab.kind));
  if (slot === -1) {
    return { tabs: [...current, tab], activeId: tab.id };
  }

  const tabs = [...current];
  // In place, so a tab does not jump to the end of the row when its contents
  // change. The eye is already on that position.
  tabs[slot] = tab;
  return { tabs, activeId: tab.id };
}

/** Opens a tab and pins it in one step, for "keep this open" verbs. */
export function openPinned(current: readonly DockTab[], tab: DockTab): OpenResult {
  const result = openTab(current, { ...tab, pinned: true });
  return { tabs: result.tabs.map((entry) => (entry.id === tab.id ? { ...entry, pinned: true } : entry)), activeId: result.activeId };
}

export function togglePinned(current: readonly DockTab[], id: string): DockTab[] {
  return current.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab));
}
