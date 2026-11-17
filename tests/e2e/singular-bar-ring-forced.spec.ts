import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { keyboardFocus } from './focus-perimeter';
import { annotation, FORCED_CASES, fixtureIn, openForced } from './forced-backplate';
import { CONTENTS, darkStopGrounds, lendBar } from './singular-bar-lend';

// Singular under forced colours: the bar's Contents button rings when it is focused from the
// keyboard while the bar takes a dark panel's ground. The pager lends the bar the ground and the
// surface hook of the panel under it. Forced colours give every Singular ground the canvas, but the
// hook's focus colour is the one for the dark ground it expects (focus-inverse on an inverse
// ground, ButtonFace on an accent one), and forced colours map those to the canvas's own colour.
// Each dark ground the route has is brought under the bar in turn and the button judged by the
// focus check the quality cells use.

test.use({ appOptions: fixtureIn('singular') });

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
      const grounds = await darkStopGrounds(page);
      expect(grounds.length, 'the route has a dark ground').toBeGreaterThan(0);
      const read: string[] = [];
      for (const ground of grounds) {
        expect(await lendBar(page, ground), `the bar takes the ${ground} ground`).toBe(true);
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
