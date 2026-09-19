import { expect, test } from './fixtures/app.ts';

/**
 * Time travel.
 *
 * Kubernetes keeps no history, so this window is only what has been seen
 * since a kind was first opened. The distinction the specs guard is between
 * "nothing changed" and "nothing has been seen yet": they look identical as
 * an empty list and only one of them is reassuring.
 */

/**
 * Opens the history of the one object in the demo that genuinely moves.
 *
 * The crash-looping pod's restart count climbs on a timer, the way a real
 * one's does. Pointing these at a deployment tested nothing: the demo's
 * deployments sit still, so the window stayed empty and the spec passed or
 * failed on whether the empty state happened to render.
 */
async function openHistory(window: import('@playwright/test').Page, name: string) {
  await window.getByTestId('nav-pods').click();
  const row = window.getByTestId('resource-row').filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(window.getByTestId('resource-drawer')).toBeVisible();
  await window.getByRole('tab', { name: 'History' }).click();
  await expect(window.getByTestId('history-panel')).toBeVisible();
}

test.describe('history', () => {
  test('says what it does not know rather than implying nothing changed', async ({ window }) => {
    await openHistory(window, 'CrashLoop');
    const empty = window.getByTestId('history-empty');
    if (await empty.isVisible()) {
      // The whole point of the wording: an empty list is not evidence the
      // object has been stable, only that nobody was watching.
      await expect(empty).toContainText('Kubernetes keeps no history of its own');
      await expect(empty).toContainText('not a record of the time before that');
    } else {
      await expect(window.getByTestId('history-revisions')).toBeVisible();
    }
  });

  test('records what changes while the app is watching', async ({ window }) => {
    await openHistory(window, 'CrashLoop');

    // The demo cluster moves on its own, like a real one. Something has to
    // land in the window, or nothing is being recorded at all.
    await expect
      .poll(async () => window.getByTestId('history-revisions').locator('> li').count(), { timeout: 25_000 })
      .toBeGreaterThan(0);
  });

  test('labels each entry by whether somebody did it', async ({ window }) => {
    await openHistory(window, 'CrashLoop');
    await expect
      .poll(async () => window.getByTestId('history-revisions').locator('> li').count(), { timeout: 25_000 })
      .toBeGreaterThan(0);

    const panel = window.getByTestId('history-panel');
    // "changed" is a decision, "settled" is the cluster reacting to one, and
    // a page that reads them the same buries the decision under the reaction.
    await expect(panel).toContainText(/changed|settled|First seen/);
  });

  test('is offered on a pod too, because what changed here is a question about anything', async ({ window }) => {
    await window.getByTestId('nav-pods').click();
    await window.getByTestId('resource-row').first().click();
    await expect(window.getByTestId('resource-drawer')).toBeVisible();
    await expect(window.getByRole('tab', { name: 'History' })).toBeVisible();
  });
});
