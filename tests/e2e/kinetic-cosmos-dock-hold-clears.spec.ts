import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { expect, test } from '../harness/fixtures';
import { pendingHolds, styleFromTheStart } from './settle-hold';

// Kinetic Cosmos's dock holds the page unsettled from when its script starts to watch the opening
// stage until the stage observer's first delivery is on the page. An IntersectionObserver delivers
// a first entry for whatever it watches, shown or not, so the hold clears even when the stage starts
// out hidden or with no size: a hold that never cleared would leave the page unsettled for good, and
// every capture and quality read that waits on it would wait out its limit. Here the stage is
// hidden, then of no height, from the page's first parse, and the page settles with nothing held.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

const STAGES = {
  hidden: { css: '.kc-opening { display: none !important; }', box: 'none' },
  'of no height': {
    css: '.kc-opening { block-size: 0 !important; min-block-size: 0 !important; padding-block: 0 !important; overflow: hidden !important; }',
    box: 'no height',
  },
} as const;

for (const [named, { css, box }] of Object.entries(STAGES))
  test(
    `with the opening stage ${named} from the start, Kinetic Cosmos's dock lets the page settle, holding nothing`,
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await styleFromTheStart(page, css);
      const watch = watchEnhancements(page);
      try {
        await page.goto('/');
        await expect(page.locator('[data-variant]').first()).toHaveAttribute(
          'data-variant',
          'kinetic-cosmos',
        );
        const stage = await page
          .locator('.kc-opening')
          .first()
          .evaluate((element) => {
            const style = getComputedStyle(element);
            if (style.display === 'none') return 'none';
            return element.getBoundingClientRect().height === 0 ? 'no height' : 'shown';
          });
        expect(stage, 'the stage as the page laid it out').toBe(box);
        expect(await watch.settled(), 'the page settles').toBe(true);
        expect(await pendingHolds(page), 'nothing holds the page').toEqual([]);
      } finally {
        watch.stop();
      }
    },
  );
