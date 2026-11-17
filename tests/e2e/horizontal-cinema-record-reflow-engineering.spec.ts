import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { open, pastTheRecord } from './horizontal-cinema-root-text';

// Horizontal Cinema's full record on a phone with the root text at 200%, on the engineering
// contract fixture: a practice row's name column took the whole row, so the skills it holds sat in
// a column 0 px wide and ran up to 200 px past the window, where the scene clips them out of sight;
// and the experience head widened its section past the window. As a phone, with every record
// section open, nothing in the record runs past the window at 320 or at 390.

const FIXTURE = contractFixture('engineering');
const DIR = path.dirname(FIXTURE.files.portfolio);

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
    test(`the engineering home's full record at ${width} with the root text at 200% runs nowhere past the window`, async ({
      page,
    }) => {
      await open(page, '/', '200%');
      expect(await pastTheRecord(page)).toEqual([]);
    });
  });
}
