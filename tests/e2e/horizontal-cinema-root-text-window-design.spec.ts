import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { open, reach } from './horizontal-cinema-root-text';

// Horizontal Cinema's widest scene map with the root text at 200% on a phone: the design contract
// fixture's work page, whose scene names ran the map 433 px wide at 320 and at 390. As a phone
// (touch, mobile), the page's scroll width stays within the window at both.

const FIXTURE = contractFixture('design');
const DIR = path.dirname(FIXTURE.files.portfolio);
const WORK = '/work/the-water-beneath-the-dashboard';

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

for (const { width, height } of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test.describe(`${width} by ${height}`, () => {
    test.use({ viewport: { width, height } });
    test(`the design work page at ${width} with the root text at 200% stays inside the window`, async ({
      page,
    }) => {
      await open(page, WORK, '200%');
      const read = await reach(page);
      expect(read.scroll, JSON.stringify(read)).toBeLessThanOrEqual(read.window);
    });
  });
}
