import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import {
  arrivedAt,
  crowdRail,
  expectAnnounced,
  expectAt,
  expectLayout,
  keys,
  load,
  railClashes,
  read,
  renderedLayout,
  tabIntoLaterScenes,
  widenRailYears,
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
    // The strip moved with the page, and once the scroll rests it sits on a scene's start.
    await expect.poll(async () => (await read(page)).current).toBeGreaterThan(0);
    const travelled = await read(page);
    expect(travelled.along).toBeGreaterThan(0);
    await expectAt(page, travelled.current);
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
    // The next notch goes the moment the snap arrives, read in the page frame by frame, before the
    // controller's own settle there (150 ms) could take the arrival as a rest: only where the snap
    // itself sets out from the scene it reaches does that notch travel on rather than come back.
    for (const index of [1, 2]) {
      await page.mouse.wheel(0, 200);
      expect(await arrivedAt(page, index), `the snap reaches scene ${index}`).toBe(true);
    }
    await page.mouse.wheel(0, -200);
    await expectAt(page, 1);
    expect((await read(page)).along).toBeGreaterThan(0);
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
    // Soon after it rests, not once a stalled step's safety net gives up, the scene the page
    // rests on is the one marked current.
    await expect
      .poll(
        async () => {
          const state = await read(page);
          return state.onScreen > 1 && state.current === state.onScreen;
        },
        { timeout: 2000 },
      )
      .toBe(true);
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

test(
  'a Tab into a later scene steps the strip there at once: what it reached holds still in view, and the status names its scene once the strip rests',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    expect(await tabIntoLaterScenes(page)).toBeGreaterThanOrEqual(2);
  },
);

test(
  'a Shift+Tab back into an earlier scene steps the strip there at once too: what it reached holds still in view, and the status names its scene once the strip rests',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    expect(await tabIntoLaterScenes(page, { back: true })).toBeGreaterThanOrEqual(2);
  },
);

/**
 * The page's scroll, frame by frame, from just before `act` until it has held still for 30 frames
 * after moving (at most 3 s).
 */
async function framesOf(page: Page, act: () => Promise<unknown>): Promise<number[]> {
  await page.evaluate(() => {
    const w = window as unknown as { hcFrames: Promise<number[]> };
    w.hcFrames = new Promise((done) => {
      const frames = [window.scrollY];
      const end = performance.now() + 3000;
      let still = 0;
      const tick = () => {
        const at = window.scrollY;
        still = at === frames[frames.length - 1] ? still + 1 : 0;
        frames.push(at);
        const moved = frames.some((y) => y !== frames[0]);
        if (performance.now() > end || (moved && still >= 30)) done(frames);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  await act();
  return page.evaluate(() => (window as unknown as { hcFrames: Promise<number[]> }).hcFrames);
}

/**
 * How many distinct places a move's last leg passed through on its way to rest: from the last place
 * the page held for three frames short of where it rests. A cut passes through none.
 */
function glidePlaces(frames: number[]): number {
  const rest = frames[frames.length - 1]!;
  let from = frames[0]!;
  for (let i = 0; i + 2 < frames.length; i++) {
    if (frames[i] !== rest && frames[i] === frames[i + 1] && frames[i] === frames[i + 2])
      from = frames[i]!;
  }
  const [low, high] = [Math.min(from, rest) + 1, Math.max(from, rest) - 1];
  return new Set(frames.filter((y) => y > low && y < high)).size;
}

test(
  'a wheel notch, Next and Previous still glide: only a focus moved into another scene cuts',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true, current: 0 });
    // One notch rests short of the next scene, and the snap glides the strip on onto it.
    await page.mouse.move(720, 450);
    const wheel = await framesOf(page, () => page.mouse.wheel(0, 400));
    expect(glidePlaces(wheel), `wheel: ${wheel.join(' ')}`).toBeGreaterThanOrEqual(2);
    const after = (await read(page)).current;
    expect(after).toBeGreaterThan(0);
    await expectAt(page, after);
    const next = await framesOf(page, () =>
      page.getByRole('button', { name: 'Next scene' }).click(),
    );
    expect(glidePlaces(next), `Next: ${next.join(' ')}`).toBeGreaterThanOrEqual(2);
    await expectAt(page, after + 1);
    const previous = await framesOf(page, () =>
      page.getByRole('button', { name: 'Previous scene' }).click(),
    );
    expect(glidePlaces(previous), `Previous: ${previous.join(' ')}`).toBeGreaterThanOrEqual(2);
    await expectAt(page, after);
  },
);

test(
  'a larger text size fits the strip again at once, top to bottom where its scenes no longer fit',
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

/**
 * Stacked by a crowded rail at 1440 by 900, which holds on macOS and on CI Linux alike, so the chapter
 * control shows on the top edge: opens the chapter sheet from it by Enter, and returns the sheet's links.
 * Opened, the sheet has focus on the chapter the reader is in.
 */
async function openSheet(page: Page) {
  await crowdRail(page);
  await load(page);
  await expectLayout(page, 'stacked');
  const sheet = page.locator('.hc-jump__sheet');
  await page.locator('.hc-jump__button').focus();
  await page.keyboard.press('Enter');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('a[aria-current]')).toBeFocused();
  return { sheet, links: sheet.locator('a[href]') };
}

test(
  'stacked, Tab in the open chapter sheet goes on link by link, and from its last link round to its first',
  { annotation, tag },
  async ({ page }) => {
    const { links } = await openSheet(page);
    // Inside the sheet a Tab is the browser's own: from the first link to the second.
    await links.first().focus();
    await page.keyboard.press('Tab');
    await expect(links.nth(1)).toBeFocused();
    // At the end it goes round, so a Tab never leaves the open sheet for the page under it.
    await links.last().focus();
    await page.keyboard.press('Tab');
    await expect(links.first()).toBeFocused();
  },
);

test(
  'stacked, Shift+Tab in the open chapter sheet goes from its first link round to its last',
  { annotation, tag },
  async ({ page }) => {
    const { links } = await openSheet(page);
    await links.first().focus();
    await page.keyboard.press('Shift+Tab');
    await expect(links.last()).toBeFocused();
  },
);

test(
  'stacked, Escape closes the open chapter sheet and gives focus back to the chapter control',
  { annotation, tag },
  async ({ page }) => {
    const { sheet } = await openSheet(page);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page.locator('.hc-jump__button')).toBeFocused();
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
      // Which layout the complete fixture renders here can differ by platform: at 1024 by 768 it
      // pins on macOS, and its layout on CI Linux is CI's to show. So the test reads the layout the
      // page rendered and checks that one's contract: pinned, the rail shows and holds its labels;
      // stacked, no bar is drawn.
      await renderedLayout(page);
      expect(await railClashes(page)).toEqual([]);
    },
  );
}

test(
  "at 1440 by 900, a rail whose years don't fit shortens them and keeps the strip pinned, its labels clear",
  { annotation },
  async ({ page }) => {
    await widenRailYears(page);
    await load(page);
    await expect
      .poll(async () => {
        const { layout, pinned, fit } = await read(page);
        const rail = await page.locator('.hc-shell').getAttribute('data-rail');
        return { layout, pinned, fit, rail };
      })
      .toEqual({ layout: 'horizontal', pinned: true, fit: null, rail: 'short' });
    expect(await railClashes(page)).toEqual([]);
  },
);

for (const [width, height] of [
  [1024, 768],
  [1152, 864],
  [1280, 800],
  [1366, 768],
] as const) {
  test(
    `at ${width} by ${height} a resize that changes nothing leaves the fit and the rail as they were`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await load(page);
      const marks = () =>
        page.evaluate(() => {
          const shell = document.querySelector('.hc-shell')!;
          return { fit: shell.getAttribute('data-fit'), rail: shell.getAttribute('data-rail') };
        });
      const before = await marks();
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(600);
      expect(await marks()).toEqual(before);
    },
  );
}

test(
  "at 1024 by 768 the rail is fitted on the bar the visitor gets, before the page's load comes",
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    // A picture that answers only after 3 s holds the page's load, so nothing measured at load can
    // stand in for the fit the controller makes as it starts.
    await page.route('**/__held-load.png', async (route) => {
      await new Promise((done) => setTimeout(done, 3000));
      await route.fulfill({ status: 404, body: '' });
    });
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const held = new Image();
        held.src = '/__held-load.png';
        document.body.append(held);
      });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.hc-scrub[data-live]')).toHaveCount(1);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
    expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
    // The live bar, its transport and status in, holds its rail, or the strip has stacked: the
    // layout as it is now, before load, which differs by platform here (see the rail loop above).
    await renderedLayout(page, { wait: false });
    expect(await railClashes(page)).toEqual([]);
  },
);

test(
  "a pointer's click on a link in a later scene already in view lands on that link: the strip holds still under it",
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const { scenes } = await read(page);
    // Step on until the current scene is four columns wide and the next one shows a link wholly in
    // the stage: the scene a press lands in is then a later one, in view, as a reader sees it.
    await page.locator('.hc-stage').focus();
    let found: { at: number; id: string; nth: number } | null = null;
    for (let at = 1; at < scenes.length - 1 && !found; at++) {
      await page.keyboard.press('ArrowRight');
      await expectAt(page, at);
      await page.waitForTimeout(300);
      found = await page.evaluate(
        ([here, next, index]) => {
          if (document.getElementById(here!)?.dataset.w !== '4') return null;
          const stage = document.querySelector('.hc-stage')!.getBoundingClientRect();
          const links = [...document.querySelectorAll<HTMLElement>(`#${next} a[href]`)];
          const nth = links.findIndex((link) => {
            const box = link.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.left >= stage.left &&
              box.right <= stage.right &&
              box.top >= stage.top &&
              box.bottom <= stage.bottom
            );
          });
          return nth < 0 ? null : { at: index as number, id: next!, nth };
        },
        [scenes[at], scenes[at + 1], at] as const,
      );
    }
    expect(found, "a four-column scene with a later scene's link in view").not.toBeNull();
    const { at, id, nth } = found!;
    const link = page.locator(`#${id} a[href]`).nth(nth);
    await link.evaluate((element) => {
      element.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          (window as unknown as { clicked?: boolean }).clicked = true;
        },
        { once: true },
      );
    });
    // A real press: down, held 120 ms, up, as a hand clicks. Chromium focuses the link as it goes down.
    await link.click({ delay: 120 });
    expect(await page.evaluate(() => (window as unknown as { clicked?: boolean }).clicked)).toBe(
      true,
    );
    await page.waitForTimeout(500);
    expect((await read(page)).current).toBe(at);
  },
);

// The pin's snap, taken over. Seen from the page, its glide eases in over its first 70 to 80 ms, a
// fifth of the way at most, then reaches its scene in one frame (a probe at 1440 by 900, row 53 r2),
// so a visitor's hand takes it over inside those first frames. What finishes the travel is the way
// their own input went, never the page's place: the browser's own scroll can step back a little as
// it takes a glide over, and an instant scroll by script is folded into the glide, not a stop. A
// wheel notch against the glide in those first frames is one Chromium doesn't apply: the page never
// steps back, and the glide goes on to its scene (r2/probe-de, on base and on the rework alike).

/** Waits until the snap has set out from `from` the way `way` goes, `by` px: inside its first frames. */
async function glideSetOut(page: Page, from: number, way: 1 | -1, by = 8): Promise<void> {
  await page.waitForFunction(
    ([from, way, by]) => (way > 0 ? window.scrollY >= from + by : window.scrollY <= from - by),
    [from, way, by] as const,
    { polling: 'raf' },
  );
}

/** Scene `index` is current and on screen, and still is a second later: nothing carries it on or back. */
async function expectRestsOn(page: Page, index: number): Promise<void> {
  await expectAt(page, index);
  for (let wait = 0; wait < 1000; wait += 100) {
    await page.waitForTimeout(100);
    expect((await read(page)).current).toBe(index);
  }
}

/** From rest at the strip's start, a 200 px notch; the snap then glides on toward scene 1. */
async function snapFromStart(page: Page): Promise<void> {
  await load(page);
  await page.locator('.hc-stage').focus();
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(() => window.scrollY >= 200, undefined, { polling: 'raf' });
  await glideSetOut(page, 200, 1);
}

test(
  "the pin's snap, taken over by a key's scroll inside its glide, finishes on the scene ahead",
  { annotation, tag },
  async ({ page }) => {
    await snapFromStart(page);
    await page.keyboard.press('ArrowDown');
    await expectRestsOn(page, 1);
  },
);

// A guard, not a pin: the snap before the rework passes it too, 10 of 10, so it keeps the rework from
// turning back a notch the way the glide goes; it doesn't prove the rework.
test(
  "the pin's snap, taken over by a wheel notch the way it glides, still finishes on the scene ahead",
  { annotation, tag },
  async ({ page }) => {
    await snapFromStart(page);
    await page.mouse.wheel(0, 40);
    await expectRestsOn(page, 1);
  },
);

// A guard, not a pin: the snap before the rework finishes there too, so it keeps the rework from
// reading the unapplied notch as a turn. A notch back once the snap has arrived turns the strip back
// (the slow wheel's last notch, and the notch that comes as the snap arrives back on a scene).
test(
  "the pin's snap, a wheel notch against it during its eased frames, finishes on scene 1 and stays",
  { annotation, tag },
  async ({ page }) => {
    await snapFromStart(page);
    await page.mouse.wheel(0, -40);
    await expectRestsOn(page, 1);
  },
);

test(
  "the pin's snap, moved by a script's scroll inside its glide and by no input, finishes where it glided",
  { annotation, tag },
  async ({ page }) => {
    // As the scroll bar, find in page or a link move the page: no input of the visitor's says which
    // way, so the glide's own scene stands.
    await snapFromStart(page);
    await page.evaluate(() => window.scrollTo({ top: window.scrollY + 60, behavior: 'instant' }));
    await expectRestsOn(page, 1);
  },
);

// A guard, not a pin: base turns back here too. It keeps a snap with no input from reading every
// stop short as one the way it glided: a move against the glide turns it back.
test(
  "the pin's snap, moved back by a script's scroll inside its glide and by no input, as the scroll bar drags it, finishes on the scene it left",
  { annotation, tag },
  async ({ page }) => {
    await snapFromStart(page);
    await page.evaluate(() => window.scrollTo({ top: window.scrollY - 60, behavior: 'instant' }));
    await expectRestsOn(page, 0);
  },
);

test(
  "the pin's snap, a notch that comes as it arrives back on a scene travels on from that scene",
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await page.locator('.hc-stage').focus();
    for (const at of [1, 2, 3]) {
      await page.keyboard.press('ArrowRight');
      await expectAt(page, at);
    }
    await page.waitForTimeout(400);
    const three = (await read(page)).scrollY;
    // Back a notch from scene 3: the snap glides back to scene 2. A notch on, sent 100 px into that
    // glide, comes as it reaches scene 2 (its last eased frame or the one after), and travels on to 3.
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, -300);
    await page.waitForFunction((y) => window.scrollY <= y + 1, three - 300, { polling: 'raf' });
    await glideSetOut(page, three - 300, -1, 100);
    await page.mouse.wheel(0, 40);
    await expectRestsOn(page, 3);
  },
);

test(
  'a 3 px wheel nudge from rest on a scene returns to that scene, never on to the next',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await page.locator('.hc-stage').focus();
    for (const at of [1, 2]) {
      await page.keyboard.press('ArrowRight');
      await expectAt(page, at);
    }
    await page.waitForTimeout(400);
    const two = (await read(page)).scrollY;
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 3);
    await expectRestsOn(page, 2);
    expect(Math.abs((await read(page)).scrollY - two)).toBeLessThanOrEqual(1);
  },
);

test(
  "coming back up from the credits, a stop just inside the strip's end keeps the end in view",
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await page.locator('.hc-stage').focus();
    await page.keyboard.press('End');
    await expect.poll(async () => (await read(page)).atEnd).toBe(true);
    await page.waitForTimeout(400);
    const end = (await read(page)).scrollY;
    // Into the credits, at rest there, then back up to 100 px inside the strip's end.
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), end + 300);
    await page.waitForTimeout(300);
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), end - 100);
    await expect.poll(async () => (await read(page)).atEnd).toBe(true);
    for (let wait = 0; wait < 1000; wait += 100) {
      await page.waitForTimeout(100);
      expect((await read(page)).atEnd).toBe(true);
    }
  },
);

test(
  "with a block above the strip, a first wheel notch from the page's top still travels on to scene 1",
  { annotation, tag },
  async ({ page }) => {
    // The strip then starts 24 px down the page: a notch from the top sets out from above it.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const block = document.createElement('div');
        block.style.blockSize = '24px';
        document.body.prepend(block);
      });
    });
    await load(page);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 400);
    await expectAt(page, 1);
  },
);

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
