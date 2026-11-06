import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import {
  crowdRail,
  expectAnnounced,
  expectAt,
  keys,
  load,
  railClashes,
  read,
  watchKeys,
} from './horizontal-cinema-model';

// Horizontal Cinema's scene controller (redesign), on the complete contract
// fixture: Previous and Next, the arrow keys, Home and End, the page's own
// scroll through the pinned strip, a chapter link, and a direct link all
// land on the same scene index, which the URL names by replaceState alone,
// the live status says once, and the minimap marks. The page's scroll goes
// on to the credits past the strip's end; with reduced motion every move
// is a cut; with no script the scenes read in a native scroller; on a phone
// they read top to bottom with a chapter sheet.

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

test(
  'Previous, Next, the arrows, Home, and End step scene by scene, replace the URL, and stop at either end',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const start = await read(page);
    expect(start).toMatchObject({ layout: 'horizontal', pinned: true, current: 0, hash: '' });
    const total = start.scenes.length;
    const next = page.getByRole('button', { name: 'Next scene' });
    const previous = page.getByRole('button', { name: 'Previous scene' });
    await expect(previous).toBeDisabled();

    // Next, three times: each scene current and on screen, named in the URL, announced, no history entry.
    for (const index of [1, 2, 3]) {
      await next.click();
      await expectAt(page, index);
      await expectAnnounced(page, index, total);
      expect(await read(page)).toMatchObject({
        hash: `#${start.scenes[index]}`,
        history: start.history,
      });
    }
    await previous.click();
    await expectAt(page, 2);

    // The keys, with focus in the strip: each step cancels its key, and End and Home jump.
    await watchKeys(page);
    await page.locator('.hc-stage').focus();
    await page.keyboard.press('ArrowRight');
    await expectAt(page, 3);
    await page.keyboard.press('ArrowLeft');
    await expectAt(page, 2);
    await page.keyboard.press('End');
    await expectAt(page, total - 1);
    await expect(next).toBeDisabled();
    // Past the end an arrow is no step: it isn't cancelled, and nothing moves.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    expect((await read(page)).current).toBe(total - 1);
    await page.keyboard.press('Home');
    await expectAt(page, 0);
    expect(await keys(page)).toEqual([true, true, true, false, true]);
    expect((await read(page)).history).toBe(start.history);
  },
);

test(
  "the page's own scroll travels the strip in step, snaps onto a scene, and goes on to the credits",
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await page.mouse.move(720, 450);
    for (let notch = 0; notch < 4; notch++) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(80);
    }
    // The strip moved with the page, and once the scroll rests it sits on a scene's start: the
    // scene the travel had reached, or the next one the way it went, never one behind it.
    await expect.poll(async () => (await read(page)).current).toBeGreaterThan(0);
    const reached = await read(page);
    expect(reached.along).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const state = await read(page);
        return state.onScreen > 0 && state.onScreen === state.current;
      })
      .toBe(true);
    const rested = await read(page);
    expect(rested.current).toBeGreaterThanOrEqual(reached.current);
    await expectAt(page, rested.current);
    // Nothing traps the wheel: scrolling on reaches the credits after the strip.
    for (let notch = 0; notch < 120; notch++) await page.mouse.wheel(0, 600);
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector('.hc-credits')!.getBoundingClientRect().top),
      )
      .toBeLessThan(900);
  },
);

test(
  'a slow wheel, a notch at a time with the page at rest between, travels on scene by scene and never back',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await page.mouse.move(720, 450);
    // Each notch, well short of half a scene, rests before the next, as a slow runner or a slow
    // hand turns it: the snap finishes it onto the next scene the way it went, not the one it left.
    for (const index of [1, 2]) {
      await page.mouse.wheel(0, 200);
      await expectAt(page, index);
      expect((await read(page)).along).toBeGreaterThan(0);
    }
    await page.mouse.wheel(0, -200);
    await expectAt(page, 1);
  },
);

test(
  'three quick presses of Next, within 300 ms, end three scenes on',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const next = page.getByRole('button', { name: 'Next scene' });
    await expect(next).toBeEnabled();
    // Three presses in one go, with no wait between them for the move under way: each retargets
    // it from the scene it was headed for.
    const elapsed = await next.evaluate((button: HTMLButtonElement) => {
      const started = performance.now();
      for (let press = 0; press < 3; press++) button.click();
      return performance.now() - started;
    });
    expect(elapsed).toBeLessThan(300);
    await expectAt(page, 3);
    await page.waitForTimeout(600);
    expect((await read(page)).current).toBe(3);
  },
);

test(
  "a scroll of the visitor's during a step takes over: the scene marked current is the one the page comes to rest on",
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await page.getByRole('button', { name: 'Next scene' }).click();
    // The step is under way, the page moving toward scene 2, when the visitor scrolls on past it. A
    // page scroll, as the scroll bar or a key makes, ends the step's smooth scroll; Chromium carries
    // a programmatic smooth scroll on to its target through a wheel turn, so a wheel can't stand in.
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollBy({ top: 2400, behavior: 'instant' }));
    // Soon after it rests, not once a stalled step's safety net gives up, the scene the page rests
    // in is the one marked current, and the URL and the status name it. A script's scroll rests where
    // it lands, so that's the scene across the stage's start line, not one sitting at it.
    await expect
      .poll(
        async () => {
          const a = await read(page);
          const b = await read(page);
          return (
            a.scrollY === b.scrollY &&
            b.current > 1 &&
            b.current === b.across &&
            b.hash === `#${b.scenes[b.current]}` &&
            b.status.includes(`${b.current + 1} of ${b.scenes.length}`)
          );
        },
        { timeout: 2000 },
      )
      .toBe(true);
    // The step, to scene 1, gave way to it.
    expect((await read(page)).current).not.toBe(1);
  },
);

test(
  'a chapter link and a direct link land on the scene they name, a reload keeps it, and Back returns',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const { scenes } = await read(page);
    // A chapter in the minimap opens its first scene, the chapter card.
    await page.locator('.hc-minimap__chapter a').nth(3).click();
    const craft = scenes.indexOf('chapter-craft');
    expect(craft).toBeGreaterThan(0);
    await expectAt(page, craft);
    expect((await read(page)).hash).toBe('#chapter-craft');
    // A direct link to a scene loads on it, and a reload keeps it.
    await load(page, `/#${scenes[4]}`);
    await expectAt(page, 4);
    await page.reload({ waitUntil: 'load' });
    await expectAt(page, 4);
    // Back returns to the chapter the link opened.
    await page.goBack();
    await expect.poll(async () => (await read(page)).hash).toBe('#chapter-craft');
  },
);

test(
  'a reload with no scene in the URL keeps the place the browser restores',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    // Past the strip, in the credits, the URL names no scene.
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
    );
    await page.waitForTimeout(1000);
    const before = await read(page);
    expect(before.hash).toBe('');
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1000);
    const after = await read(page);
    expect({ hash: after.hash, scrollY: after.scrollY }).toEqual({
      hash: '',
      scrollY: before.scrollY,
    });
  },
);

test(
  "a reader's scroll as the page loads on a direct link keeps their place: the landing isn't cut back",
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const { scenes } = await read(page);
    // As soon as the controller is on the page: a wheel, and the scroll it makes, three scenes on.
    await page.addInitScript(() => {
      const go = () => {
        const stage = document.querySelector('.hc-stage');
        if (!document.querySelector('.hc-scrub[data-live]') || !stage) {
          requestAnimationFrame(go);
          return;
        }
        stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
        window.scrollBy({ top: 3000, behavior: 'instant' });
      };
      requestAnimationFrame(go);
    });
    // A load of its own, not a hash change on the page already open.
    await page.goto('about:blank');
    await page.goto(`/#${scenes[4]}`, { waitUntil: 'load' });
    await expect
      .poll(async () => {
        const state = await read(page);
        return state.current > 4 && state.onScreen === state.current;
      })
      .toBe(true);
  },
);

test(
  'focus moved into a later scene keeps that scene on screen once the strip rests',
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

/**
 * From a scene's last link, mid-strip, Tab goes on into a later scene, as a keyboard walk does: a
 * foot's Next, or a chapter's own list. Read as the walk reads it, two frames and 50 ms on and then
 * frame by frame for 800 ms, the stop is shown in the stage, never moves more than a pixel, keeps
 * focus, and once the strip rests its scene is current and announced. Returns how many Tabs crossed.
 */
async function tabIntoLaterScenes(page: Page): Promise<number> {
  const { scenes } = await read(page);
  const total = scenes.length;
  let crossed = 0;
  for (const from of [2, 5, 8, 11]) {
    await page.locator(`#${scenes[from]} a[href]`).last().focus();
    await expectAt(page, from);
    await page.keyboard.press('Tab');
    const seen = await page.evaluate(async (ids) => {
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      await frame();
      await frame();
      await new Promise((done) => setTimeout(done, 50));
      const active = document.activeElement as HTMLElement;
      const to = ids.findIndex((id) => document.getElementById(id)?.contains(active));
      const first = active.getBoundingClientRect();
      const stage = document.querySelector('.hc-stage')!.getBoundingClientRect();
      const shown =
        first.width > 0 &&
        first.left >= stage.left - 0.5 &&
        first.right <= stage.right + 0.5 &&
        first.top >= 0 &&
        first.bottom <= window.innerHeight;
      let moved = 0;
      const end = performance.now() + 800;
      while (performance.now() < end) {
        await frame();
        const now = active.getBoundingClientRect();
        moved = Math.max(moved, Math.abs(now.left - first.left), Math.abs(now.top - first.top));
      }
      return { to, shown, still: moved <= 1, focused: document.activeElement === active };
    }, scenes);
    if (seen.to <= from) continue;
    crossed += 1;
    expect(seen, `Tab from ${scenes[from]} into ${scenes[seen.to]}`).toEqual({
      to: seen.to,
      shown: true,
      still: true,
      focused: true,
    });
    await expectAt(page, seen.to);
    await expectAnnounced(page, seen.to, total);
  }
  return crossed;
}

test(
  'a Tab into a later scene steps the strip there at once: what it reached holds still in view, and the status names its scene once the strip rests',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    expect(await tabIntoLaterScenes(page)).toBeGreaterThanOrEqual(2);
  },
);

test(
  'a larger text size fits the strip again at once, top to bottom where its scenes no longer fit',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true });
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
  },
);

test(
  'at 1440 by 900 the strip pins with its rail whole: nothing on the bar overlaps or runs out of it',
  { annotation },
  async ({ page }) => {
    await load(page);
    expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true, fit: null });
    expect(await railClashes(page)).toEqual([]);
  },
);

test(
  "a rail that can't hold its labels stacks the strip top to bottom",
  { annotation },
  async ({ page }) => {
    await crowdRail(page);
    await load(page);
    await expect
      .poll(async () => {
        const { layout, pinned, fit } = await read(page);
        return { layout, pinned, fit };
      })
      .toEqual({ layout: 'vertical', pinned: false, fit: 'over' });
  },
);

for (const [width, height] of [
  [1024, 768],
  [1280, 800],
] as const) {
  test(
    `at ${width} by ${height} nothing on the rail under the stage overlaps or runs out of its bar`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await load(page);
      expect(await railClashes(page)).toEqual([]);
    },
  );
}

test.describe('reduced motion', () => {
  test(
    'the strip stays, and every step is a cut onto its scene',
    { annotation, tag },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await load(page);
      expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true });
      await page.locator('.hc-stage').focus();
      for (const index of [1, 2, 3]) {
        await page.keyboard.press('ArrowRight');
        // A cut: the scene is at the stage's start straight away, with no travel to wait for.
        expect((await read(page)).onScreen).toBe(index);
        await expectAt(page, index);
      }
    },
  );

  test(
    'a Tab into a later scene is a cut there too, and the steps after it still cut',
    { annotation, tag },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await load(page);
      expect(await tabIntoLaterScenes(page)).toBeGreaterThanOrEqual(2);
      // The keys from where the Tabs left the strip: each step still lands at once.
      const from = (await read(page)).current;
      await page.locator('.hc-stage').focus();
      for (const index of [from + 1, from + 2]) {
        await page.keyboard.press('ArrowRight');
        expect((await read(page)).onScreen).toBe(index);
        await expectAt(page, index);
      }
    },
  );
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'every scene reads in a native scroller, with no pin and no live controller',
    { annotation, tag },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      const state = await page.evaluate(() => ({
        scenes: document.querySelectorAll('.hc-track .hc-scene').length,
        pinned: document.querySelector('.hc-shell')!.hasAttribute('data-pin'),
        live: document.querySelectorAll('.hc-scrub[data-live]').length,
        scroller: getComputedStyle(document.querySelector('.hc-stage')!).overflowX,
      }));
      expect(state.scenes).toBeGreaterThan(5);
      expect(state).toMatchObject({ pinned: false, live: 0, scroller: 'auto' });
    },
  );

  test(
    "a link to a later scene glides the native scroller there, the stage's own smooth scroll",
    { annotation, tag },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      expect(await page.evaluate(() => document.querySelector('.hc-stage')!.scrollLeft)).toBe(0);
      // A link to a scene far along the strip, as a contents link or a typed fragment follows it.
      await page.evaluate(() => {
        const scenes = document.querySelectorAll('.hc-track .hc-scene');
        location.hash = `#${scenes[scenes.length - 2]!.id}`;
      });
      // Sampled as it goes: a glide passes through places between, a jump lands in one step.
      const seen = new Set<number>();
      for (let sample = 0; sample < 40; sample++) {
        seen.add(
          Math.round(await page.evaluate(() => document.querySelector('.hc-stage')!.scrollLeft)),
        );
      }
      await page.waitForTimeout(1500);
      const end = Math.round(
        await page.evaluate(() => document.querySelector('.hc-stage')!.scrollLeft),
      );
      expect(end).toBeGreaterThan(0);
      const between = [...seen].filter((at) => at > 0 && at < end);
      expect(between.length, `stage scrollLeft samples: ${[...seen].join(', ')}`).toBeGreaterThan(
        1,
      );
    },
  );
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test(
    'the scenes read top to bottom, the chapter sheet lands on its chapter, and a folded scene opens for its link',
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      expect(await read(page)).toMatchObject({ layout: 'vertical', pinned: false });
      // The chapter control on the top edge opens the sheet; a chapter in it lands on its card.
      await page.locator('.hc-jump__button').click();
      const sheet = page.locator('.hc-jump__sheet');
      await expect(sheet).toBeVisible();
      // Its chapters are the sheet's top-level links; each chapter's scenes are listed under it.
      await sheet.locator(':scope > ol > li > a').nth(2).click();
      await expect(sheet).toBeHidden();
      await expect.poll(() => page.evaluate(() => location.hash)).toBe('#chapter-journey');
      // A scene in the sheet is one tap from it too: two taps reach any scene from anywhere.
      await page.locator('.hc-jump__button').click();
      await sheet.locator('.hc-jump__scenes a').first().click();
      await expect(sheet).toBeHidden();
      const sceneHash = await page.evaluate(() => location.hash);
      expect(sceneHash).toMatch(/^#(scene-\d+|chapter-[a-z]+)$/);
      const { scenes: placed } = await read(page);
      await expectAt(page, placed.indexOf(sceneHash.slice(1)), { landed: true });
      // The quieter scenes fold to their title; a link to one opens it and lands on it.
      const folded = page.locator('details[data-fold]');
      expect(await folded.count(), 'the complete fixture has scenes that fold').toBeGreaterThan(0);
      await expect(folded.first()).not.toHaveAttribute('open', '');
      const id = await folded.first().evaluate((one) => one.closest('.hc-scene')!.id);
      const { scenes } = await read(page);
      await load(page, `/#${id}`);
      await expect(page.locator(`[id="${id}"] details[data-fold]`)).toHaveAttribute('open', '');
      await expectAt(page, scenes.indexOf(id), { landed: true });
    },
  );

  test(
    'turning the phone to landscape and back keeps the chapter it was on',
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

  test(
    'a tap in the sheet on the chapter the URL already names lands on it and keeps it, a short card too',
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      const { scenes } = await read(page);
      const craft = scenes.indexOf('chapter-craft');
      expect(craft).toBeGreaterThan(0);
      // The URL names the chapter already, with no landing of the page's own on it.
      await page.evaluate(() => history.replaceState(history.state, '', '#chapter-craft'));
      await page.locator('.hc-jump__button').click();
      // The same fragment fires no hashchange, but the tap lands as any link does.
      await page.locator('.hc-jump__sheet').locator(':scope > ol > li > a').nth(3).click();
      await expectAt(page, craft, { landed: true });
      await page.waitForTimeout(600);
      expect((await read(page, { landed: true })).current).toBe(craft);
    },
  );

  test(
    'reading on down, the next scene is current as soon as it crosses the reading line',
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      const { scenes } = await read(page);
      // A scene taller than the reading line's depth, so resting with it at the top reads it, and a scene after it.
      const at = await page.evaluate(() =>
        [...document.querySelectorAll('.hc-track .hc-scene')].findIndex(
          (scene, index, all) =>
            index >= 2 &&
            index < all.length - 1 &&
            scene.getBoundingClientRect().height > innerHeight * 0.45,
        ),
      );
      expect(at, 'the fixture has a tall scene with one after it').toBeGreaterThanOrEqual(2);
      // The reader brings it to the top and rests there; the controller writes it to the URL.
      await page.evaluate(
        (index) =>
          document
            .querySelectorAll('.hc-track .hc-scene')
            [index]!.scrollIntoView({ block: 'start', behavior: 'instant' }),
        at,
      );
      await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${scenes[at]}`);
      await expectAt(page, at);
      // Then scrolls on until the next scene's top crosses the reading line, this one still on screen.
      await page.evaluate((index) => {
        const next = document.querySelectorAll('.hc-track .hc-scene')[index + 1]!;
        const by = next.getBoundingClientRect().top - innerHeight * 0.3 + 8;
        window.scrollBy({ top: by, behavior: 'instant' });
      }, at);
      await expectAt(page, at + 1);
    },
  );
});
