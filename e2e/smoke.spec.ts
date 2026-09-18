import { expect, test } from './fixtures/app.ts';

/**
 * If these fail, nothing else is worth running — the app did not start, or it
 * started and could not reach its own cluster.
 */
test.describe('app shell', () => {
  test('launches and reaches the demo cluster', async ({ window }) => {
    await expect(window).toHaveTitle(/Odin/);
    await expect(window.getByTestId('cluster-name')).toContainText('demo');
    await expect(window.getByTestId('connection-status')).toHaveAttribute('data-state', 'connected');
  });

  test('renders the dashboard with live node and pod counts', async ({ window }) => {
    const nodes = window.getByTestId('stat-nodes');
    await expect(nodes).toBeVisible();
    // A count, not a spinner and not "NaN" — the failure mode this asserts
    // against is a metrics parse returning NaN and rendering as-is.
    await expect(nodes).toHaveText(/^\d+/);
    await expect(window.getByTestId('stat-pods')).toHaveText(/^\d+/);
  });

  test('survives a window reload without losing the cluster connection', async ({ window }) => {
    await window.reload();
    await expect(window.getByTestId('connection-status')).toHaveAttribute('data-state', 'connected');
  });
});
