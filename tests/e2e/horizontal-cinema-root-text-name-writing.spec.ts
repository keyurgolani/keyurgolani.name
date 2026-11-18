import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { creditsName, open } from './horizontal-cinema-root-text';

// Horizontal Cinema's credits name with the root text at 200% on a phone, on the writing contract
// fixture: at the display size its "Kowalczyk" ran 515 px, on a 248 px line at 320 and a 318 px one
// at 390, and broke inside itself. As a phone
// (touch, mobile), on the home, every word of the name stays whole on its line, and it is set no
// smaller than at 100%, or else as large as its widest word fits its line.

const FIXTURE = contractFixture('writing');
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
    for (const route of ['/']) {
      test(`the credits name on the home at ${width} with the root text at 200% keeps every word whole`, async ({
        page,
      }) => {
        await open(page, route, '100%');
        const one = await creditsName(page);
        expect(one.broken, JSON.stringify(one)).toEqual([]);
        await open(page, route, '200%');
        const two = await creditsName(page);
        expect(two.broken, JSON.stringify({ one, two })).toEqual([]);
        expect(
          two.size >= one.size || two.widest >= two.width * 0.98,
          `smaller than at 100% with room to spare: ${JSON.stringify({ one, two })}`,
        ).toBe(true);
      });
    }
  });
}
