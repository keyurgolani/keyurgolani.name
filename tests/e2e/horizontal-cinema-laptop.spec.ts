import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { brokenHeadingWords, load, railClashes, read } from './horizontal-cinema-model';

// Horizontal Cinema on a laptop's window (HOR-1): the bundled sample, whose
// Practice scene is the tallest, at the viewports a 13 to 15 inch laptop's
// browser leaves, 1440 by 800 and 1366 by 768. Every scene's picture fits
// the stage there, so the fit check never falls back to the vertical
// stack, and the strip is pinned to the page's scroll as at 1440 by 900.

const DEMO = { type: 'profile', description: 'demo' };
const annotation = [{ type: 'route', description: '/sample' }, DEMO];

test.use({ appOptions: DEMO_APP });

for (const [width, height] of [
  [1440, 800],
  [1366, 768],
] as const) {
  test(
    `at ${width} by ${height} the sample's strip fits and pins, with no scene over the stage`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await load(page, '/sample?variant=horizontal-cinema');
      await expect
        .poll(async () => {
          const { layout, pinned, fit } = await read(page);
          return { layout, pinned, fit };
        })
        .toEqual({ layout: 'horizontal', pinned: true, fit: null });
      // No scene's picture runs past its frame, the controller's own check.
      const over = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.hc-track .hc-scene')]
          .filter((scene) => {
            const pic = scene.querySelector<HTMLElement>('.hc-pic');
            return pic !== null && pic.scrollHeight > pic.clientHeight + 1;
          })
          .map((scene) => scene.id),
      );
      expect(over).toEqual([]);
    },
  );
}

// At 1280 by 800 in a wider face than Trebuchet MS (CI's Liberation Sans), the Epilogue intertitle's
// four columns held "Epilogue" only by breaking it, "Epilogu / e", which no overflow shows: the scene
// now opens a width instead, as for a picture past its frame, and no heading breaks inside a word.
test(
  "at 1280 by 800 no heading in the sample's strip breaks inside a word",
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await load(page, '/sample?variant=horizontal-cinema');
    await expect.poll(() => brokenHeadingWords(page)).toEqual([]);
  },
);

for (const [width, height] of [
  [1366, 768],
  [1280, 800],
] as const) {
  test(
    `at ${width} by ${height} nothing on the sample's rail under the stage overlaps or runs out of its bar`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await load(page, '/sample?variant=horizontal-cinema');
      expect(await railClashes(page)).toEqual([]);
    },
  );
}
