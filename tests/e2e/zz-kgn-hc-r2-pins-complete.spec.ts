// HC evidence only, not for merge (row 53 r2): retries-0 copies of r2's pins, each x10, for the landing evidence.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import {
  read,
  expectAt,
  load,
  frames,
  resizeTo,
  sceneOffset,
  resizeWith,
} from './horizontal-cinema-model';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
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

test.describe.configure({ retries: 0 });

/**
 * The pinned strip's reader on scene 6, by Next (focus on the bar, not in a scene), and a check that a
 * refit keeps them there: scene 6 current and its start within 1 px of where it was (row 53 r2, 1b).
 */
async function onSixKept(page: Page) {
  await load(page);
  expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true });
  const next = page.getByRole('button', { name: 'Next scene' });
  for (let at = 1; at <= 6; at++) {
    await next.click();
    await expectAt(page, at);
  }
  const before = await sceneOffset(page, 6);
  return async (step: string) => {
    await expect
      .poll(
        async () => {
          const { layout, pinned, current } = await read(page);
          return { layout, pinned, current };
        },
        { message: step, timeout: 1000 },
      )
      .toEqual({ layout: 'horizontal', pinned: true, current: 6 });
    expect(
      Math.abs((await sceneOffset(page, 6)) - before),
      `${step}: the scene's place`,
    ).toBeLessThanOrEqual(1);
  };
}

for (let run = 1; run <= 10; run++) {
  test(
    `a reader on a scene of the pinned strip keeps it, in the same place, through a resize and back (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
    { annotation, tag },
    async ({ page }) => {
      const keeps = await onSixKept(page);
      await resizeTo(page, { width: 1440, height: 800 });
      await keeps('at 1440 by 800');
      await resizeTo(page, { width: 1440, height: 900 });
      await keeps('back at 1440 by 900');
    },
  );
}

for (let run = 1; run <= 10; run++) {
  test(
    `a step the reader takes inside a resize's burst is kept by the strip's refit, not undone (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
    { annotation, tag },
    async ({ page }) => {
      await onSixKept(page);
      // Next pressed between the burst's first resize and its refit (row 53 r2, 1b): the refit
      // holds the scene the step went to, not the one the resize found.
      await resizeWith(page, { width: 1440, height: 800 }, { press: 'Next scene' });
      await expectAt(page, 7);
    },
  );
}

for (let run = 1; run <= 10; run++) {
  test(
    `a larger text size fits the strip again at once, top to bottom where its scenes no longer fit (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true });
      // The reader is on scene 6, a link in it focused: the change keeps them there, both ways.
      const next = page.getByRole('button', { name: 'Next scene' });
      for (let at = 1; at <= 6; at++) {
        await next.click();
        await expectAt(page, at);
      }
      const { scenes } = await read(page);
      const link = page.locator(`#${scenes[6]} a[href]`).first();
      await link.focus();
      const keeps = async () => {
        await expect.poll(async () => (await read(page)).current, { timeout: 1000 }).toBe(6);
        await expect(link).toBeFocused();
        await expect(link).toBeInViewport();
      };
      // The root's text doubled, as a reader's own setting does, with no resize of the window.
      await page.evaluate(() =>
        document.documentElement.style.setProperty('font-size', '200%', 'important'),
      );
      await expect
        .poll(
          async () => {
            const { layout, pinned, fit } = await read(page);
            return { layout, pinned, fit };
          },
          { timeout: 1000 },
        )
        .toEqual({ layout: 'vertical', pinned: false, fit: 'over' });
      // Top to bottom, scene 6 is at the top, still current, and the focused link is on screen.
      await keeps();
      const top = await page
        .locator(`#${scenes[6]}`)
        .evaluate((scene) => scene.getBoundingClientRect().top);
      expect(top).toBeGreaterThanOrEqual(-1);
      expect(top).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight * 0.3));
      // And back: at its own size the strip shows and pins again.
      await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
      await expect
        .poll(
          async () => {
            const { layout, pinned, fit } = await read(page);
            return { layout, pinned, fit };
          },
          { timeout: 1000 },
        )
        .toEqual({ layout: 'horizontal', pinned: true, fit: null });
      // Pinned again on scene 6, the link still focused and on screen.
      await expectAt(page, 6);
      await keeps();
    },
  );
}

for (let run = 1; run <= 10; run++) {
  test(
    `focus moved into a later scene keeps that scene on screen once the strip rests (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      const { scenes } = await read(page);
      // A link in the far half of a scene well into the strip, focused as a Tab reaches it: the browser
      // brings it into view at the stage's end, and the snap that follows finishes on its scene rather
      // than carrying the strip on past it. Only scenes whose start can reach the stage's: the last few
      // share the strip's end.
      const picks = await page.evaluate((ids) => {
        const stage = document.querySelector<HTMLElement>('.hc-stage')!;
        const travel = stage.scrollWidth - stage.clientWidth;
        const found: { index: number; link: number }[] = [];
        ids.forEach((id, index) => {
          const scene = document.getElementById(id)!;
          const start = scene.getBoundingClientRect().left - stage.getBoundingClientRect().left;
          if (index < 3 || start + stage.scrollLeft > travel - 1) return;
          const links = [...scene.querySelectorAll<HTMLElement>('a[href]')];
          const box = scene.getBoundingClientRect();
          const far = links.findIndex(
            (one) => one.getBoundingClientRect().left > box.left + box.width / 2,
          );
          if (far >= 0) found.push({ index, link: far });
        });
        return found;
      }, scenes);
      expect(picks.length).toBeGreaterThanOrEqual(2);
      for (const { index, link: nth } of picks.slice(0, 3)) {
        const link = page.locator(`#${scenes[index]} a[href]`).nth(nth);
        await link.focus();
        await expectAt(page, index);
        await page.waitForTimeout(400);
        const seen = await link.evaluate((element) => {
          const at = element.getBoundingClientRect();
          const stage = document.querySelector('.hc-stage')!.getBoundingClientRect();
          return (
            at.left >= stage.left && at.right <= stage.right && document.activeElement === element
          );
        });
        expect(seen, scenes[index]).toBe(true);
      }
    },
  );
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (let run = 1; run <= 10; run++) {
    test(
      `reading down a scene, a resize and back keeps the reader in the same place in it (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
      { annotation, tag },
      async ({ page }) => {
        await load(page);
        // A scene taller than the window's reading line and more, with one after it.
        const at = await page.evaluate(() =>
          [...document.querySelectorAll('.hc-track .hc-scene')].findIndex(
            (scene, index, all) =>
              index >= 2 &&
              index < all.length - 1 &&
              scene.getBoundingClientRect().height > innerHeight * 0.45,
          ),
        );
        expect(at, 'the fixture has a tall scene with one after it').toBeGreaterThanOrEqual(2);
        // The reader 120 px into it, as their own scroll puts them.
        await page.evaluate((index) => {
          const scene = document.querySelectorAll('.hc-track .hc-scene')[index]!;
          window.scrollBy({ top: scene.getBoundingClientRect().top + 120, behavior: 'instant' });
        }, at);
        await frames(page);
        await expectAt(page, at);
        const before = await sceneOffset(page, at);
        // A shorter window and back (row 53 r2, 1b): the refits keep them on it, where they were.
        await resizeTo(page, { width: 390, height: 700 });
        await resizeTo(page, { width: 390, height: 844 });
        await expectAt(page, at);
        expect(
          Math.abs((await sceneOffset(page, at)) - before),
          "the reader's place in the scene",
        ).toBeLessThanOrEqual(1);
      },
    );
  }
  for (let run = 1; run <= 10; run++) {
    test(
      `a link followed inside a resize's burst lands on its chapter, and the strip's refit keeps it there (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
      { annotation, tag },
      async ({ page }) => {
        await load(page);
        const { scenes } = await read(page);
        const craft = scenes.indexOf('chapter-craft');
        expect(craft).toBeGreaterThan(0);
        // The link followed between the burst's first resize and its refit (row 53 r2, 1b).
        await resizeWith(page, { width: 390, height: 700 }, { hash: '#chapter-craft' });
        await expectAt(page, craft, { landed: true });
      },
    );
  }
  for (let run = 1; run <= 10; run++) {
    test(
      `turning the phone to landscape and back keeps the chapter it was on (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
      { annotation, tag },
      async ({ page }) => {
        await load(page, '/#chapter-craft');
        const { scenes } = await read(page);
        const craft = scenes.indexOf('chapter-craft');
        await expectAt(page, craft, { landed: true });
        for (const viewport of [
          { width: 844, height: 390 },
          { width: 390, height: 844 },
        ]) {
          await page.setViewportSize(viewport);
          await page.waitForTimeout(600);
          // The controller brings the chapter back to the top as the folds turn over, a landing of its own.
          await expectAt(page, craft, { landed: true });
        }
      },
    );
  }
});
