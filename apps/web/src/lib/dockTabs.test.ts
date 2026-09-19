import { describe, expect, it } from 'vitest';
import { closeTab, openTab, reorderTabs } from './dockTabs.ts';
import type { DockTab } from '../components/Dock.tsx';

/**
 * The dock's one rule: tabs accumulate.
 *
 * This is here because the first version got it wrong in a way that was easy
 * to defend and wrong anyway. It borrowed the editor idea of a preview tab, so
 * opening a second log took over the first one's slot unless you pinned it.
 * That is right for files, which are still on disk when the tab goes, and
 * wrong for a dock, where every tab is a live thing: a tail that is streaming,
 * a shell with your history in it. Reusing the slot does not put something
 * away, it kills it.
 */

const tab = (id: string, kind: DockTab['kind'] = 'logs'): DockTab => ({
  id,
  kind,
  title: id,
  context: 'test',
});

describe('opening a tab', () => {
  it('keeps what is already there', () => {
    const first = openTab([], tab('logs:a'));
    const second = openTab(first.tabs, tab('logs:b'));
    const third = openTab(second.tabs, tab('logs:c'));

    // Three logs, three tabs. Nothing took over anything.
    expect(third.tabs.map((entry) => entry.id)).toEqual(['logs:a', 'logs:b', 'logs:c']);
    expect(third.activeId).toBe('logs:c');
  });

  it('keeps tabs of different kinds side by side', () => {
    const withLogs = openTab([], tab('logs:a'));
    const withShell = openTab(withLogs.tabs, tab('shell:a', 'terminal'));
    const withObject = openTab(withShell.tabs, tab('resource:api', 'resource'));

    expect(withObject.tabs).toHaveLength(3);
  });

  it('focuses what is already open rather than tailing the same log twice', () => {
    const first = openTab([], tab('logs:a'));
    const again = openTab(first.tabs, tab('logs:a'));

    expect(again.tabs).toHaveLength(1);
    expect(again.activeId).toBe('logs:a');
  });
});

describe('closing a tab', () => {
  it('moves focus to the neighbour rather than to nothing', () => {
    const tabs = [tab('a'), tab('b'), tab('c')];
    // Closing the middle one leaves you looking at the one that slid into its
    // place, which is what closing a tab does everywhere else.
    expect(closeTab(tabs, 'b')).toEqual({ tabs: [tabs[0], tabs[2]], activeId: 'c' });
  });

  it('falls back to the left when the last tab goes', () => {
    const tabs = [tab('a'), tab('b')];
    expect(closeTab(tabs, 'b').activeId).toBe('a');
  });

  it('has nothing to focus when the dock empties', () => {
    expect(closeTab([tab('a')], 'a')).toEqual({ tabs: [], activeId: null });
  });

  it('ignores a tab that is not there', () => {
    const tabs = [tab('a')];
    expect(closeTab(tabs, 'nope').tabs).toEqual(tabs);
  });
});

describe('reordering', () => {
  it('drops the dragged tab where the target was', () => {
    const tabs = [tab('a'), tab('b'), tab('c')];
    expect(reorderTabs(tabs, 'c', 'a').map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
    expect(reorderTabs(tabs, 'a', 'c').map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  });

  it('leaves the order alone when the drag goes nowhere', () => {
    const tabs = [tab('a'), tab('b')];
    expect(reorderTabs(tabs, 'a', 'a').map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(reorderTabs(tabs, 'a', 'missing').map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});
