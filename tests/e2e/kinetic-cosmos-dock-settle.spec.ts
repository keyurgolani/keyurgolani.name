import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { expect, test } from '../harness/fixtures';

// Kinetic Cosmos shows its dock once the stage observer first reports the opening stage out of the
// window, and keeps it aside while the stage is in view; before that first report the dock isn't
// shown. A capture waits for the page to settle (watchEnhancements(), the variant shots' and the
// quality cells' wait), so the page must hold as unsettled until that first report has run: else a
// page loaded past the stage shoots two ways, with no dock or with it, the page a dock's height
// apart. With every observer's delivery held back 800 ms, what the dock paints once the page has
// settled is what it paints once the deliveries have landed, at desktop and on a phone, loaded at
// the top, the stage in view, and loaded at the last ring, past it. With no IntersectionObserver
// the dock reports the stage gone from the next frame, and that report must be in at settle too.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const DELAY_MS = 800;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/** What the dock paints, as the stage observer sets it, and the page's height it changes. */
const dock = (page: Page) =>
  page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('.kc-dock');
    return {
      display: element ? getComputedStyle(element).display : null,
      page: document.documentElement.scrollHeight,
    };
  });

/** The last ring's fragment, read from a page of its own. */
async function lastRing(page: Page): Promise<string> {
  const probe = await page.context().newPage();
  try {
    await probe.goto('/');
    const id = await probe.locator('.kc-ring').last().getAttribute('id');
    expect(id, 'the last ring has an id').toBeTruthy();
    return `/#${id}`;
  } finally {
    await probe.close();
  }
}

const PLACES = {
  'at the top': { past: false, observer: true, shown: false },
  'at the last ring': { past: true, observer: true, shown: true },
  'with no IntersectionObserver': { past: false, observer: false, shown: true },
} as const;

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
] as const) {
  test.describe(name, () => {
    test.use({ viewport });

    for (const [place, { past, observer, shown }] of Object.entries(PLACES))
      test(
        `on ${name}, loaded ${place}, Kinetic Cosmos's page settles only once the dock's first report is in`,
        { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
        async ({ page }) => {
          const route = past ? await lastRing(page) : '/';
          if (observer)
            await page.addInitScript((delay) => {
              const Native = window.IntersectionObserver;
              window.IntersectionObserver = class extends Native {
                constructor(
                  callback: IntersectionObserverCallback,
                  options?: IntersectionObserverInit,
                ) {
                  super(
                    (entries, watcher) =>
                      window.setTimeout(() => callback(entries, watcher), delay),
                    options,
                  );
                }
              };
            }, DELAY_MS);
          else
            await page.addInitScript(() => {
              Reflect.deleteProperty(window, 'IntersectionObserver');
            });
          const watch = watchEnhancements(page);
          try {
            await page.goto(route);
            await expect(page.locator('[data-variant]').first()).toHaveAttribute(
              'data-variant',
              'kinetic-cosmos',
            );
            expect(await watch.settled(), 'the page settles').toBe(true);
            const settled = await dock(page);
            await page.waitForTimeout(DELAY_MS * 3);
            const landed = await dock(page);
            console.log(
              `kinetic-cosmos dock settle ${name} ${place}: at settle ${JSON.stringify(settled)}, once delivered ${JSON.stringify(landed)}`,
            );
            expect(settled, 'the dock at settle, as once the deliveries have landed').toEqual(
              landed,
            );
            if (shown) expect(landed.display, 'the dock shown, the stage gone').not.toBe('none');
            else expect(landed.display, 'the dock aside while the stage is in view').toBe('none');
          } finally {
            watch.stop();
          }
        },
      );
  });
}
