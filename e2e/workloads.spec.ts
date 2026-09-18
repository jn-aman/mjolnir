import { expect, test } from './fixtures/app.ts';

test.describe('workloads', () => {
  test('lists pods and drills into one', async ({ window }) => {
    await window.getByTestId('nav-workloads').click();
    await window.getByTestId('nav-pods').click();

    await expect(window.getByTestId('pod-row').first()).toBeVisible();
    await window.getByTestId('pod-row').first().click();
    await expect(window.getByTestId('resource-detail')).toBeVisible();
    await expect(window.getByTestId('resource-kind')).toHaveText('Pod');
  });

  test('renders a pending pod without breaking the list', async ({ window }) => {
    await window.getByTestId('nav-workloads').click();
    await window.getByTestId('nav-pods').click();

    const pending = window.getByTestId('pod-row').filter({ hasText: 'Pending' }).first();
    await expect(pending).toBeVisible();
    // A pod with no node and no metrics must render a dash, never NaN or blank.
    await expect(pending.getByTestId('pod-cpu')).toHaveText(/-|\d/);
  });

  test('command palette jumps to a resource', async ({ window }) => {
    await window.keyboard.press('Meta+K');
    await expect(window.getByTestId('command-palette')).toBeVisible();
    await window.getByTestId('command-input').fill('nodes');
    await window.keyboard.press('Enter');
    await expect(window.getByTestId('resource-list')).toBeVisible();
  });

  test('YAML view opens and is editable', async ({ window }) => {
    await window.getByTestId('nav-workloads').click();
    await window.getByTestId('nav-pods').click();
    await window.getByTestId('pod-row').first().click();
    await window.getByTestId('tab-yaml').click();

    await expect(window.getByTestId('yaml-editor')).toBeVisible();
    await expect(window.getByTestId('yaml-editor')).toContainText('apiVersion');
  });
});
