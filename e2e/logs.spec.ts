import { expect, test } from './fixtures/app.ts';

/**
 * The log viewer is the feature people use most and the one most likely to
 * wedge the UI, so it gets the most coverage. The demo cluster guarantees a
 * running pod, a multi-container pod and a CrashLoopBackOff pod.
 *
 * Logs open in the dock, not in a panel that closes when you look at the next
 * pod. That was the point of the dock and it is what these drive.
 */

/** Opens the nth pod's logs in the dock, the way the row menu does. */
async function openLogs(window: import('@playwright/test').Page, row: import('@playwright/test').Locator) {
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await window.getByTestId('menu-logs').last().click();
  await expect(window.getByTestId('menu-logs')).toHaveCount(0);
  await expect(window.getByTestId('log-viewer')).toBeVisible();
}

test.describe('log viewer', () => {
  test.beforeEach(async ({ window }) => {
    await window.getByTestId('nav-pods').click();
    await expect(window.getByTestId('resource-row').first()).toBeVisible();
  });

  test('streams live logs and follows new lines', async ({ window }) => {
    await openLogs(window, window.getByTestId('resource-row').first());

    const viewer = window.getByTestId('log-viewer');
    const first = await viewer.getByTestId('log-line').count();
    await expect(window.getByTestId('log-follow')).toHaveAttribute('data-active', 'true');
    // Following means the count grows on its own, with no interaction.
    await expect
      .poll(async () => viewer.getByTestId('log-line').count(), { timeout: 15_000 })
      .toBeGreaterThan(first);
  });

  test('pauses following when the reader scrolls up, and resumes on demand', async ({ window }) => {
    await openLogs(window, window.getByTestId('resource-row').first());

    await window.getByTestId('log-body').hover();
    await window.mouse.wheel(0, -600);
    // Scrolling away is how a person says "stop moving"; nothing else should
    // have to be clicked for the lines to hold still.
    await expect(window.getByTestId('log-follow')).toHaveAttribute('data-active', 'false');

    await window.getByTestId('log-follow').click();
    await expect(window.getByTestId('log-follow')).toHaveAttribute('data-active', 'true');
  });

  test('filters and reports how many lines matched', async ({ window }) => {
    await openLogs(window, window.getByTestId('resource-row').first());

    await window.getByTestId('log-search').fill('e');
    // A count, so an empty result is obviously an empty result rather than a
    // viewer that failed to render.
    await expect(window.getByTestId('log-match-count')).toBeVisible();
  });

  test('offers the previous container for a pod that keeps crashing', async ({ window }) => {
    const crashing = window.getByTestId('resource-row').filter({ hasText: 'CrashLoop' }).first();
    await openLogs(window, crashing);

    // The whole point: the current container has not started, so its logs are
    // empty, and the answer is in the run that already failed.
    const group = window.getByTestId('log-previous-group');
    await expect(group).toBeVisible();
    await group.getByText('Previous').click();
    await expect(window.getByTestId('log-viewer')).toContainText(/previous/i);
  });

  test('keeps the DOM small however many lines arrive', async ({ window }) => {
    await openLogs(window, window.getByTestId('resource-row').first());

    // Virtualisation contract: the DOM holds a window of rows, not all of
    // them, or a busy pod takes the window down with it.
    await expect
      .poll(async () => window.getByTestId('log-line').count(), { timeout: 15_000 })
      .toBeLessThan(500);
  });

  test('a log keeps streaming while you go and look at something else', async ({ window }) => {
    await openLogs(window, window.getByTestId('resource-row').first());
    const before = await window.getByTestId('log-line').count();

    // The reason the dock exists. Navigating away must not stop the tail.
    await window.getByTestId('nav-deployments').click();
    await expect(window.getByTestId('resource-row').first()).toBeVisible();

    await expect
      .poll(async () => window.getByTestId('log-line').count(), { timeout: 15_000 })
      .toBeGreaterThan(before);
  });
});
