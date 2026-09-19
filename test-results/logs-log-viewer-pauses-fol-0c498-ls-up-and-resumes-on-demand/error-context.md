# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: logs.spec.ts >> log viewer >> pauses following when the reader scrolls up, and resumes on demand
- Location: e2e/logs.spec.ts:39:3

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByTestId('log-follow')
Expected: "false"
Received: "true"
Timeout:  10000ms

Call log:
  - Expect "toHaveAttribute" getByTestId('log-follow') with timeout 10000ms
  - waiting for getByTestId('log-follow')
    24 × locator resolved to <button type="button" data-active="true" data-testid="log-follow" class="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium disabled:opacity-40 border-[var(--status-ok-border)] bg-ok-bg text-ok">…</button>
       - unexpected value "true"

```

```yaml
- button "Following"
```

# Test source

```ts
  1  | import { expect, test } from './fixtures/app.ts';
  2  | 
  3  | /**
  4  |  * The log viewer is the feature people use most and the one most likely to
  5  |  * wedge the UI, so it gets the most coverage. The demo cluster guarantees a
  6  |  * running pod, a multi-container pod and a CrashLoopBackOff pod.
  7  |  *
  8  |  * Logs open in the dock, not in a panel that closes when you look at the next
  9  |  * pod. That was the point of the dock and it is what these drive.
  10 |  */
  11 | 
  12 | /** Opens the nth pod's logs in the dock, the way the row menu does. */
  13 | async function openLogs(window: import('@playwright/test').Page, row: import('@playwright/test').Locator) {
  14 |   await expect(row).toBeVisible();
  15 |   await row.click({ button: 'right' });
  16 |   await window.getByTestId('menu-logs').last().click();
  17 |   await expect(window.getByTestId('menu-logs')).toHaveCount(0);
  18 |   await expect(window.getByTestId('log-viewer')).toBeVisible();
  19 | }
  20 | 
  21 | test.describe('log viewer', () => {
  22 |   test.beforeEach(async ({ window }) => {
  23 |     await window.getByTestId('nav-pods').click();
  24 |     await expect(window.getByTestId('resource-row').first()).toBeVisible();
  25 |   });
  26 | 
  27 |   test('streams live logs and follows new lines', async ({ window }) => {
  28 |     await openLogs(window, window.getByTestId('resource-row').first());
  29 | 
  30 |     const viewer = window.getByTestId('log-viewer');
  31 |     const first = await viewer.getByTestId('log-line').count();
  32 |     await expect(window.getByTestId('log-follow')).toHaveAttribute('data-active', 'true');
  33 |     // Following means the count grows on its own, with no interaction.
  34 |     await expect
  35 |       .poll(async () => viewer.getByTestId('log-line').count(), { timeout: 15_000 })
  36 |       .toBeGreaterThan(first);
  37 |   });
  38 | 
  39 |   test('pauses following when the reader scrolls up, and resumes on demand', async ({ window }) => {
  40 |     await openLogs(window, window.getByTestId('resource-row').first());
  41 | 
  42 |     await window.getByTestId('log-body').hover();
  43 |     await window.mouse.wheel(0, -600);
  44 |     // Scrolling away is how a person says "stop moving"; nothing else should
  45 |     // have to be clicked for the lines to hold still.
> 46 |     await expect(window.getByTestId('log-follow')).toHaveAttribute('data-active', 'false');
     |                                                    ^ Error: expect(locator).toHaveAttribute(expected) failed
  47 | 
  48 |     await window.getByTestId('log-follow').click();
  49 |     await expect(window.getByTestId('log-follow')).toHaveAttribute('data-active', 'true');
  50 |   });
  51 | 
  52 |   test('filters and reports how many lines matched', async ({ window }) => {
  53 |     await openLogs(window, window.getByTestId('resource-row').first());
  54 | 
  55 |     await window.getByTestId('log-search').fill('e');
  56 |     // A count, so an empty result is obviously an empty result rather than a
  57 |     // viewer that failed to render.
  58 |     await expect(window.getByTestId('log-match-count')).toBeVisible();
  59 |   });
  60 | 
  61 |   test('offers the previous container for a pod that keeps crashing', async ({ window }) => {
  62 |     const crashing = window.getByTestId('resource-row').filter({ hasText: 'CrashLoop' }).first();
  63 |     await openLogs(window, crashing);
  64 | 
  65 |     // The whole point: the current container has not started, so its logs are
  66 |     // empty, and the answer is in the run that already failed.
  67 |     const group = window.getByTestId('log-previous-group');
  68 |     await expect(group).toBeVisible();
  69 |     await group.getByText('Previous').click();
  70 |     await expect(window.getByTestId('log-viewer')).toContainText(/previous/i);
  71 |   });
  72 | 
  73 |   test('keeps the DOM small however many lines arrive', async ({ window }) => {
  74 |     await openLogs(window, window.getByTestId('resource-row').first());
  75 | 
  76 |     // Virtualisation contract: the DOM holds a window of rows, not all of
  77 |     // them, or a busy pod takes the window down with it.
  78 |     await expect
  79 |       .poll(async () => window.getByTestId('log-line').count(), { timeout: 15_000 })
  80 |       .toBeLessThan(500);
  81 |   });
  82 | 
  83 |   test('a log keeps streaming while you go and look at something else', async ({ window }) => {
  84 |     await openLogs(window, window.getByTestId('resource-row').first());
  85 |     const before = await window.getByTestId('log-line').count();
  86 | 
  87 |     // The reason the dock exists. Navigating away must not stop the tail.
  88 |     await window.getByTestId('nav-deployments').click();
  89 |     await expect(window.getByTestId('resource-row').first()).toBeVisible();
  90 | 
  91 |     await expect
  92 |       .poll(async () => window.getByTestId('log-line').count(), { timeout: 15_000 })
  93 |       .toBeGreaterThan(before);
  94 |   });
  95 | });
  96 | 
```