import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Chapters with an owner's controls set in site.yml, on the complete fixture under read-only:
// their own two chapters (K-3's periodList) at their own paths, the spine as the top bar on a
// wide screen too, and the folios off, so nothing prints a page number and the contents and
// index point by chapter. Its own file: the site's controls are app options, which a describe
// group can't change (they force a new worker).

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const SITE_TEXT = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'chapters');
const CONTROLS = `variantControls:
  chapters:
    version: 1
    values:
      spine: top
      folios: false
      chapters:
        - slug: before
          title: Before
          from: '2000'
        - slug: since
          title: Since
          from: 2020-01
          teaser: The years since.
`;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: `${SITE_TEXT.trimEnd()}\n${CONTROLS}`,
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/** Whether any page number shows: a folio, or a page column in the contents or a map. */
const shownPageNumbers = () =>
  [...document.querySelectorAll('.ch-folio, .toc__pg, .op-map__pg')].filter(
    (el) => getComputedStyle(el).display !== 'none',
  ).length;

test(
  "the owner's chapters are the book, at their own paths, with their teaser",
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.toc__t')).toHaveText(['Chapter 1: Before', 'Chapter 2: Since']);
    await expect(page.locator('.toc__teaser')).toHaveText('The years since.');
    const response = await page.goto('/chapters/since', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Chapter 2: Since');
    await expect(page.locator('.op-teaser')).toHaveText('The years since.');
  },
);

test(
  'the spine is the top bar on a wide screen and a phone, and no page number prints',
  { annotation },
  async ({ page }) => {
    for (const [width, height] of [
      [1440, 900],
      [1920, 1080],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const at of ['/', '/chapters/before', '/back-matter']) {
        await page.goto(at, { waitUntil: 'networkidle' });
        const where = `${at} at ${width}`;
        await expect(page.locator('.ch-edge'), where).toBeHidden();
        const bar = await page.locator('.ch-progress').boundingBox();
        const head = await page.locator('.ch-runhead').boundingBox();
        expect(bar, where).not.toBeNull();
        // Under the running head, and as wide as the book it marks, never the window at 1920.
        expect(Math.abs(bar!.y - head!.y - head!.height), where).toBeLessThanOrEqual(1);
        expect(Math.abs(bar!.x - head!.x), where).toBeLessThanOrEqual(1);
        expect(Math.abs(bar!.width - head!.width), where).toBeLessThanOrEqual(1);
        expect(await page.evaluate(shownPageNumbers), where).toBe(0);
      }
    }
    // The index points by chapter.
    await page.goto('/back-matter', { waitUntil: 'networkidle' });
    const labels = await page.locator('.ix__pg').allTextContents();
    expect(labels.length, 'the index has locators').toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).toMatch(/^(?:\d|B)$/);
    }
  },
);
