import { expect, test } from './fixtures/app.ts';

/**
 * The dock, whose one rule is that tabs accumulate.
 *
 * This is the spec that would have caught the mistake. The first version
 * reused the slot for a tab's kind, so opening logs for a second pod took
 * over the first. Every tab in here is a live thing, so that does not put
 * something away, it kills it.
 */

/**
 * Opens the logs of the nth pod through the row menu.
 *
 * It waits for the menu to go before returning. Radix leaves the previous
 * menu's nodes in the document for a moment after a click, so a spec that
 * opens two menus in a row finds two copies of the same item and fails on
 * strict mode rather than on anything real.
 */
async function openLogs(window: import('@playwright/test').Page, index: number) {
  const rows = window.getByTestId('resource-row');
  await expect(rows.nth(index)).toBeVisible();
  await rows.nth(index).click({ button: 'right' });
  await window.getByTestId('menu-logs').last().click();
  await expect(window.getByTestId('menu-logs')).toHaveCount(0);
}

test.describe('dock', () => {
  test('is there before anything has been put in it', async ({ window }) => {
    // A dock that appears only once something opens one is a dock nobody
    // discovers, and it leaves no way to simply open a terminal.
    await expect(window.getByTestId('dock')).toBeVisible();
    await expect(window.getByTestId('dock-new')).toBeVisible();
  });

  test('opening logs for a second pod does not take over the first', async ({ window }) => {
    await window.getByTestId('nav-pods').click();
    await openLogs(window, 0);
    await expect(window.getByTestId('dock-tab')).toHaveCount(1);

    await openLogs(window, 1);
    // Two logs, two tabs. This is the whole rule.
    await expect(window.getByTestId('dock-tab')).toHaveCount(2);
  });

  test('opening the same pod twice focuses it rather than tailing it twice', async ({ window }) => {
    await window.getByTestId('nav-pods').click();
    await openLogs(window, 0);
    await openLogs(window, 0);
    await expect(window.getByTestId('dock-tab')).toHaveCount(1);
  });

  test('keeps an object open beside a log', async ({ window }) => {
    await window.getByTestId('nav-pods').click();
    await openLogs(window, 0);
    await expect(window.getByTestId('dock-tab')).toHaveCount(1);

    await window.getByTestId('nav-deployments').click();
    const deployment = window.getByTestId('resource-row').first();
    await expect(deployment).toBeVisible();
    // Through the drawer rather than the row's context menu. The demo cluster
    // ticks like a real one, and a re-rendered row takes its open menu with
    // it, which is a race rather than a finding.
    await deployment.click();
    await expect(window.getByTestId('resource-drawer')).toBeVisible();
    await window.getByTestId('drawer-pin').click();

    // Different kinds, side by side, neither replacing the other.
    await expect(window.getByTestId('dock-tab')).toHaveCount(2);
  });

  test('closing a tab leaves something selected', async ({ window }) => {
    await window.getByTestId('nav-pods').click();
    for (const index of [0, 1, 2]) await openLogs(window, index);
    await expect(window.getByTestId('dock-tab')).toHaveCount(3);

    await window.getByTestId('dock-tab').nth(1).locator('[aria-label^="Close"]').click();
    await expect(window.getByTestId('dock-tab')).toHaveCount(2);
    // Closing must not leave the dock blank with tabs still in it.
    await expect(window.locator('[data-testid="dock-tab"][data-active="true"]')).toHaveCount(1);
  });

  test('the plus button opens its list on a left click', async ({ window }) => {
    // It was a right-click-only context menu on a button, so the one obvious
    // gesture did nothing at all.
    await window.getByTestId('dock-new').click();
    await expect(window.getByTestId('dock-new-menu')).toBeVisible();
  });

  test('the logs entry opens a picker rather than telling you to go elsewhere', async ({ window }) => {
    await window.getByTestId('dock-new').click();
    await window.getByTestId('menu-logs').last().click();

    const picker = window.getByTestId('dock-picker');
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId('dock-picker-pod').first()).toBeVisible();

    await picker.getByTestId('dock-picker-pod').first().click();
    await expect(window.getByTestId('dock-tab')).toHaveCount(1);
  });
});
