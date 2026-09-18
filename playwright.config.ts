import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the packaged Electron app, not a browser.
 *
 * Every spec runs against Mjolnir's built-in demo cluster, which is synthetic and
 * deterministic, no kubeconfig, no network, no flake from a real cluster
 * rescheduling a pod mid-assertion. That is the whole reason demo mode is
 * worth keeping: it is the only way to assert on a CrashLoopBackOff pod at a
 * known moment in time.
 */
export default defineConfig({
  testDir: './e2e',
  // Electron launches one app instance per worker; parallel workers fight over
  // the app's single-instance lock and the demo server port.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
