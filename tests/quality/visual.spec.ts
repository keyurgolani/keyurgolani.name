import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { cellServer } from './lib/server';
import { VIEWPORTS } from './lib/matrix';
import {
  expectedFonts,
  fontDifference,
  imageFonts,
  inPinnedImage,
  RANDOM_SEED,
  seedRandomScript,
  VISUAL_SKIP,
} from './lib/visual';
import { expect, test } from './fixtures';
import { loadPlan } from './plan';

// The visual cells (#11, Slice 1, item 7): each composition sentinel on the
// complete fixture, at 1440x900 and 390x844, only in the pinned Playwright
// image, with Math.random seeded and the image's fonts exactly fonts.txt's.
// Their screenshots are attached; Slice 4 commits baselines for the ones
// tests/variants doesn't cover.

const plan = await loadPlan();
const cells = plan.cells.filter(
  (cell) =>
    cell.kind === 'composition' && cell.sentinel && cell.state === 'complete' && cell.path === '/',
);
const viewports = VIEWPORTS.filter(({ id }) => id === '1440x900' || id === '390x844');

/** The image's fonts against fonts.txt, read once per worker, and written out for the next list. */
let fontCheck: { missing: string[]; extra: string[] } | undefined;
function checkFonts(): { missing: string[]; extra: string[] } {
  if (!fontCheck) {
    const actual = imageFonts();
    const dir = path.join(reportsDir(), 'quality');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'fonts.observed.txt'), `${actual.join('\n')}\n`);
    fontCheck = fontDifference(expectedFonts(), actual);
  }
  return fontCheck;
}

test.describe('visual', () => {
  test.skip(!inPinnedImage(), VISUAL_SKIP);

  for (const cell of cells) {
    test.describe(cell.id, () => {
      test.use({ cellServer: cellServer(cell) });
      for (const viewport of viewports) {
        test.describe(viewport.id, () => {
          test.use({
            viewport: { width: viewport.width, height: viewport.height },
            isMobile: viewport.isMobile ?? false,
            hasTouch: viewport.hasTouch ?? false,
          });
          test(
            `${cell.target} ${cell.state} at ${viewport.id}, seeded, in the pinned image`,
            {
              annotation: [
                { type: 'route', description: cell.route },
                { type: 'cell', description: cell.id },
                { type: 'target', description: `${cell.kind}:${cell.target}` },
                { type: 'viewport', description: viewport.id },
              ],
            },
            async ({ page }, testInfo) => {
              expect(checkFonts(), "the image's fonts against fonts.txt").toEqual({
                missing: [],
                extra: [],
              });
              await page.addInitScript(seedRandomScript, RANDOM_SEED);
              const response = await page.goto(cell.path);
              expect(response?.status()).toBe(cell.expectedStatus);
              await page.evaluate(() => document.fonts.ready);
              await testInfo.attach('screenshot.png', {
                body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
                contentType: 'image/png',
              });
            },
          );
        });
      }
    });
  }
});
