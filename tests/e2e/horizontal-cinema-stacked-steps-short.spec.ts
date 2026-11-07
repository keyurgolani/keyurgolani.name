import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { load, stepAcrossStacked } from './horizontal-cinema-model';

// Horizontal Cinema stacked by a touch screen in the strip's room, with short scenes: the
// identity-only contract fixture, whose title card and chapter cards are each shorter than the
// window. The bar's Next and Previous land on the scene they step to, never its neighbour.

const SHORT = contractFixture('identity-only');
const SHORT_DIR = path.dirname(SHORT.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: SHORT.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(SHORT.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      SHORT.unitFiles.map((file) => [file, readFileSync(path.join(SHORT_DIR, file), 'utf8')]),
    ),
  },
  hasTouch: true,
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
] as const) {
  test(
    `short scenes stacked by touch at ${width} by ${height}: Next steps to the last scene and Previous back, each onto its own scene`,
    { annotation, tag },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await load(page);
      await expect(page.locator('.hc-shell')).not.toHaveAttribute('data-pin');
      const scenes = await page.locator('.hc-track .hc-scene').count();
      expect(await stepAcrossStacked(page)).toBe(2 * (scenes - 1));
    },
  );
}
