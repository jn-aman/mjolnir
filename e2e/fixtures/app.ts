import { test as base, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type MjolnirFixtures = {
  app: ElectronApplication;
  window: Page;
};

/**
 * Launches Mjolnir in demo mode and hands the spec the first window.
 *
 * MJOLNIR_DEMO forces the synthetic cluster and MJOLNIR_E2E suppresses the auto-update
 * check and the first-run window, both of which otherwise steal focus and make
 * the first assertion in a spec race the UI.
 */
export const test = base.extend<MjolnirFixtures>({
  app: async ({}, use) => {
    const app = await electron.launch({
      args: [path.join(repoRoot, 'apps/desktop/dist/main.js')],
      env: { ...process.env, MJOLNIR_DEMO: '1', MJOLNIR_E2E: '1', NODE_ENV: 'test' },
    });
    await use(app);
    await app.close();
  },
  window: async ({ app }, use) => {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

export { expect } from '@playwright/test';
