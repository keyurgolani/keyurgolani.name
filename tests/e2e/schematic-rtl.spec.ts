import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { expect, test } from '../harness/fixtures';

// Schematic right to left (variants-10 brief §5.4, step 1: the block mirrors
// to bottom-left): the mixed-practice profession pair in Arabic, selecting
// Schematic. The cover's and every sheet's title block hold the bottom-left
// corner, the border is zoned on four edges, and nothing scrolls sideways.

const MIXED = fileURLToPath(
  new URL('../../packages/schema/src/__fixtures__/pairs/mixed/yaml/', import.meta.url),
);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: path.join(MIXED, 'portfolio.yml'),
    siteText: fixtureSiteSelecting(readFileSync(path.join(MIXED, 'site.yml'), 'utf8'), 'schematic'),
  },
});

test(
  'the title blocks hold the bottom-left corner, and the border is zoned on four edges (SC-M1)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'schematic');
    const corners = [
      ['.sx-sheet--cover .sx-field', '.sx-sheet--cover .sx-tb'],
      ...((await page.locator('.sx-set > .sx-sheet').count()) > 0
        ? [['.sx-set > .sx-sheet .sx-field', '.sx-set > .sx-sheet .sx-tb[data-at="sheet"]']]
        : []),
    ];
    for (const [fieldSel, blockSel] of corners) {
      const field = (await page.locator(fieldSel!).first().boundingBox())!;
      const block = (await page.locator(blockSel!).first().boundingBox())!;
      expect(block.x - field.x, blockSel).toBeLessThan(48);
      expect(field.y + field.height - (block.y + block.height), blockSel).toBeLessThan(48);
      expect(block.x + block.width, blockSel).toBeLessThan(field.x + (field.width * 2) / 3 + 1);
    }
    for (const edge of ['top', 'bottom', 'start', 'end']) {
      await expect(page.locator(`.sx-sheet--cover .sx-zones--${edge} li`).first()).toBeVisible();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  },
);

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test(
    'the phone bar names the sheet being read in the title’s own language',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const sheet = page.locator('.sx-set > .sx-sheet[data-sheet]').first();
      await sheet.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      const no = (await sheet.getAttribute('data-sheet'))!;
      const here = page.locator('.sx-phone a[data-sx-open] [data-sx-here]');
      await expect(here).toContainText(no);
      const langs = await sheet.evaluate((el) => {
        const heading = el.querySelector(
          '.sx-sheet__title span[lang], .sx-sheet__title span:last-child',
        )!;
        const bar = document.querySelector('.sx-phone a[data-sx-open] [data-sx-here] span');
        return {
          want: heading.closest('[lang]')?.getAttribute('lang') ?? null,
          got: bar?.getAttribute('lang') ?? null,
        };
      });
      expect(langs.want).not.toBeNull();
      expect(langs.got).toBe(langs.want);
    },
  );
});
