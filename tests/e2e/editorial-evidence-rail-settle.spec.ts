import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { expect, test } from '../harness/fixtures';

// Editorial Evidence's scroll-spy folds the chapter index beside the head column to its label and
// the chapter being read (data-ee-yield), and names the place being read in the running head, from
// its places observer's first delivery. A capture waits for the page to settle (watchEnhancements(),
// the variant shots' and the quality cells' wait), so the page must hold as unsettled until that
// first pass has run: else a shot lands before or after it, and the same tree shoots two ways. With
// every observer's delivery held back 800 ms, what the index and the running head show once the
// page has settled is what they show once the deliveries have landed.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const DELAY_MS = 800;

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

/** The chapter index's and the running head's state the observers set. */
const chrome = (page: Page) =>
  page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('.ee-rail');
    const folio = document.querySelector<HTMLElement>('[data-ee-folio]');
    return {
      railYield: rail?.dataset.eeYield ?? null,
      folio: folio?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      current: [...document.querySelectorAll('[aria-current="location"]')].map(
        (link) => link.textContent?.trim() ?? '',
      ),
    };
  });

test(
  "with its observers' first deliveries held back, Editorial Evidence's page settles only once they have run",
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await page.addInitScript((delay) => {
      const Native = window.IntersectionObserver;
      window.IntersectionObserver = class extends Native {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          super(
            (entries, observer) => window.setTimeout(() => callback(entries, observer), delay),
            options,
          );
        }
      };
    }, DELAY_MS);
    const watch = watchEnhancements(page);
    try {
      await page.goto('/');
      await expect(page.locator('[data-variant]').first()).toHaveAttribute(
        'data-variant',
        'editorial-evidence',
      );
      expect(await watch.settled(), 'the page settles').toBe(true);
      const settled = await chrome(page);
      await page.waitForTimeout(DELAY_MS * 3);
      const landed = await chrome(page);
      console.log(
        `editorial-evidence rail settle: at settle ${JSON.stringify(settled)}, once delivered ${JSON.stringify(landed)}`,
      );
      expect(
        settled,
        'the index and the running head at settle, as once the deliveries have landed',
      ).toEqual(landed);
      expect(landed.railYield, 'the index folded to its top at the top of the page').toBe('fold');
    } finally {
      watch.stop();
    }
  },
);
