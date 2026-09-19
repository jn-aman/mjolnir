import type { DockTab } from '../components/Dock.tsx';

/**
 * How a tab gets into the dock.
 *
 * **Tabs accumulate. Nothing is ever replaced.** Open the logs for one pod,
 * then another, and you have two tabs; open a deployment beside them and you
 * have three. The dock is a set of things you are keeping open, and the only
 * thing that takes one away is closing it.
 *
 * This was wrong once, in a way worth recording. The first version borrowed
 * the editor idea of a preview tab: a tab was transient until you pinned it,
 * so opening a second log took over the first one's slot. That is a good rule
 * for a file tree, where you are browsing one thing at a time and the file is
 * still on disk. It is the wrong rule here, because a dock tab is a *live*
 * thing: a log tail that is streaming, a shell with your history in it, a
 * deployment you are watching roll out. Reusing the slot does not put
 * something away, it kills it. So the rule is the simple one, and the pin it
 * needed is gone with it.
 *
 * Opening something already in the dock focuses it rather than opening a
 * second copy, because two tails of the same log are never what anybody meant.
 */

export interface OpenResult {
  readonly tabs: DockTab[];
  readonly activeId: string;
}

/** Adds a tab, or focuses the one already there. */
export function openTab(current: readonly DockTab[], tab: DockTab): OpenResult {
  const existing = current.find((entry) => entry.id === tab.id);
  if (existing) return { tabs: [...current], activeId: existing.id };
  return { tabs: [...current, tab], activeId: tab.id };
}

export function closeTab(current: readonly DockTab[], id: string): { tabs: DockTab[]; activeId: string | null } {
  const index = current.findIndex((entry) => entry.id === id);
  const tabs = current.filter((entry) => entry.id !== id);
  if (tabs.length === 0) return { tabs, activeId: null };
  // Focus moves to the neighbour on the right, then the left, which is what
  // closing a tab does everywhere else.
  const next = tabs[Math.min(index, tabs.length - 1)];
  return { tabs, activeId: next?.id ?? null };
}

/** Drag to reorder: the dragged tab lands where the target was. */
export function reorderTabs(current: readonly DockTab[], from: string, to: string): DockTab[] {
  const source = current.findIndex((entry) => entry.id === from);
  const target = current.findIndex((entry) => entry.id === to);
  if (source === -1 || target === -1 || source === target) return [...current];
  const tabs = [...current];
  const [moved] = tabs.splice(source, 1);
  if (moved) tabs.splice(target, 0, moved);
  return tabs;
}
