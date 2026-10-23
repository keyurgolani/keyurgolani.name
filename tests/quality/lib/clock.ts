// The quality cells' clock (#11, Slice 1, item 7): Date reads
// 2026-01-01T00:00:00Z, #5's fixture env.now, in the app under test and in
// the page. The server starts under tests/harness/fixed-clock.mjs, preloaded
// into it alone, which starts there and runs on. The page gets
// page.clock.setFixedTime, which pins Date and leaves timers and
// requestAnimationFrame real; page.clock.install would fake those too, and
// the motion and performance checks measure them.

import type { Page } from '@playwright/test';

/** When the clocks read: fixed-clock.mjs's FIXED_TIME, which importing it would set here too. */
export const FIXED_TIME = '2026-01-01T00:00:00.000Z';

/** The server's clock preload, which only the app under test loads. */
export const FIXED_CLOCK_URL = new URL('../../harness/fixed-clock.mjs', import.meta.url).href;

/** The server's socket guard, beside the egress trap, which only the app under test loads. */
export const EGRESS_GUARD_URL = new URL('../../harness/egress-guard.mjs', import.meta.url).href;

/** NODE_OPTIONS for the app under test: the clock and the socket guard. */
export const APP_NODE_OPTIONS = `--import=${FIXED_CLOCK_URL} --import=${EGRESS_GUARD_URL}`;

/** Pins the page's Date to FIXED_TIME, keeping timers and frames real. */
export async function pinPageClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(FIXED_TIME));
}
