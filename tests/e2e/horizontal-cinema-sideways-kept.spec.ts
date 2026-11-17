import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { expectAt, frames, load, read } from './horizontal-cinema-model';

// Horizontal Cinema's pinned strip keeps the reader's place through what moves it. Two moves of the
// reader's own were lost. A sideways scroll of the strip inside a resize's burst: the refit at the
// burst's end held the scene the burst's first resize had found, and threw the reader back to it.
// And a sideways swipe while a step to the next scene was still gliding: the strip followed the
// page's glide back onto the step's scene, undoing the swipe. On the complete contract fixture at
// 1440 by 900, the strip pinned: after each, the reader is past the scene they swiped on from.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

/** Steps to scene `index` with the strip's Next, each step arrived before the next. */
async function stepTo(page: Page, index: number) {
  await load(page);
  expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true });
  const next = page.getByRole('button', { name: 'Next scene' });
  for (let at = 1; at <= index; at++) {
    await next.click();
    await expectAt(page, at);
  }
}

/** A sideways swipe over the stage, about one and a half of its widths on, as a trackpad's. */
async function swipe(page: Page) {
  const box = (await page.locator('.hc-stage').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(Math.round(box.width * 1.5), 0);
}

/** Waits until nothing has scrolled for 600 ms and two frames have drawn. */
async function settled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let timer = setTimeout(finish, 600);
        function finish() {
          removeEventListener('scroll', reset, true);
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        }
        function reset() {
          clearTimeout(timer);
          timer = setTimeout(finish, 600);
        }
        addEventListener('scroll', reset, true);
      }),
  );
}

test(
  "a sideways scroll of the strip inside a resize's burst is kept by the strip's refit, not undone",
  { annotation, tag },
  async ({ page }) => {
    await stepTo(page, 6);
    // The burst held open: from its first resize, one more every 40 ms until the strip has been
    // scrolled and 200 ms more, so the swipe falls between the burst's first resize and its refit.
    await page.evaluate(() => {
      const w = window as unknown as { __hcBurst: Promise<void>; __hcSwiped: boolean };
      w.__hcSwiped = false;
      const stage = document.querySelector('.hc-stage')!;
      stage.addEventListener('scroll', () => (w.__hcSwiped = true), { once: true });
      w.__hcBurst = new Promise<void>((started) => {
        addEventListener(
          'resize',
          () => {
            started();
            let after = 0;
            const beat = setInterval(() => {
              if (w.__hcSwiped) after += 40;
              if (after > 200) clearInterval(beat);
              else dispatchEvent(new Event('resize'));
            }, 40);
          },
          { once: true },
        );
      });
    });
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.evaluate(() => (window as unknown as { __hcBurst: Promise<void> }).__hcBurst);
    await swipe(page);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __hcSwiped: boolean }).__hcSwiped))
      .toBe(true);
    await page.waitForTimeout(600);
    await frames(page);
    await settled(page);
    const { current, pinned } = await read(page);
    expect({ pinned, past: current > 6 }, `current ${current}`).toEqual({
      pinned: true,
      past: true,
    });
  },
);

test(
  "a sideways swipe while a step to the next scene glides is the reader's: the strip doesn't pull back to the step's scene",
  { annotation, tag },
  async ({ page }) => {
    await stepTo(page, 2);
    // Next, then the swipe straight after, while the step's glide is still on its way to scene 3.
    await page.getByRole('button', { name: 'Next scene' }).click();
    await swipe(page);
    await settled(page);
    const { current, pinned } = await read(page);
    expect({ pinned, past: current > 3 }, `current ${current}`).toEqual({
      pinned: true,
      past: true,
    });
  },
);
