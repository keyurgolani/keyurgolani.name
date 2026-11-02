import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { figureRowFits } from './singular-numbers';

// Panel 3 on a phone never squeezes its words (C's P1 on a26fbc420: at 390 "1,200 Stat unit" took
// the row, the statement wrapped to about 80 px and "description" broke mid-word). At 390 and 320
// no word of a statement, its description or its unit sits on two lines, the statement keeps at
// least 40% of the row, and nothing runs past it. On a copy of the complete fixture whose Stats
// section has two figures (the fixture's second has no value, and panel 3 needs two), chosen by
// numbersSection, under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const SITE_TEXT = `${fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular')}
variantControls:
  singular:
    version: 1
    values:
      numbersSection: stats
`;
const TWO = '    statement: 10B+ Stat label two\n';
const PORTFOLIO_TEXT = readFileSync(FIXTURE.files.portfolio, 'utf8').replace(
  TWO,
  `${TWO}    metric: { key: stat-two, value: 10 }\n`,
);
if (!PORTFOLIO_TEXT.includes('key: stat-two'))
  throw new Error('the fixture copy has no second figure');
const APP = {
  portfolio: FIXTURE.files.portfolio,
  siteText: SITE_TEXT,
  sourceFiles: {
    ...Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
    'portfolio.yml': PORTFOLIO_TEXT,
  },
};

test.use({ appOptions: APP });

for (const width of [390, 320]) {
  test(
    `at ${width} a long unit never squeezes panel 3's words`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const list = page.locator('[data-sg-panel="numbers"] .sg-nums__list');
      await expect(list).toHaveCount(1);
      await expect(list.locator('.sg-nums__unit')).toHaveText(['Stat unit']);
      const fits = await list.evaluate(figureRowFits);
      expect(fits.map((fit) => fit.statement)).toEqual([
        'Stat label Stat description',
        '10B+ Stat label two',
      ]);
      for (const fit of fits) {
        expect(fit.split, fit.statement).toEqual([]);
        expect(fit.share, fit.statement).toBeGreaterThanOrEqual(0.4);
        expect(fit.overflow, fit.statement).toBeLessThanOrEqual(1);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    },
  );
}
