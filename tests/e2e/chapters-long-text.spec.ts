import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Chapters at length: on the long-text fixture (a 107-letter tagline, a 98-letter place name, a
// long URL and a long address, hyphenated names), no page of the book is wider than a phone or
// the narrowest phone. Round 3 found the home page 807 px wide at 390: the tagline in the
// imprint's one-column grid. A failure names the innermost elements that stick out, so it
// points at the culprit and not its ancestors. The app's options are per worker, so this
// fixture has its own file (chapters.spec.ts serves the sample).

const FIXTURE = contractFixture('long-text');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'chapters'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/** The innermost elements past the window's right edge, each with its width and right edge. */
function sticksOut() {
  const edge = document.documentElement.clientWidth + 1;
  const out = (el: Element) => el.getBoundingClientRect().right > edge;
  return [...document.querySelectorAll('body *')]
    .filter((el) => out(el) && ![...el.children].some(out))
    .slice(0, 8)
    .map((el) => {
      const box = el.getBoundingClientRect();
      const name = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`;
      return `${name} w${Math.round(box.width)} r${Math.round(box.right)}`;
    });
}

/** The book's own pages linked from home: each chapter, the back matter, any case study. */
const bookPages = (page: Page) =>
  page.evaluate(() => {
    const paths = new Set<string>();
    for (const a of document.querySelectorAll<HTMLAnchorElement>('.ch a[href]')) {
      const url = new URL(a.href);
      if (url.origin !== location.origin) continue;
      if (/^\/(chapters\/[^/]+|back-matter|work\/[^/]+)\/?$/.test(url.pathname)) {
        paths.add(url.pathname + url.search);
      }
    }
    return [...paths].sort();
  });

async function expectNoWiderThan(page: Page, width: number, where: string) {
  await expect(page.locator('[data-variant="chapters"]')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  const wide = await page.evaluate(sticksOut);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    `${where} is wider than the window: ${wide.join('; ')}`,
  ).toBeLessThanOrEqual(width);
}

for (const [width, height] of [
  [390, 844],
  [320, 640],
] as const) {
  test(
    `no page of the book scrolls sideways on the long-text fixture at ${width}`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      await expectNoWiderThan(page, width, 'home');
      const pages = await bookPages(page);
      expect(
        pages.some((p) => p.startsWith('/chapters/')),
        'home links a chapter',
      ).toBe(true);
      expect(
        pages.some((p) => p.startsWith('/back-matter')),
        'home links the back matter',
      ).toBe(true);
      for (const href of pages) {
        const response = await page.goto(href, { waitUntil: 'networkidle' });
        expect(response?.status(), href).toBe(200);
        await expectNoWiderThan(page, width, href);
      }
    },
  );
}
