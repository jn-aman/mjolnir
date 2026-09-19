import { expect, test } from './fixtures/app.ts';

/**
 * If these fail, nothing else is worth running: the app did not start, or it
 * started and could not reach its own cluster.
 */
test.describe('app shell', () => {
  test('launches and reaches the demo cluster', async ({ window }) => {
    await expect(window).toHaveTitle(/Mjolnir/);
    await expect(window.getByTestId('cluster-name').first()).toContainText('demo');
    await expect(window.getByTestId('connection-status').first()).toBeVisible();
  });

  test('renders the dashboard with counts rather than spinners', async ({ window }) => {
    const overview = window.getByTestId('overview');
    await expect(overview).toBeVisible();
    await expect(window.getByTestId('cluster-hero')).toBeVisible();
    // Numbers, not spinners and not "NaN": the failure this guards against is
    // a metrics parse returning NaN and being rendered as-is.
    await expect(window.getByTestId('hero-facts')).toContainText(/\d/);
    await expect(overview).not.toContainText('NaN');
    await expect(overview).not.toContainText('undefined');
  });

  test('survives a window reload without losing the cluster', async ({ window }) => {
    await window.reload();
    await expect(window.getByTestId('cluster-name').first()).toContainText('demo');
  });

  test('the sidebar offers the kinds and the tools', async ({ window }) => {
    await expect(window.getByTestId('sidebar')).toBeVisible();
    await expect(window.getByTestId('nav-pods')).toBeVisible();
    await expect(window.getByTestId('nav-tools')).toBeVisible();
  });
});
