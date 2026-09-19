import { expect, test } from './fixtures/app.ts';

/**
 * Drift, which has two answers that must never be confused.
 *
 * "No differences" and "nothing to compare against" look identical as an
 * empty list and mean opposite things. Conflating them is how a drift page
 * quietly reassures somebody about an object it never checked.
 */

async function openDrift(window: import('@playwright/test').Page, name: string) {
  await window.getByTestId('nav-deployments').click();
  const row = window.getByTestId('resource-row').filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(window.getByTestId('resource-drawer')).toBeVisible();
  await window.getByRole('tab', { name: 'Drift' }).click();
}

test.describe('drift', () => {
  test('compares a Helm-managed workload against its chart', async ({ window }) => {
    await openDrift(window, 'grafana');
    await expect(window.getByTestId('drift-summary')).toBeVisible();
    // Named, so it is obvious which of the sources answered.
    await expect(window.getByTestId('drift-panel')).toContainText('chart');
  });

  test('compares a kubectl-applied workload against what was applied', async ({ window }) => {
    await openDrift(window, 'web');
    await expect(window.getByTestId('drift-summary')).toBeVisible();
    await expect(window.getByTestId('drift-panel')).toContainText('the last kubectl apply');

    const changes = window.getByTestId('drift-changes');
    await expect(changes).toBeVisible();
    await expect(changes).toContainText('spec.replicas');
    // The consequence people miss: the next apply takes it back.
    await expect(window.getByTestId('drift-panel')).toContainText('goes back');
  });

  test('says nothing to compare against rather than showing no differences', async ({ window }) => {
    await openDrift(window, 'ledger');
    const unavailable = window.getByTestId('drift-unavailable');
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toContainText('Nothing to compare against');
  });

  test('is not offered on a pod, whose desired state belongs to something else', async ({ window }) => {
    await window.getByTestId('nav-pods').click();
    await window.getByTestId('resource-row').first().click();
    await expect(window.getByTestId('resource-drawer')).toBeVisible();
    await expect(window.getByRole('tab', { name: 'Drift' })).toHaveCount(0);
  });
});
