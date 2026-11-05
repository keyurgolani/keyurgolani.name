import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { load, read } from './horizontal-cinema-model';

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
