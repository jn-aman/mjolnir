import { test as base, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type MjolnirFixtures = {
  app: ElectronApplication;
  window: Page;
};

/**
 * The shell's environment, minus the parts that stop Electron being Electron.
 *
 * `ELECTRON_RUN_AS_NODE` turns the binary into a plain Node interpreter, which
 * then rejects `--remote-debugging-port` and takes the whole suite with it.
 * Anybody who has ever debugged an Electron app has that variable exported,
 * and inheriting it produced seven failures whose message was "bad option".
 * The run must not depend on whose shell it started in.
 */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'ELECTRON_NO_ATTACH_CONSOLE') continue;
    env[key] = value;
  }
  return env;
}

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
      env: { ...cleanEnv(), MJOLNIR_DEMO: '1', MJOLNIR_E2E: '1', NODE_ENV: 'test' },
    });
    await use(app);
    await app.close();
  },
  window: async ({ app }, use) => {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    /*
     * Ask the app to stop moving.
     *
     * Playwright will not click an element it can see moving, and a menu that
     * springs into place is moving for a few hundred milliseconds. Waiting it
     * out is a race that passes on a fast machine and fails on a loaded one,
     * which is the worst kind of test. The app already honours this media
     * query for the people who set it, so the suite asks for the same thing
     * rather than inventing a test-only switch.
     */
    await window.emulateMedia({ reducedMotion: 'reduce' });
    await use(window);
  },
});

export { expect } from '@playwright/test';
