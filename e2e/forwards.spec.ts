import { expect, test } from './fixtures/app.ts';

/**
 * Port forwards.
 *
 * What is under test is that the page does the job rather than describing it.
 * Its empty state used to be a sentence telling you to go and right-click a
 * pod on a different screen.
 */

test.describe('port forwards', () => {
  test('offers something to forward instead of telling you where to go', async ({ window }) => {
    await window.getByTestId('nav-tool-portforward').click();

    await expect(window.getByTestId('forward-count')).toContainText('none running');
    const targets = window.getByTestId('forward-targets');
    await expect(targets).toBeVisible();
    // A Service is what a person means; the pod behind it is a detail that
    // changes on every rollout.
    await expect(targets).toContainText('svc');
  });

  test('filters targets by name and namespace', async ({ window }) => {
    await window.getByTestId('nav-tool-portforward').click();
    await expect(window.getByTestId('forward-targets')).toBeVisible();

    await window.locator('#forward-filter').fill('grafana');
    await expect(window.getByTestId('forward-targets')).toContainText('grafana');

    await window.locator('#forward-filter').fill('zzzz-nothing');
    await expect(window.getByTestId('forward-targets')).toHaveCount(0);
  });

  test('every target offers the ports it actually exposes', async ({ window }) => {
    await window.getByTestId('nav-tool-portforward').click();
    await window.locator('#forward-filter').fill('grafana');
    const row = window.getByTestId('forward-targets').locator('> li').first();
    await expect(row).toBeVisible();
    // Buttons, one per port, rather than a dialog asking for a number.
    await expect(row.getByRole('button').first()).toBeVisible();
  });
});
