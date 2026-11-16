import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { expect, test } from '../harness/fixtures';

// Singular's pager docks the bar's name into panel 1's h1, and lends the bar and the rail the ground
// of the panel under them, from IntersectionObservers' first deliveries. A capture waits for the page
// to settle (watchEnhancements(), the variant shots' and the quality cells' wait), so the page must
// hold as unsettled until those first passes have run: else a shot lands before or after them, and
// the same tree shoots two ways. With every observer's delivery held back 800 ms, what the bar and
// the rail show once the page has settled is what they show once the deliveries have landed.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const DELAY_MS = 800;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

/** The bar's and the rail's state the observers set. */
const chrome = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.sg-bar');
    const rail = document.querySelector<HTMLElement>('.sg-rail');
    return {
      name: bar?.dataset.sgName ?? null,
      barGround: bar?.dataset.ground ?? null,
      railGround: rail?.dataset.ground ?? null,
      current:
        document.querySelector('a[data-sg-rail][aria-current]')?.getAttribute('data-sg-rail') ??
        null,
    };
  });

test(
  "with its observers' first deliveries held back, Singular's page settles only once they have run",
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
        'singular',
      );
      expect(await watch.settled(), 'the page settles').toBe(true);
      const settled = await chrome(page);
      await page.waitForTimeout(DELAY_MS * 3);
      const landed = await chrome(page);
      console.log(
        `singular pager settle: at settle ${JSON.stringify(settled)}, once delivered ${JSON.stringify(landed)}`,
      );
      expect(settled, 'the bar and the rail at settle, as once the deliveries have landed').toEqual(
        landed,
      );
      expect(landed.name, 'the name docked into the h1 at the top of the page').toBe('docked');
    } finally {
      watch.stop();
    }
  },
);
