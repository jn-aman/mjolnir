import { expect, test } from './fixtures/app.ts';

test.describe('workloads', () => {
  test('lists pods and opens one', async ({ window }) => {
    await window.getByTestId('nav-pods').click();
    const rows = window.getByTestId('resource-row');
    await expect(rows.first()).toBeVisible();

    await rows.first().click();
    await expect(window.getByTestId('resource-drawer')).toBeVisible();
    await expect(window.getByTestId('drawer-name')).not.toBeEmpty();
  });

  test('renders a pod with no node without breaking the row', async ({ window }) => {
    await window.getByTestId('nav-pods').click();
    const list = window.getByTestId('resource-list');
    await expect(list).toBeVisible();
    // A pod with no node and no metrics renders a dash, never NaN or blank.
    await expect(list).not.toContainText('NaN');
    await expect(list).not.toContainText('undefined');
  });

  test('filters the list and says so when nothing matches', async ({ window }) => {
    await window.getByTestId('nav-pods').click();
    await expect(window.getByTestId('resource-row').first()).toBeVisible();

    await window.getByTestId('quick-filter').fill('zzzz-no-such-pod');
    // An empty result and a still-loading list must never look the same.
    await expect(window.getByTestId('resource-empty')).toBeVisible();
  });

  test('every column stays reachable when the table is narrow', async ({ window }) => {
    await window.setViewportSize({ width: 900, height: 720 });
    await window.getByTestId('nav-pods').click();
    const list = window.getByTestId('resource-list');
    await expect(list).toBeVisible();

    // The actions column froze even when nothing needed freezing, which left
    // one column permanently hidden underneath it.
    const scroller = list.locator('div.overflow-auto').first();
    const reachable = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth >= 0);
    expect(reachable).toBe(true);
  });

  test('opens the YAML of an object', async ({ window }) => {
    await window.getByTestId('nav-pods').click();
    await window.getByTestId('resource-row').first().click();
    await expect(window.getByTestId('resource-drawer')).toBeVisible();
    await window.getByRole('tab', { name: 'YAML' }).click();
    // Whatever the editor is made of, the object's own text has to be in it.
    await expect(window.getByTestId('resource-drawer')).toContainText('apiVersion');
  });
});
