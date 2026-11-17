import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { keyboardFocus } from './focus-perimeter';
import { annotation, FORCED_CASES, fixtureIn, openForced } from './forced-backplate';

// Singular under forced colours: the bar's Contents button rings when it is focused from the
// keyboard while the bar takes a dark panel's ground. The pager lends the bar the ground and the
// surface hook of the panel under it. Forced colours give every Singular ground the canvas, but the
// hook's focus colour is the one for the dark ground it expects (focus-inverse on an inverse
// ground, ButtonFace on an accent one), and forced colours map those to the canvas's own colour.
// Each dark ground the route has is brought under the bar in turn and the button judged by the
// focus check the quality cells use.

test.use({ appOptions: fixtureIn('singular') });

const CONTENTS = ".sg-bar__nav [data-ui-slot='action'][aria-haspopup='dialog']";

/** Brings a stop of `ground` under the bar until the pager lends the bar that ground. */
async function lend(page: Page, ground: string): Promise<boolean> {
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

for (const c of FORCED_CASES)
  test(
    `under forced colours in the ${c.palette} palette, on ${c.route} at ${c.width}, the bar's Contents button rings on each dark ground the bar takes`,
    { annotation: annotation(c.route), tag: '@interaction' },
    async ({ page }) => {
      await openForced(page, c);
      await expect(page.locator('[data-variant]').first()).toHaveAttribute(
        'data-variant',
        'singular',
      );
      expect(
        await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
        'forced colours are on',
      ).toBe(true);
      // The dark grounds of the stops the pager lends the bar from, in page order.
      const grounds = await page.evaluate(() => [
        ...new Set(
          [...document.querySelectorAll('[data-sg-stop][data-ground]')]
            .map((el) => el.getAttribute('data-ground'))
            .filter((g): g is string => g === 'inverse' || g === 'accent'),
        ),
      ]);
      expect(grounds.length, 'the route has a dark ground').toBeGreaterThan(0);
      const read: string[] = [];
      for (const ground of grounds) {
        expect(await lend(page, ground), `the bar takes the ${ground} ground`).toBe(true);
        const active = await keyboardFocus(page, page.locator(CONTENTS));
        const findings = await focusFindings(page, active);
        console.log(
          `bar ring ${c.route} ${c.palette} ${c.width} on ${ground}: surface ${await page.locator('.sg-bar').getAttribute('data-ui-surface')}, findings ${JSON.stringify(findings).slice(0, 600)}`,
        );
        read.push(findings.length ? `on ${ground}: ${findings.length} finding(s)` : 'rings');
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      }
      expect(read, 'the Contents button rings on every dark ground the bar takes').toEqual(
        grounds.map(() => 'rings'),
      );
    },
  );
