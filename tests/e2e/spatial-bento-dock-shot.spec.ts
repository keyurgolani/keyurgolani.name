import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Spatial Bento's dock holds one state through a whole-page shot. A whole-page screenshot taken
// with the page at rest shrinks the window to a pixel for a moment (Chromium's capture beyond the
// viewport), and the dock's away observer sees the overview out of that window, though no part of
// it has gone above it. The dock showed, and hid again once the window came back: a shot of the
// page at its top held the dock whole or half faded in, on the variants' desktop shots, from one
// capture to the next. Scrolled past the overview, the dock stays shown through the shot. The
// shots are taken as the variants take them, each after a second at rest, since a shot taken while
// the page still renders lets the observer miss the small window.

const FIXTURE = contractFixture('consulting');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'spatial-bento'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

declare global {
  interface Window {
    /** Each data-state the dock takes, and the window's height at each resize, since the watch. */
    __dockShot?: { states: string[]; heights: number[] };
  }
}

/** From now on, every data-state the dock takes and the window's height at every resize. */
const watchDock = (page: Page) =>
  page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>('.sb-dock')!;
    const seen = { states: [] as string[], heights: [] as number[] };
    window.__dockShot = seen;
    new MutationObserver(() => seen.states.push(dock.dataset.state ?? '')).observe(dock, {
      attributes: true,
      attributeFilter: ['data-state'],
    });
    window.addEventListener('resize', () => seen.heights.push(window.innerHeight), true);
  });

/** Four whole-page shots as the variants take them, each after a second at rest. */
async function shoot(page: Page) {
  for (let shot = 0; shot < 4; shot += 1) {
    await page.waitForTimeout(1000);
    await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true });
  }
  await page.waitForTimeout(300);
  const seen = await page.evaluate(() => window.__dockShot!);
  console.log(`the window's heights at each resize: ${JSON.stringify(seen.heights)}`);
  return seen.states;
}

test(
  'at the top of the page, the dock stays hidden through whole-page shots',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const dock = page.locator('.sb-dock');
    await expect(dock).toHaveAttribute('data-state', 'hidden');
    await watchDock(page);
    expect(await shoot(page), "the dock's states through the shots").toEqual([]);
    await expect(dock).toHaveAttribute('data-state', 'hidden');
  },
);

test(
  'scrolled past the overview, the dock stays shown through whole-page shots',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const dock = page.locator('.sb-dock');
    await page.evaluate(() => {
      const boards = document.querySelectorAll('section.sb-board');
      const board = boards[Math.min(2, boards.length - 1)]!;
      window.scrollTo({
        top: board.getBoundingClientRect().top + window.scrollY,
        behavior: 'instant',
      });
    });
    await expect(dock).toHaveAttribute('data-state', 'shown');
    await watchDock(page);
    expect(await shoot(page), "the dock's states through the shots").toEqual([]);
    await expect(dock).toHaveAttribute('data-state', 'shown');
  },
);
