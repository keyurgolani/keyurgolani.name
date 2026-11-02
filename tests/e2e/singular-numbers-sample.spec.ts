import { expect, test } from '../harness/fixtures';
import { SAMPLE_APP } from '../variants/target';
import { figureRowFits } from './singular-numbers';

// Panel 3 on the sample as the demo serves it, at 390 and 320, in Singular's own recipe and the
// default one (C's P1 on a26fbc420; the fixture copy's long unit is singular-numbers.spec.ts): no
// word of a statement, its description or its unit sits on two lines, the statement keeps at least
// 40% of the row, nothing runs past it, and each short figure stays beside its statement.

const annotation = [
  { type: 'route', description: '/sample?variant=singular' },
  { type: 'profile', description: 'demo' },
];

test.use({ appOptions: SAMPLE_APP });

const LOOKS = {
  own: 'language=platform-neutral&scheme=ultramarine-ink&type=swiss-grotesque',
  default: 'language=platform-neutral&scheme=warm-parchment&type=humanist-ui',
};

for (const width of [390, 320]) {
  test(
    `at ${width} the sample's figures keep their words whole`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
      for (const [name, look] of Object.entries(LOOKS)) {
        await page.goto(`/sample?variant=singular&${look}&mode=light`, {
          waitUntil: 'networkidle',
        });
        const list = page.locator('[data-sg-panel="numbers"] .sg-nums__list');
        await expect(list, name).toHaveCount(1);
        const fits = await list.evaluate(figureRowFits);
        expect(fits.length, name).toBeGreaterThanOrEqual(2);
        for (const fit of fits) {
          expect(fit.split, `${name}: ${fit.statement}`).toEqual([]);
          expect(fit.share, `${name}: ${fit.statement}`).toBeGreaterThanOrEqual(0.4);
          expect(fit.overflow, `${name}: ${fit.statement}`).toBeLessThanOrEqual(1);
          // The sample's figures are short: each stays beside its statement, a ledger to the end.
          expect(fit.beside, `${name}: ${fit.statement}`).toBe(true);
        }
      }
    },
  );
}
