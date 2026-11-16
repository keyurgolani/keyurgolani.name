import { expect, test } from '../harness/fixtures';
import {
  annotation,
  FORCED_CASES,
  fixtureIn,
  judgeTexts,
  openForced,
  TEXT_RATIO,
} from './forced-backplate';

// Singular under forced colours: each rail stop's label, the chip that shows beside its dot on
// hover and focus, reads when its stop is focused from the keyboard, on the home page and a case
// study, in the light and dark palettes. At 1024 every stop is focused in turn and its label judged
// in pixels against the backplate the browser lays under it; a label in the Canvas colour reads 1:1.
// At 390 the strip stands in for the rail, which isn't shown, so no label is there to read.

test.use({ appOptions: fixtureIn('singular') });

for (const c of FORCED_CASES)
  test(
    `under forced colours in the ${c.palette} palette, on ${c.route} at ${c.width}, ${c.width < 600 ? 'the strip stands in for the rail' : "each rail stop's label reads when its stop is focused"}`,
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
      const stops = page.locator('.sg-rail__stop');
      const count = await stops.count();
      const shown = await stops.evaluateAll(
        (els) => els.filter((el) => el.getClientRects().length > 0).length,
      );
      if (c.width < 600) {
        expect(shown, 'no rail stop is shown on a phone').toBe(0);
        await expect(page.locator('.sg-strip')).toBeVisible();
        return;
      }
      expect(count, 'the rail has stops').toBeGreaterThan(0);
      expect(shown, 'every rail stop is shown').toBe(count);
      const read: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const stop = stops.nth(i);
        const mark = `rail-${i}`;
        await stop
          .locator('.sg-rail__label')
          .evaluate((el, m) => el.setAttribute('data-forced-text', m), mark);
        await stop.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        expect(
          await stop.evaluate((el) => el.matches(':focus-visible')),
          `stop ${i} is focused from the keyboard`,
        ).toBe(true);
        const [judged] = await judgeTexts(page, mark);
        const ratio = judged?.ratio ?? null;
        const words = judged?.words ?? `stop ${i}`;
        console.log(
          `rail label ${c.route} ${c.palette} ${c.width} ${i} "${words}": ${ratio === null ? `unjudged, ${judged?.unjudged}` : `${ratio.toFixed(2)}:1`}`,
        );
        read.push(
          ratio !== null && ratio >= TEXT_RATIO
            ? 'reads'
            : `"${words}" ${ratio === null ? `unjudged, ${judged?.unjudged}` : `${ratio.toFixed(2)}:1`}`,
        );
      }
      expect(read, `every label reads at ${TEXT_RATIO}:1 against its backplate`).toEqual(
        Array.from({ length: count }, () => 'reads'),
      );
    },
  );
