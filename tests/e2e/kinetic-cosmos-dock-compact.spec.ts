import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { kineticOptions, openHome } from './kinetic-cosmos-reading';

// Kinetic Cosmos's dock past the opening stage. Under 200% root text at 1024 by 768 its row of
// stops, where you are and the index can't fit, and wrapped it took half the window over the rings;
// there the dock holds a quarter of the window at most, where you are, the way out and the index,
// which reaches every stop. At 100% text the row is as it was: every stop, where you are and the
// index on one line.

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

/** Home at the size and root text, scrolled past the stage so the dock shows, two frames drawn. */
async function dockPastStage(page: Page, width: number, height: number, root: number) {
  await openHome(page, { width, height, row: 'default' });
  if (root !== 1)
    await page.evaluate(
      (scale) =>
        document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
      root,
    );
  await page
    .locator('#kc--ring-record')
    .evaluate((ring) => ring.scrollIntoView({ block: 'start' }));
  await expect(page.locator('.kc-dock')).toBeVisible();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

test(
  'at 1024 by 768 under 200% root text, the shown dock holds a quarter of the window at most, and its Index is in reach',
  { annotation },
  async ({ page }) => {
    await dockPastStage(page, 1024, 768, 2);
    const height = await page
      .locator('.kc-dock')
      .evaluate((dock) => Math.round(dock.getBoundingClientRect().height));
    expect(height, 'the dock, in px of a 768 px window').toBeLessThanOrEqual(768 / 4);
    const index = page.locator('.kc-dock .kc-index-trigger');
    await expect(index).toBeVisible();
    await expect(index).toBeInViewport();
    await expect(page.locator('.kc-dock__stop:visible')).toHaveText(['Contact']);
  },
);

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
])
  test(
    `at ${width} by ${height} under 100% text, the shown dock holds every stop, where you are and the index on one line`,
    { annotation },
    async ({ page }) => {
      await dockPastStage(page, width, height, 1);
      const line = await page.locator('.kc-dock').evaluate((dock) => {
        const parts = [
          dock.querySelector('.kc-dock__where'),
          ...dock.querySelectorAll('.kc-dock__stop'),
          dock.querySelector('.kc-index-trigger'),
        ].map((part) => part!.getBoundingClientRect());
        const shown = parts.filter((box) => box.width > 0 && box.height > 0);
        const middles = shown.map((box) => box.top + box.height / 2);
        return {
          shown: shown.length,
          of: parts.length,
          spread: Math.round(Math.max(...middles) - Math.min(...middles)),
        };
      });
      expect(line.shown, 'parts shown').toBe(line.of);
      expect(line.spread, "px between the parts' middles").toBeLessThanOrEqual(2);
    },
  );
