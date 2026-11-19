import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { creditsGone, pastTheirScene } from './horizontal-cinema-bars';
import { load } from './horizontal-cinema-model';

// Horizontal Cinema's bars on the long-text contract fixture, as the variants pack shoots it, in its
// own appearance. Its scene titles run long, so a bar's Next link can be wider than its scene
// whatever the face: at 1440 by 900 the title card's "Next: About this portfolio, its author, the
// work, ..." ran past the scene's edge and was cut there, its ring's end with it, and given the room
// it needs, the credit beside it ("11 scenes in five chapters: ...") had none left. At 390 by 844 a
// scene's column, sized by its longest words, ran its top bar past the scene, and the counter was cut
// off. Here every bar and everything in it lies inside its scene, and a bottom bar's credit keeps
// some of its width.

const FIXTURE = contractFixture('long-text');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const SIZES = {
  'at 1440 by 900': { viewport: { width: 1440, height: 900 } },
  'on a phone at 390 by 844': {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
} as const;

for (const [named, options] of Object.entries(SIZES))
  test.describe(named, () => {
    test.use(options);
    test(
      `on the long-text fixture ${named}, each scene's bars lie inside the scene, and a bottom bar's credit keeps some of its width`,
      { annotation },
      async ({ page }) => {
        await load(page);
        await page.evaluate(() => document.fonts.ready);
        expect(
          { past: await pastTheirScene(page), gone: await creditsGone(page) },
          'every bar inside its scene, its credit there',
        ).toEqual({ past: [], gone: [] });
      },
    );
  });
