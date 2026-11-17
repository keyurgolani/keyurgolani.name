import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Spatial Bento's phone dock (M1): the works, Contact and the Menu across the window's foot, the
// Menu's dialog holding every board and section. With the root text at 200% at 320 every label the
// dock shows stays inside its cell, so no two run together, and the Menu still opens whole with the
// works and Contact in it, focus going into it and back to the dock's Menu as it closes. At 1x at
// 320 and 390 the dock keeps its one row of three equal cells. On the release tuple, Platform
// Neutral on Warm Parchment in Humanist UI, the root text set as the quality cells' root-text
// condition sets it (conditions.ts: the root's font-size at 200%, important).

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'spatial-bento')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 320, height: 568 },
  isMobile: true,
  hasTouch: true,
});

/** Home at `width` with the root text at `size`, scrolled past the overview until the dock shows. */
async function docked(page: Page, width: number, size: string) {
  await page.setViewportSize({ width, height: 568 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(
    (value) => document.documentElement.style.setProperty('font-size', value, 'important'),
    size,
  );
  for (let step = 0; step < 30; step += 1) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(60);
  }
  await expect(page.locator('.sb-dock')).not.toHaveAttribute('data-state', 'hidden');
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** Each cell the dock shows, left to right: its box, and where its label's ink runs. */
const shownCells = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.sb-dock__phone > li > *')]
      .filter((cell) => cell.getClientRects().length > 0)
      .map((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const ink = range.getBoundingClientRect();
        const box = cell.getBoundingClientRect();
        return {
          label: (cell.textContent ?? '').trim(),
          box: { left: box.left, right: box.right, top: box.top, width: box.width },
          ink: { left: ink.left, right: ink.right },
        };
      }),
  );

test('with the root text at 200% at 320, each label the dock shows stays inside its cell', async ({
  page,
}) => {
  await docked(page, 320, '200%');
  const cells = await shownCells(page);
  expect(
    cells.map(({ label }) => label),
    'the dock shows its Menu',
  ).toContain('Menu');
  for (const { label, box, ink } of cells) {
    expect(ink.left, `"${label}" starts inside its cell`).toBeGreaterThanOrEqual(box.left - 0.5);
    expect(ink.right, `"${label}" ends inside its cell`).toBeLessThanOrEqual(box.right + 0.5);
  }
});

for (const [size, name] of [
  ['200%', 'with the root text at 200%'],
  ['100%', 'at 1x'],
] as const)
  test(`${name} at 320, the dock's Menu opens whole with the works and Contact in it, and gives focus back as it closes`, async ({
    page,
  }) => {
    await docked(page, 320, size);
    // Where the dock's own Work and Contact go, shown or not.
    const targets = await page
      .locator('.sb-dock__phone > li > a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(targets.length, "the dock's Work and Contact").toBe(2);
    const menu = page.locator('.sb-dock__phone [data-ui-slot="action"]');
    await menu.click();
    const dialog = page.locator('.sb-menu-slot dialog');
    await expect(dialog).toHaveJSProperty('open', true);
    const box = (await dialog.boundingBox())!;
    expect(box.x, 'the Menu starts inside the window').toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width, 'the Menu ends inside the window').toBeLessThanOrEqual(320.5);
    expect(box.y, "the Menu's top is inside the window").toBeGreaterThanOrEqual(-0.5);
    expect(box.y + box.height, "the Menu's foot is inside the window").toBeLessThanOrEqual(568.5);
    for (const href of targets) await expect(dialog.locator(`a[href="${href}"]`)).toHaveCount(1);
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      'focus goes into the Menu',
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveJSProperty('open', false);
    expect(
      await menu.evaluate((el) => el === document.activeElement),
      "focus comes back to the dock's Menu",
    ).toBe(true);
  });

for (const width of [320, 390])
  test(`at 1x at ${width}, the dock is one row of three equal cells`, async ({ page }) => {
    await docked(page, width, '100%');
    const cells = await shownCells(page);
    expect(cells.map(({ label }) => label)).toEqual(['Work', 'Contact', 'Menu']);
    const [first] = cells;
    for (const { label, box } of cells) {
      expect(
        Math.abs(box.top - first!.box.top),
        `"${label}" on the first cell's row`,
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(box.width - first!.box.width),
        `"${label}" as wide as the first cell`,
      ).toBeLessThanOrEqual(0.5);
    }
  });
