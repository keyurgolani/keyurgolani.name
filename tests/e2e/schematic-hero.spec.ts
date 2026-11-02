import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// The hero's own title names the cover sheet in the cover's title block
// (network-off's complete check, through Schematic). With a long title
// (about 60 characters) it holds one line in the cell between "Cover sheet"
// and Index, so the title block's top row keeps the height a short one gives.
// The complete fixture, its hero title made long, in a copy of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const LONG = 'Field notes on failure, recovery and the reviews between them';
const COPY = path.join(mkdtempSync(path.join(tmpdir(), 'sx-hero-')), 'portfolio.yml');
writeFileSync(
  COPY,
  readFileSync(FIXTURE.files.portfolio, 'utf8').replace('title: Hero label', `title: ${LONG}`),
);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: COPY,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'schematic'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  'a long hero title holds one line in the cover’s title block, cut rather than wrapped, at 1440 and 390',
  { annotation },
  async ({ page }, testInfo) => {
    expect(LONG.length).toBeGreaterThanOrEqual(55);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      const block = page.locator('.sx-sheet--cover .sx-tb');
      const title = block.locator('.sx-tb__sheet-title');
      await expect(title).toHaveText(LONG);
      // One line, cut with an ellipsis rather than wrapped: the top row's
      // height is then the one a short title gives.
      const geometry = await title.evaluate((el) => ({
        lines: el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
        cut: el.scrollWidth > el.clientWidth,
      }));
      expect(geometry.lines, `${viewport.width}`).toBeLessThan(1.5);
      expect(geometry.cut, `${viewport.width}`).toBe(true);
      await block.screenshot({
        path: testInfo.outputPath(`hero-title-long-${viewport.width}.png`),
      });
    }
  },
);
