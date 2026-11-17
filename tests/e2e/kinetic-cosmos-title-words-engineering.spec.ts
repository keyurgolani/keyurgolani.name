import { expect, test } from '../harness/fixtures';
import {
  annotation,
  brokenTitleWords,
  servingKineticCosmos,
  WIDTHS,
} from './kinetic-cosmos-title-words';

// The engineering fixture's project page (kinetic-cosmos-title-words.ts).

test.use({ appOptions: servingKineticCosmos('engineering') });

const ROUTE = '/work/shipyard';

for (const width of WIDTHS) {
  test(
    `at ${width} with the root text at 200%, the engineering fixture's project title breaks only between words`,
    { annotation: annotation(ROUTE) },
    async ({ page }) => {
      const { words, broken } = await brokenTitleWords(page, ROUTE, width);
      expect(words, 'words read').toBeGreaterThan(0);
      expect(broken, 'words broken inside themselves').toEqual([]);
    },
  );
}
