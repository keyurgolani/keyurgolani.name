import { expect, test } from '../harness/fixtures';
import {
  annotation,
  brokenTitleWords,
  servingKineticCosmos,
  WIDTHS,
} from './kinetic-cosmos-title-words';

// The academic fixture's project page (kinetic-cosmos-title-words.ts).

test.use({ appOptions: servingKineticCosmos('academic') });

const ROUTE = '/work/canopy-drought-memory';

for (const width of WIDTHS) {
  test(
    `at ${width} with the root text at 200%, the academic fixture's project title breaks only between words`,
    { annotation: annotation(ROUTE) },
    async ({ page }) => {
      const { words, broken } = await brokenTitleWords(page, ROUTE, width);
      expect(words, 'words read').toBeGreaterThan(0);
      expect(broken, 'words broken inside themselves').toEqual([]);
    },
  );
}
