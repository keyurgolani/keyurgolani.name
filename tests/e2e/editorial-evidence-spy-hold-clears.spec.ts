import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { expect, test } from '../harness/fixtures';
import { pendingHolds, styleFromTheStart } from './settle-hold';

// Editorial Evidence's scroll-spy holds the page unsettled from when its script starts to watch the
// page's places until the places observer's first delivery has run. An IntersectionObserver
// delivers a first entry for whatever it watches, shown or not, and the ResizeObserver on the spy's
// sentinel, which makes that observer, gives the sentinel's first size even where it isn't laid
// out, as on paper. So the hold clears with the places hidden, or of no height, from the page's
// first parse, and with the page printed from its first load: each settles with nothing held, and
// none waits out a capture's or a quality read's limit.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const PLACES = '.ee-opening, .ee-chapter__open, .ee-band[data-section-id]';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

const CASES = {
  'with its places hidden from the start': {
    css: `:is(${PLACES}) { display: none !important; }`,
    print: false,
  },
  'with its places of no height from the start': {
    css: `:is(${PLACES}) { block-size: 0 !important; min-block-size: 0 !important; padding-block: 0 !important; overflow: hidden !important; }`,
    print: false,
  },
  'printed from its first load': { css: '', print: true },
} as const;

for (const [named, { css, print }] of Object.entries(CASES))
  test(
    `${named}, Editorial Evidence's scroll-spy lets the page settle, holding nothing`,
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      if (css) await styleFromTheStart(page, css);
      if (print) await page.emulateMedia({ media: 'print' });
      const watch = watchEnhancements(page);
      try {
        await page.goto('/');
        await expect(page.locator('[data-variant]').first()).toHaveAttribute(
          'data-variant',
          'editorial-evidence',
        );
        expect(await page.evaluate(() => matchMedia('print').matches), 'printed').toBe(print);
        expect(await watch.settled(), 'the page settles').toBe(true);
        expect(await pendingHolds(page), 'nothing holds the page').toEqual([]);
      } finally {
        watch.stop();
      }
    },
  );
