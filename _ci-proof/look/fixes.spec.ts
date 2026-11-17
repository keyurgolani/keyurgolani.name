import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { keyboardFocus } from './focus-perimeter';
import { fixtureIn } from './forced-backplate';

// The CI proof's look (copied in, never committed): Singular on L1_LOOK_ROUTE with forced colours
// on or off (L1_LOOK_ROW forced-colors or default), light and dark, at 1024 and 390. Shots: the
// record's first rows and the colophon (their rules, the folds' plus), the rail's current stop
// (1024), the bar's Contents button focused with the bar on each dark ground, and the Contents
// dialog opened over each dark ground with its first control focused. Shots go to
// PROOF_LOOK_OUT/<palette>-<width>-<what>.png; with no env it lists.

const OUT = process.env.PROOF_LOOK_OUT ?? '';
const ROUTE = process.env.L1_LOOK_ROUTE ?? '/';
const ROW = process.env.L1_LOOK_ROW === 'forced-colors' ? 'forced-colors' : 'default';
const CONTENTS = ".sg-bar__nav [data-ui-slot='action'][aria-haspopup='dialog']";

test.use({ appOptions: fixtureIn('singular') });

const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 200))),
      ),
  );

async function lend(page: Page, ground: string): Promise<boolean> {
  const count = await page.locator(`[data-sg-stop][data-ground='${ground}']`).count();
  for (let i = 0; i < count; i += 1)
    for (const block of ['start', 'center'] as const) {
      await page.evaluate(
        ([g, n, b]) =>
          document
            .querySelectorAll(`[data-sg-stop][data-ground='${g}']`)
            [n]?.scrollIntoView({ block: b }),
        [ground, i, block] as const,
      );
      const lent = await page
        .waitForFunction(
          (g) => document.querySelector('.sg-bar')?.getAttribute('data-ground') === g,
          ground,
          { timeout: 3000 },
        )
        .then(() => true)
        .catch(() => false);
      if (lent) return true;
    }
  return false;
}

test(`look: Singular's forced drawings, bar ring and Contents dialog, ${ROUTE}, ${ROW}`, async ({
  page,
}) => {
  test.setTimeout(480_000);
  expect(OUT, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(OUT, { recursive: true });
  for (const palette of ['light', 'dark'] as const)
    for (const width of [1024, 390]) {
      const height = width < 600 ? 844 : 768;
      await page.setViewportSize({ width, height });
      await page.emulateMedia({
        colorScheme: palette,
        forcedColors: ROW === 'forced-colors' ? 'active' : 'none',
        reducedMotion: 'reduce',
      });
      await page.goto(ROUTE, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const at = `${palette}-${width}`;
      const shot = async (
        name: string,
        clip?: { x: number; y: number; width: number; height: number },
      ) =>
        writeFileSync(
          path.join(OUT, `${at}-${name}.png`),
          await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }),
        );
      await page.mouse.move(0, 0);
      if (width >= 600) {
        await page.evaluate(() =>
          document
            .querySelector('[data-sg-stop]:not([data-sg-record])')
            ?.scrollIntoView({ block: 'start' }),
        );
        await frames(page);
        const rail = await page.locator('.sg-rail').boundingBox();
        if (rail)
          await shot('rail', {
            x: Math.max(0, Math.floor(rail.x) - 8),
            y: Math.max(0, Math.floor(rail.y) - 8),
            width:
              Math.min(width, Math.ceil(rail.x + rail.width) + 8) -
              Math.max(0, Math.floor(rail.x) - 8),
            height:
              Math.min(height, Math.ceil(rail.y + rail.height) + 8) -
              Math.max(0, Math.floor(rail.y) - 8),
          });
      }
      for (const [name, selector] of [
        ['record', '.sg-rec'],
        ['colophon', '.sg-colophon__in'],
      ] as const) {
        const el = page.locator(selector).first();
        if (!(await el.count())) continue;
        await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
        await frames(page);
        await shot(name);
      }
      for (const ground of ['inverse', 'accent']) {
        if (!(await lend(page, ground))) continue;
        await frames(page);
        const button = page.locator(CONTENTS);
        await keyboardFocus(page, button);
        await frames(page);
        const box = (await button.boundingBox())!;
        const x = Math.max(0, Math.floor(box.x) - 16);
        const y = Math.max(0, Math.floor(box.y) - 12);
        await shot(`contents-on-${ground}`, {
          x,
          y,
          width: Math.min(width, Math.ceil(box.x + box.width) + 16) - x,
          height: Math.min(height, Math.ceil(box.y + box.height) + 12) - y,
        });
        await page.keyboard.press('Enter');
        await expect(page.locator('dialog[open]')).toHaveCount(1);
        await page.keyboard.press('Tab');
        await frames(page);
        await shot(`dialog-over-${ground}`);
        await page.keyboard.press('Escape');
        await expect(page.locator('dialog[open]')).toHaveCount(0);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      }
    }
});
