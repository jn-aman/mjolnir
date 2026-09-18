import { expect, test } from './fixtures/app.ts';

/**
 * The log viewer is the feature people use most and the one most likely to
 * wedge the UI, so it gets the most coverage. The demo cluster guarantees a
 * running pod, a multi-container pod and a CrashLoopBackOff pod.
 */
test.describe('log viewer', () => {
  test.beforeEach(async ({ window }) => {
    await window.getByTestId('nav-workloads').click();
    await window.getByTestId('nav-pods').click();
  });

  test('streams live logs and follows new lines', async ({ window }) => {
    await window.getByTestId('pod-row').first().click();
    await window.getByTestId('tab-logs').click();

    const viewer = window.getByTestId('log-viewer');
    await expect(viewer).toBeVisible();

    const first = await viewer.getByTestId('log-line').count();
    await expect(window.getByTestId('log-follow')).toHaveAttribute('data-active', 'true');
    // Following means the count grows on its own, with no interaction.
    await expect
      .poll(async () => viewer.getByTestId('log-line').count(), { timeout: 15_000 })
      .toBeGreaterThan(first);
  });

  test('pauses following when the user scrolls up, and resumes on demand', async ({ window }) => {
    await window.getByTestId('pod-row').first().click();
    await window.getByTestId('tab-logs').click();

    await window.getByTestId('log-viewer').hover();
    await window.mouse.wheel(0, -600);
    await expect(window.getByTestId('log-follow')).toHaveAttribute('data-active', 'false');

    await window.getByTestId('log-follow').click();
    await expect(window.getByTestId('log-follow')).toHaveAttribute('data-active', 'true');
  });

  test('filters with a regex and reports the match count', async ({ window }) => {
    await window.getByTestId('pod-row').first().click();
    await window.getByTestId('tab-logs').click();

    await window.getByTestId('log-regex-toggle').click();
    await window.getByTestId('log-search').fill('ERROR|WARN');
    await expect(window.getByTestId('log-match-count')).toHaveText(/\d+ \/ \d+/);
    await expect(window.getByTestId('log-line').first()).toContainText(/ERROR|WARN/);
  });

  test('shows the previous container logs for a crash-looping pod', async ({ window }) => {
    await window.getByTestId('pod-row').filter({ hasText: 'CrashLoopBackOff' }).first().click();
    await window.getByTestId('tab-logs').click();

    // The whole point: the current container has no logs, the dead one does.
    await window.getByTestId('log-previous').click();
    await expect(window.getByTestId('log-previous')).toHaveAttribute('data-active', 'true');
    await expect(window.getByTestId('log-line').first()).toBeVisible();
  });

  test('stays responsive with a large buffer', async ({ window }) => {
    await window.getByTestId('pod-row').first().click();
    await window.getByTestId('tab-logs').click();
    await window.getByTestId('log-tail').selectOption('10000');

    // Virtualization contract: the DOM holds a window of rows, not all of them.
    await expect
      .poll(async () => window.getByTestId('log-line').count(), { timeout: 15_000 })
      .toBeLessThan(500);

    const started = Date.now();
    await window.getByTestId('log-search').fill('a');
    await expect(window.getByTestId('log-match-count')).toBeVisible();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
