import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { keyboardFocus } from './focus-perimeter';
import { annotation, FORCED_CASES, fixtureIn } from './forced-backplate';
import { CONTENTS, darkStopGrounds, lendBar } from './singular-bar-lend';

// Singular's Contents dialog sits inside the bar, so it inherits what the pager lends the bar: the
// dark ground's surface hook, whose focus colour is the one for that ground, not for the dialog's
// own surface. Opened from the keyboard over each dark ground the bar takes, with forced colours
// off and on, each of the dialog's first controls, reached by Tab, rings as the focus check the
// quality cells use reads it.

test.use({ appOptions: fixtureIn('singular') });

const STEPS = 6;

for (const row of ['default', 'forced-colors'] as const)
  for (const c of FORCED_CASES)
    test(
      `${row === 'default' ? 'with forced colours off' : 'under forced colours'} in the ${c.palette} palette, on ${c.route} at ${c.width}, the Contents dialog's controls ring over each dark ground the bar takes`,
      { annotation: annotation(c.route), tag: '@interaction' },
      async ({ page }) => {
        await page.setViewportSize({ width: c.width, height: c.width < 600 ? 844 : 768 });
        await page.emulateMedia({
          colorScheme: c.palette,
          forcedColors: row === 'forced-colors' ? 'active' : 'none',
          reducedMotion: 'reduce',
        });
        await page.goto(c.route, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready.then(() => true));
        await expect(page.locator('[data-variant]').first()).toHaveAttribute(
          'data-variant',
          'singular',
        );
        expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(
          row === 'forced-colors',
        );
        const grounds = await darkStopGrounds(page);
        expect(grounds.length, 'the route has a dark ground').toBeGreaterThan(0);
        let judged = 0;
        const weak: string[] = [];
        for (const ground of grounds) {
          expect(await lendBar(page, ground), `the bar takes the ${ground} ground`).toBe(true);
          await keyboardFocus(page, page.locator(CONTENTS));
          await page.keyboard.press('Enter');
          await expect(page.locator('dialog[open]')).toHaveCount(1);
          for (let step = 0; step < STEPS; step += 1) {
            if (step > 0) await page.keyboard.press('Tab');
            await page.evaluate(
              () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
            );
            const inDialog = await page.evaluate(
              () => !!document.activeElement?.closest('dialog[open]'),
            );
            if (!inDialog) continue;
            const active = await inPage<Active>(page, { kind: 'active' });
            const findings = await focusFindings(page, active);
            judged += 1;
            console.log(
              `dialog ring ${row} ${c.route} ${c.palette} ${c.width} over ${ground} step ${step}: ${active.path}, findings ${JSON.stringify(findings).slice(0, 400)}`,
            );
            if (findings.length) weak.push(`over ${ground}: ${active.path}`);
          }
          await page.keyboard.press('Escape');
          await expect(page.locator('dialog[open]')).toHaveCount(0);
        }
        expect(judged, "the dialog's controls judged").toBeGreaterThan(0);
        expect(weak, 'every control in the dialog rings over every dark ground').toEqual([]);
      },
    );
