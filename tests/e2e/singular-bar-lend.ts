import type { Page } from '@playwright/test';

// Singular's bar takes the ground of the stop under it: the pager lends the bar (and the strip) a
// stop's data-ground and its surface hook as the stop crosses the bar's line. These bring each
// ground under the bar for a test, and name its Contents button.

/** The bar's Contents button: the action that opens the Contents dialog. */
export const CONTENTS = ".sg-bar__nav [data-ui-slot='action'][aria-haspopup='dialog']";

/** The dark grounds (inverse, accent) of the stops the pager lends the bar from, in page order. */
export async function darkStopGrounds(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('[data-sg-stop][data-ground]')]
        .map((el) => el.getAttribute('data-ground'))
        .filter((g): g is string => g === 'inverse' || g === 'accent'),
    ),
  ]);
}

/** Brings a stop of `ground` under the bar until the pager lends the bar that ground: false if none does. */
export async function lendBar(page: Page, ground: string): Promise<boolean> {
  const count = await page.locator(`[data-sg-stop][data-ground='${ground}']`).count();
  for (let i = 0; i < count; i += 1)
    for (const block of ['start', 'center'] as const) {
      await page.evaluate(
        ([g, n, b]) =>
          document
            .querySelectorAll(`[data-sg-stop][data-ground='${g}']`)
            [n]?.scrollIntoView({ block: b }),
        [ground, i, block] as const,
      );
      const lent = await page
        .waitForFunction(
          (g) => document.querySelector('.sg-bar')?.getAttribute('data-ground') === g,
          ground,
          { timeout: 3000 },
        )
        .then(() => true)
        .catch(() => false);
      if (lent) return true;
    }
  return false;
}
