import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { appFor, textPastTheEdges } from './flux-shared';

// Flux on the long-text fixture, under read-only: at 320 and 390, with every
// fold open, no line of text runs past the window's edges. Its own file, since
// a worker-scoped appOptions can't be set in a describe.

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({ appOptions: appFor(contractFixture('long-text')) });

for (const width of [320, 390]) {
  test(
    `at ${width}: no line of text runs past the window's edges`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      // Every fold open, so its text is measured too.
      await page.evaluate(() =>
        document.querySelectorAll('details').forEach((fold) => (fold.open = true)),
      );
      expect(await page.evaluate(textPastTheEdges)).toEqual([]);
    },
  );
}
