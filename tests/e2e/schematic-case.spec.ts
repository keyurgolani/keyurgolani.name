import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Schematic's detail sheet in a browser (brief §5.4, step 8): home's first
// case-study port opens the work's own page, whose title is the one h1; the
// sheet's own index lands on each view; the drawing index's sheets go back
// home; the sheet's title block holds its bottom-right corner; and no width
// scrolls sideways. On the complete fixture, under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/work/[slug]' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'schematic'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/** The first work page home links to. */
async function firstCase(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  const href = await page.locator('a[href^="/work/"]').first().getAttribute('href');
  expect(href, 'home links a work page').toBeTruthy();
  return href!;
}

test(
  'a case-study port opens the detail sheet: one h1, its views land, the index points home',
  { annotation },
  async ({ page }) => {
    const href = await firstCase(page);
    await page.goto(href, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-sx-page="case"]')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
    const views = page.locator('nav.sx-dparts a');
    for (let i = 0; i < (await views.count()); i++) {
      const target = (await views.nth(i).getAttribute('href'))!;
      await views.nth(i).click();
      await expect(page).toHaveURL(new RegExp(`${target}$`));
      const top = await page.locator(target).evaluate((el) => el.getBoundingClientRect().top);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThan(await page.evaluate(() => innerHeight / 2));
    }
    // The footer's drawing index sends every sheet home.
    for (const link of await page.locator('.sx-foot__index .sx-index__head a').all()) {
      expect(await link.getAttribute('href')).toMatch(/^\/#/);
    }
    // The sheet's title block holds its bottom-right corner.
    const field = (await page.locator('.sx-sheet--detail .sx-field').boundingBox())!;
    const block = (await page.locator('.sx-sheet--detail .sx-tb[data-at="sheet"]').boundingBox())!;
    expect(field.x + field.width - (block.x + block.width)).toBeLessThan(48);
    expect(field.y + field.height - (block.y + block.height)).toBeLessThan(48);
  },
);

for (const [width, height] of [
  [320, 640],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const) {
  test(`the detail sheet at ${width}: no sideways scroll`, { annotation }, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const href = await firstCase(page);
    await page.goto(href, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
