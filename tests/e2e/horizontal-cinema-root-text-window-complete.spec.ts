import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { open, reach } from './horizontal-cinema-root-text';

// Horizontal Cinema's storyboard with the root text at 200% on a phone, on the complete contract
// fixture's work page: the storyboard's one column took the width of its widest scene, 354 px at
// 320, so the page scrolled sideways. As a phone (touch, mobile), the page's scroll width stays
// within the window at 320 and at 390.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const WORK = '/work/project-name';

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
    test(`the complete work page at ${width} with the root text at 200% stays inside the window`, async ({
      page,
    }) => {
      await open(page, WORK, '200%');
      const read = await reach(page);
      expect(read.scroll, JSON.stringify(read)).toBeLessThanOrEqual(read.window);
    });
  });
}
