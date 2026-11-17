import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Horizontal Cinema on a phone with the root text at 200% keeps its pages inside the window. A work
// page's scene map, its row of scene blocks with the scene's name and place beside them, kept that
// name and place on one line however large the text: at 320 and at 390 wide the map ran 400 to 434
// px wide, and the whole storyboard with it, so the page scrolled sideways. On the home, a word of
// the credits' tagline too long for its line at that size widened the credits to 335 px at 320. On
// the academic contract fixture, as a phone (touch, mobile), each page's scroll width stays within
// the window; and at 100% the map keeps its one row.

const FIXTURE = contractFixture('academic');
const DIR = path.dirname(FIXTURE.files.portfolio);
const WORK = '/work/canopy-drought-memory';

test.use({
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Loads `route`, sets the root text to `size`, and lets the layout settle. */
async function open(page: Page, route: string, size: string) {
  await page.goto(route, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    (value) => document.documentElement.style.setProperty('font-size', value, 'important'),
    size,
  );
  await frames(page);
  await page.waitForTimeout(250);
  await frames(page);
}

/** The page's scroll width against the window, and what reaches furthest past it. */
const reach = (page: Page) =>
  page.evaluate(() => {
    const html = document.documentElement;
    let furthest: { at: string; right: number } | null = null;
    for (const element of document.body.querySelectorAll('*')) {
      const right = element.getBoundingClientRect().right;
      if (right > html.clientWidth + 1 && (!furthest || right > furthest.right)) {
        const name = `${element.localName}${element.id ? `#${element.id}` : ''}${[
          ...element.classList,
        ]
          .slice(0, 2)
          .map((c) => `.${c}`)
          .join('')}`;
        furthest = { at: name, right: Math.round(right) };
      }
    }
    return { scroll: html.scrollWidth, window: html.clientWidth, furthest };
  });

for (const { width, height, pages } of [
  { width: 320, height: 568, pages: [WORK, '/'] },
  { width: 390, height: 844, pages: [WORK] },
]) {
  test.describe(`${width} by ${height}`, () => {
    test.use({ viewport: { width, height } });
    for (const route of pages) {
      const kind = route === '/' ? 'the home' : 'a work page';
      test(`${kind} at ${width} with the root text at 200% stays inside the window`, async ({
        page,
      }) => {
        await open(page, route, '200%');
        const read = await reach(page);
        expect(read.scroll, JSON.stringify(read)).toBeLessThanOrEqual(read.window);
      });
    }
  });
}

test.describe('320 by 568 at 100%', () => {
  test.use({ viewport: { width: 320, height: 568 } });
  test("a work page's scene map keeps its blocks and its scene's name on one row", async ({
    page,
  }) => {
    await open(page, WORK, '100%');
    const map = page.locator('.hc-board__map');
    await expect(map).toHaveCount(1);
    const row = await map.evaluate((nav) => {
      const list = nav.querySelector('ol')!.getBoundingClientRect();
      const label = nav.querySelector('.hc-board__where')!;
      const where = label.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(label);
      const tops = new Set(
        [...range.getClientRects()]
          .filter((box) => box.width > 0)
          .map((box) => Math.round(box.top)),
      );
      return { same: where.top < list.bottom && where.bottom > list.top, lines: tops.size };
    });
    expect(row).toEqual({ same: true, lines: 1 });
  });
});
