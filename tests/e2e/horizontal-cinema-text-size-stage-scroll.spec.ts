import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Horizontal Cinema at 1440, where the strip is pinned: a reader below it, in the full record or at
// the page's foot, sets the text a step larger and then back to its own size. Back at its size, the
// strip is shorter, and the browser moves it onto its new length in the layout, which it tells as a
// scroll of the strip. The text size's own refit comes after that layout, so the strip's scroll could
// land first, and the page was then led to the strip as if the reader had moved it: to the strip's
// end, 780 px up from the record, and the refit held that place. CI Linux saw it in about one run in
// thirteen. Here the strip's scroll lands first every time: the text size goes back and the strip's
// scroll is told in the same task, before the refit can run. The page stays where the reader was,
// the record at the reading line or the credits' head in the window, within 2 px. On the complete
// contract fixture.

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

const boxOf = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { top: r.top, scrollY };
  }, selector);

const CASES = [
  {
    where: 'in the full record',
    watched: '.hc-record',
    place: (page: Page) =>
      page.evaluate((line) => {
        const record = document.querySelector('.hc-record')!;
        window.scrollTo(0, scrollY + record.getBoundingClientRect().top - line);
      }, LINE),
  },
  {
    where: "at the page's foot",
    watched: '.hc-credits__head',
    place: (page: Page) =>
      page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)),
  },
] as const;

for (const { where, watched, place } of CASES)
  test(
    `at 1440, a reader ${where} keeps their place when the strip's scroll lands before the text size's refit`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      await place(page);
      await settle(page);
      const before = await boxOf(page, watched);
      await page.evaluate(() =>
        document.documentElement.style.setProperty('font-size', '112.5%', 'important'),
      );
      await settle(page);
      await settle(page);
      // Back to its own size, then the strip's scroll at the length the layout gives it, in one task.
      await page.evaluate(() => {
        document.documentElement.style.removeProperty('font-size');
        const stage = document.querySelector('.hc-stage')!;
        void stage.scrollLeft;
        stage.dispatchEvent(new Event('scroll'));
      });
      await settle(page);
      await settle(page);
      const after = await boxOf(page, watched);
      expect(
        {
          top: Math.abs(after.top - before.top) <= 2,
          scrollY: Math.abs(after.scrollY - before.scrollY) <= 2,
        },
        `where it was: ${JSON.stringify({ before, after })}`,
      ).toEqual({ top: true, scrollY: true });
    },
  );
