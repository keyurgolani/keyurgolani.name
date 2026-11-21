import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { inPage } from '../quality/lib/a11y/probe';
import { kineticOptions, openHome } from './kinetic-cosmos-reading';

// Kinetic Cosmos at 1024 by 768 under 200% root text, as the reflow check's root-text condition
// reads it, with the dock showing: the rings still reflow inside the window. From 64rem the dock
// carries its stops in a row; at 200% text that row is far wider than the window, and the rings'
// wrapper is a grid whose one track took its items' widest min-content, so every ring laid out
// past the window's edge behind the wrapper's clip. Two ways the dock shows:
// - at load, with the stage reported out of the window at once, by an observer that reports every
//   target out of view (the moment the quality cell's probe met on a busy runner, when the dock
//   showed until the stage's first report);
// - past the stage, on a reader's scroll.

test.use({
  appOptions: kineticOptions({
    language: 'skeuomorphic',
    scheme: 'warm-parchment',
    typography: 'humanist-ui',
    mode: 'system',
  }),
});

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

/** The root text at 200%, as the reflow check's root-text condition sets it. */
async function largeText(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.documentElement.style.setProperty('font-size', '200%', 'important'),
  );
}

/** Two frames drawn, then the reflow probe's problems as lines. */
async function reflowProblems(page: Page): Promise<string[]> {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const problems = await inPage<{ rule: string; path: string; detail: string }[]>(page, {
    kind: 'reflow',
  });
  return problems.map((problem) => `${problem.rule} ${problem.path}: ${problem.detail}`);
}

test(
  'at 1024 by 768 under 200% root text, at load with the dock showing, nothing leaves the window',
  { annotation },
  async ({ page }) => {
    // An observer that reports each target out of view as it's observed: the dock shows at load.
    await page.addInitScript(() => {
      window.IntersectionObserver = class {
        readonly root = null;
        readonly rootMargin = '';
        readonly thresholds = [];
        constructor(private readonly callback: IntersectionObserverCallback) {}
        observe(target: Element) {
          setTimeout(() =>
            this.callback(
              [{ target, isIntersecting: false } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            ),
          );
        }
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      } as unknown as typeof IntersectionObserver;
    });
    await openHome(page, { width: 1024, height: 768, row: 'default' });
    await largeText(page);
    await expect(page.locator('.kc-dock')).toBeVisible();
    expect(
      await reflowProblems(page),
      'nothing clipped or out of view, the dock showing at load',
    ).toEqual([]);
  },
);

test(
  'at 1024 by 768 under 200% root text, past the opening stage with the dock showing, nothing leaves the window',
  { annotation },
  async ({ page }) => {
    await openHome(page, { width: 1024, height: 768, row: 'default' });
    // The text first, so the scroll lands past the stage as the large text lays it out.
    await largeText(page);
    await page
      .locator('#kc--ring-record')
      .evaluate((ring) => ring.scrollIntoView({ block: 'start' }));
    await expect(page.locator('.kc-dock')).toBeVisible();
    expect(
      await reflowProblems(page),
      'nothing clipped or out of view, the dock showing past the stage',
    ).toEqual([]);
  },
);
