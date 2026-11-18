import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { creditsName, nameInScene, open, openStill } from './horizontal-cinema-root-text';

// Horizontal Cinema's credits name with the root text at 200% on a phone. Set at the display size,
// twice its size at 100%, the academic contract fixture's "Dr. Lukas Brenner" broke inside a word,
// its last word ran wider than its line: at 320 "Lukas" and "Brenner", at 390 "Brenner", on the
// home and on a work page alike. As a phone (touch, mobile), every word of it stays whole on its
// line, and it is set no smaller than at 100%, or else as large as its widest word fits its line.
// Without script the name keeps the role's size, and at 320 every part of it still lies inside its
// scene, wrapped or broken but never clipped or cut short, by its styles alone.

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

for (const { width, height } of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test.describe(`${width} by ${height}`, () => {
    test.use({ viewport: { width, height } });
    for (const route of ['/', WORK]) {
      const kind = route === '/' ? 'the home' : 'a work page';
      test(`the credits name on ${kind} at ${width} with the root text at 200% keeps every word whole`, async ({
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

test.describe('without script', () => {
  test.use({ viewport: { width: 320, height: 568 }, javaScriptEnabled: false });

  test('the credits name on the home at 320 with the root text at 200% lies whole inside its scene', async ({
    page,
  }) => {
    await openStill(page, '/', '200%');
    expect(await nameInScene(page)).toMatchObject({ past: [], scrolls: false, ellipsis: false });
  });
});
