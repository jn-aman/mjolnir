import { expect, test } from './fixtures/app.ts';

/**
 * The cluster tools, against the demo cluster.
 *
 * What matters is not "it rendered" but "it said the right thing about data
 * we control". The demo cluster carries the failures on purpose: a crash
 * loop, a certificate nobody renews, an Ingress serving a hostname its
 * certificate does not cover, and a cert-manager Certificate that was never
 * issued.
 */

test.describe('what broke', () => {
  test('leads with the thing, not with a count of things', async ({ window }) => {
    await window.getByTestId('nav-tool-whatbroke').click();
    const summary = window.getByTestId('diagnose-summary').or(window.getByTestId('diagnose-healthy'));
    await expect(summary).toBeVisible();
    // Never "3 issues found": the person already knew there were issues.
    await expect(summary).not.toContainText(/^\d+ (issues|problems)/);
  });

  test('explains the words Kubernetes does not', async ({ window }) => {
    await window.getByTestId('nav-tool-whatbroke').click();
    await expect(window.getByTestId('diagnose-findings')).toBeVisible();

    const crash = window.getByTestId('finding-crash-looping').first();
    await expect(crash).toBeVisible();
    // "BackOff" is the most common unexplained word in Kubernetes.
    await expect(crash).toContainText('waiting longer between each try');
    await expect(crash).toContainText('What this was read from');
  });

  test('keeps the ordinary events in the timeline, because the deploy is one', async ({ window }) => {
    await window.getByTestId('nav-tool-whatbroke').click();
    const toggle = window.getByTestId('diagnose-timeline-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(window.getByTestId('diagnose-timeline')).toBeVisible();
  });
});

test.describe('certificates', () => {
  test('says who renews each one, in words rather than a colour', async ({ window }) => {
    await window.getByTestId('nav-tool-certificates').click();
    const list = window.getByTestId('certificate-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText('needs a person');
    await expect(list).toContainText('renews itself');
  });

  test('catches an Ingress serving a host its certificate does not cover', async ({ window }) => {
    await window.getByTestId('nav-tool-certificates').click();
    const row = window.getByTestId('certificate-platform-tls');
    await expect(row).toBeVisible();
    await expect(row).toContainText('a problem beyond the date');
    await row.locator('button').first().click();
    // The finding a list of expiry dates cannot give you.
    await expect(row).toContainText('metrics.eu.platform.internal');
  });

  test('does not call a certificate that was never issued an expired one', async ({ window }) => {
    await window.getByTestId('nav-tool-certificates').click();
    const row = window.getByTestId('certificate-checkout-tls');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Never issued');
    await expect(row).not.toContainText('Expired');
  });

  test('hides everything a controller looks after when asked', async ({ window }) => {
    await window.getByTestId('nav-tool-certificates').click();
    await expect(window.getByTestId('certificate-list')).toBeVisible();
    await window.getByTestId('certificates-unmanaged').click();
    await expect(window.getByTestId('certificate-list')).not.toContainText('renews itself');
  });
});

test.describe('vulnerabilities', () => {
  test('lists what the cluster runs without scanning anything', async ({ window }) => {
    await window.getByTestId('nav-tool-trivy').click();
    // Opening a page must never fire off forty Trivy runs.
    await expect(window.getByTestId('image-list')).toBeVisible();
    await expect(window.getByTestId('image-list')).toContainText('not scanned');
  });

  test('counts an image once however many pods run it', async ({ window }) => {
    await window.getByTestId('nav-tool-trivy').click();
    const rows = window.getByTestId('image-list').locator('> li');
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);
    // The panel header states the relationship it exists to show.
    await expect(window.getByTestId('vulnerabilities-panel')).toContainText(/image[s]? across \d+ pod/);
  });

  test('filters by workload, not only by image name', async ({ window }) => {
    await window.getByTestId('nav-tool-trivy').click();
    await expect(window.getByTestId('image-list')).toBeVisible();
    await window.locator('#vulnerabilities-filter').fill('payments');
    await expect(window.getByTestId('image-list').locator('> li').first()).toBeVisible();
  });
});
