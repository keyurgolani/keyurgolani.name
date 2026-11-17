import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Horizontal Cinema: a reader below the strip, in the credits or at the page's foot, changes the
// text size, a step larger and back, as their own setting does. The page refits the strip, and
// the reader stays where they were: the credits still under the window's top, by about where
// they were, or the page still at its foot. At 1440, where the strip is pinned, and at 390, where
// it reads top to bottom. On the complete contract fixture.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const annotation = [{ type: 'route', description: '/' }];
const LINE = 120;

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 400))),
      ),
  );

const where = (page: Page) =>
  page.evaluate(() => {
    const credits = document.querySelector('.hc-credits')!.getBoundingClientRect();
    const html = document.documentElement;
    return {
      scrollY,
      top: credits.top,
      bottom: credits.bottom,
      atFoot: scrollY + innerHeight >= html.scrollHeight - 2,
    };
  });

const textSize = (page: Page, size: string | null) =>
  page.evaluate((to) => {
    const root = document.documentElement.style;
    if (to) root.setProperty('font-size', to, 'important');
    else root.removeProperty('font-size');
  }, size);

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(
    `at ${width}, a reader in the credits keeps their place through a text size and back`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      await page.evaluate((line) => {
        const credits = document.querySelector('.hc-credits')!;
        window.scrollTo(0, scrollY + credits.getBoundingClientRect().top - line);
      }, LINE);
      await settle(page);
      const before = await where(page);
      expect(before.top, 'the credits start at the reading line').toBeCloseTo(LINE, 0);
      for (const size of ['112.5%', null]) {
        await textSize(page, size);
        await settle(page);
        await settle(page);
        const after = await where(page);
        console.log(
          `credits at ${width}, text ${size ?? 'back'}: ${JSON.stringify({ before, after })}`,
        );
        expect(
          after.top <= LINE + 1 && after.bottom > LINE,
          `still in the credits with the text ${size ?? 'back at its own size'}: ${JSON.stringify(after)}`,
        ).toBe(true);
        expect(Math.abs(after.top - before.top), 'about where they were').toBeLessThanOrEqual(48);
      }
    },
  );

  test(
    `at ${width}, a reader at the page's foot stays at its foot through a text size and back`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await settle(page);
      expect((await where(page)).atFoot, 'at the foot').toBe(true);
      for (const size of ['112.5%', null]) {
        await textSize(page, size);
        await settle(page);
        await settle(page);
        const after = await where(page);
        console.log(`foot at ${width}, text ${size ?? 'back'}: ${JSON.stringify(after)}`);
        expect(
          after.atFoot,
          `still at the foot with the text ${size ?? 'back at its own size'}: ${JSON.stringify(after)}`,
        ).toBe(true);
      }
    },
  );
}
