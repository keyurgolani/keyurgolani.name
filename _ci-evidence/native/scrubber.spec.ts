import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../../tests/harness/fixtures';
import {
  expectAnnounced,
  expectAt,
  frames,
  load,
  read,
} from '../../tests/e2e/horizontal-cinema-model';

// Horizontal Cinema's strip hides its stage's own scrollbar, so its scrubber is the stage's bar,
// and it does that bar's whole job, each part its own test, on the complete fixture at 1440x900:
// Previous and Next reach every scene from the keyboard, focus visible, the status saying each
// one; the minimap's window follows the scenes on screen, each on its own block, as the reader
// scrolls by wheel, by a trackpad's sideways swipe and by touch, each input sent and read with the
// strip at rest; a click on a chapter, or on a scene's block in it, goes there; and under forced
// colors the scrubber stays visible and works in the system's colors.
// SCRUB_SHOTS names a directory for a shot of each.

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

async function shot(page: Page, name: string) {
  const dir = process.env.SCRUB_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.locator('.hc-scrub').screenshot({ path: path.join(dir, `${name}.png`) });
}

/**
 * The strip at rest: where it stands along, the page's scroll and the status all unchanged across
 * two reads 250 ms apart, and the status naming the current scene. A wheel's travel ends in the
 * pin's snap gliding the page to a scene, and an input sent during that glide meets the glide,
 * not the strip. Fails after `within` ms with the last reads.
 */
async function atRest(page: Page, how: string, within = 10_000) {
  const reads: string[] = [];
  const until = Date.now() + within;
  for (;;) {
    const { along, scrollY, status, current, scenes } = await read(page);
    reads.push(JSON.stringify({ along, scrollY, status }));
    const named = status.endsWith(`${current + 1} of ${scenes.length}`);
    if (named && reads.length > 1 && reads.at(-1) === reads.at(-2)) return;
    if (Date.now() > until) break;
    await page.waitForTimeout(250);
  }
  throw new Error(
    `${how}: the strip never came to rest in ${within} ms; its last reads: ${reads.slice(-4).join(' ')}`,
  );
}

/**
 * The minimap's window, as set and as drawn, beside what the strip shows, each as a share of the
 * minimap, from the page's boxes alone: the first and last scenes on screen, how far into each
 * the stage's edges fall, and the same point on that scene's own block, which is where the
 * window's edges belong. The blocks aren't in proportion to the scenes' widths, so the stage's
 * scroll span is not the window.
 */
const windowAndScreen = (page: Page) =>
  page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.hc-stage')!;
    const map = document.querySelector<HTMLElement>('.hc-minimap')!;
    const bounds = map.getBoundingClientRect();
    const list = document.querySelector('.hc-minimap ol')!.getBoundingClientRect();
    const view = stage.getBoundingClientRect();
    const scenes = [...document.querySelectorAll<HTMLElement>('.hc-track .hc-scene')].map((scene) =>
      scene.getBoundingClientRect(),
    );
    const blocks = [...document.querySelectorAll('.hc-minimap__blocks i')].map((block) =>
      block.getBoundingClientRect(),
    );
    const onScreen = scenes.flatMap((box, index) =>
      Math.min(box.right, view.right) > Math.max(box.left, view.left) ? [index] : [],
    );
    const first = onScreen[0] ?? -1;
    const last = onScreen.at(-1) ?? -1;
    // A point on screen, as far into its block as it is into its scene.
    const onBlock = (index: number, x: number) => {
      const scene = scenes[index]!;
      const block = blocks[index]!;
      return block.left + ((x - scene.left) / scene.width) * block.width;
    };
    const from = first < 0 ? NaN : onBlock(first, Math.max(view.left, scenes[first]!.left));
    const to = last < 0 ? NaN : onBlock(last, Math.min(view.right, scenes[last]!.right));
    const start = Number.parseFloat(map.style.getPropertyValue('--layout-window-start')) / 100;
    const size = Number.parseFloat(map.style.getPropertyValue('--layout-window-size')) / 100;
    const drawn = document.querySelector('.hc-minimap__window')!.getBoundingClientRect();
    // The block a point on the minimap is in, half a pixel either side of it.
    const blockAt = (x: number) =>
      blocks.findIndex((block) => x >= block.left - 0.5 && x <= block.right + 0.5);
    return {
      rtl: getComputedStyle(stage).direction === 'rtl',
      counts: { scenes: scenes.length, blocks: blocks.length },
      set: { start, size },
      drawn: (drawn.left - list.left) / list.width,
      shows: { start: (from - bounds.left) / bounds.width, size: (to - from) / bounds.width },
      onScreen: { first, last },
      edges: {
        start: blockAt(bounds.left + start * bounds.width + 0.5),
        end: blockAt(bounds.left + (start + size) * bounds.width - 0.5),
      },
      span: Math.abs(stage.scrollLeft) / stage.scrollWidth,
    };
  });

type Tracked = { start: number; span: number };

/**
 * After an input, the strip at rest somewhere other than where it set out from: an input that
 * never travelled it leaves the window no move to follow, so that's named apart from the window's
 * own checks.
 */
async function expectTravelled(page: Page, how: string, from: number) {
  await atRest(page, how);
  const { along } = await read(page);
  expect(
    along,
    `${how}: the strip travelled from ${from}, so the window has a move to follow`,
  ).not.toBe(from);
}

/**
 * Once the strip is at rest, the window is what it shows: set where the stage's edges fall in the
 * first and last scenes on screen, each on its own block, with its edges in those two blocks, and
 * drawn where it's set. With `was`, the window moved the way the strip did since.
 */
async function expectTracks(page: Page, how: string, was?: Tracked): Promise<Tracked> {
  await atRest(page, how);
  const first = await windowAndScreen(page);
  expect(first.rtl, 'the fixture reads left to right').toBe(false);
  expect(first.counts.blocks, 'a block for every scene').toBe(first.counts.scenes);
  await expect
    .poll(
      async () => {
        const { set, shows } = await windowAndScreen(page);
        return Math.max(Math.abs(set.start - shows.start), Math.abs(set.size - shows.size));
      },
      { message: `${how}: the window is the scenes on screen, each on its own block` },
    )
    .toBeLessThan(0.01);
  const now = await windowAndScreen(page);
  expect(now.edges, `${how}: the window's edges are in the first and last scenes' blocks`).toEqual({
    start: now.onScreen.first,
    end: now.onScreen.last,
  });
  if (was)
    expect(
      Math.sign(now.set.start - was.start),
      `${how}: the window moved the way the strip did`,
    ).toBe(Math.sign(now.span - was.span));
  // Drawn where it's set, once the window's own move has landed.
  await expect
    .poll(
      async () => {
        const { drawn, set } = await windowAndScreen(page);
        return Math.abs(drawn - set.start);
      },
      { message: `${how}: drawn where it's set` },
    )
    .toBeLessThan(0.02);
  return { start: now.set.start, span: now.span };
}

/**
 * A step from the scrubber lands on scene `index`: it's current, and it's on screen, or the strip
 * is held at its end, where the last scenes share the window.
 */
async function expectStep(page: Page, index: number) {
  await expect
    .poll(async () => {
      const state = await read(page);
      return { current: state.current, shows: state.onScreen === index || state.atEnd };
    })
    .toEqual({ current: index, shows: true });
}

test(
  'from the keyboard, Next and Previous reach every scene, focus shows on them, and the status says each one',
  { annotation, tag },
  async ({ page }) => {
    // Every scene twice over, each step waited for: more than a default test's time. Reduced
    // motion lands each step at once, so the walk reads where Next and Previous go, not how fast
    // the strip glides there.
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await load(page);
    const { scenes } = await read(page);
    const next = page.getByRole('button', { name: 'Next scene' });
    const previous = page.getByRole('button', { name: 'Previous scene' });
    // Tab reaches Next, as a reader does: through the page, not from script.
    for (let press = 0; press < 80; press++) {
      await page.keyboard.press('Tab');
      if (await next.evaluate((button) => button === document.activeElement)) break;
    }
    await expect(next).toBeFocused();
    expect(await next.evaluate((button) => button.matches(':focus-visible'))).toBe(true);
    // Tab passes through the strip's scenes on its way, and the strip follows focus, so it may
    // stand anywhere, the last scene included, once it settles. From there Previous walks back to
    // the first scene, then Next walks on to the last: every scene, each one announced.
    await page.waitForTimeout(600);
    const from = (await read(page)).current;
    await previous.focus();
    expect(await previous.evaluate((button) => button.matches(':focus-visible'))).toBe(true);
    for (let index = from - 1; index >= 0; index--) {
      await page.keyboard.press('Enter');
      await expectStep(page, index);
      await expectAnnounced(page, index, scenes.length);
    }
    await expect(previous).toBeDisabled();
    await next.focus();
    for (let index = 1; index < scenes.length; index++) {
      await page.keyboard.press('Enter');
      await expectStep(page, index);
      await expectAnnounced(page, index, scenes.length);
      if (index === 1) await shot(page, 'keyboard-next');
    }
    await expect(next).toBeDisabled();
  },
);

test(
  "the minimap's window follows the scenes on screen as the reader scrolls by wheel, by a trackpad's swipe and by touch",
  { annotation, tag },
  async ({ page }) => {
    // Each input from rest, and each one's window read at rest: more than a default test's time.
    test.setTimeout(90_000);
    await load(page);
    let tracked = await expectTracks(page, 'at load');
    // A wheel: the page's own scroll travels the pinned strip.
    await page.mouse.move(720, 450);
    for (let notch = 0; notch < 3; notch++) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(80);
    }
    await expectTravelled(page, 'the wheel', 0);
    tracked = await expectTracks(page, 'the wheel', tracked);
    await shot(page, 'window-wheel');
    // A trackpad's sideways swipe, over the stage at rest, toward the end with more room: the
    // wheel may have carried the strip to its end. Sent as a trackpad sends one, precise deltas
    // with a start and an end, not a mouse's wheel notches, which Chromium on Linux animates one by
    // one: there three 500 px notches moved the strip 28 px before its snap took it back.
    const before = (await read(page)).along;
    const room = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('.hc-stage')!;
      return stage.scrollWidth - stage.clientWidth;
    });
    const way = before < room / 2 ? 1 : -1;
    const pad = await page.context().newCDPSession(page);
    // A scroll gesture's distance is the way the content moves: negative goes on, toward the end.
    await pad.send('Input.synthesizeScrollGesture', {
      x: 720,
      y: 400,
      xDistance: -1000 * way,
      yDistance: 0,
      gestureSourceType: 'mouse',
      speed: 1500,
    });
    await pad.detach();
    await expectTravelled(page, 'the swipe', before);
    tracked = await expectTracks(page, 'the swipe', tracked);
    // Touch: a finger drags the stage sideways, from rest, a press, its moves 16 ms apart and the
    // lift, as a touch screen sends them, 1000 px, more than any scene's half, so the strip's snap
    // takes it on rather than back. On Linux, Chromium's synthesized touch scroll gesture never
    // moved the strip.
    const touched = (await read(page)).along;
    // The finger moves against the way the strip should go: left to go on, right to go back.
    const [press, lift] = touched < room / 2 ? [1200, 200] : [200, 1200];
    const finger = await page.context().newCDPSession(page);
    await finger.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: press, y: 400 }],
    });
    for (let step = 1; step <= 25; step++) {
      await finger.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: press + ((lift - press) * step) / 25, y: 400 }],
      });
      await page.waitForTimeout(16);
    }
    await finger.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await finger.detach();
    await expectTravelled(page, 'touch', touched);
    await expectTracks(page, 'touch', tracked);
    await frames(page);
    await shot(page, 'window-touch');
  },
);

test(
  "a click on a chapter, or on a scene's block in it, goes to that chapter's scene",
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const firsts = await page.evaluate(() => {
      const scenes = [...document.querySelectorAll('.hc-minimap__blocks i')];
      return [...document.querySelectorAll('.hc-minimap__chapter')].map((chapter) =>
        scenes.indexOf(chapter.querySelector('.hc-minimap__blocks i')!),
      );
    });
    expect(firsts.length).toBeGreaterThan(2);
    await page.locator('.hc-minimap__chapter a').nth(1).click();
    await expectAt(page, firsts[1]!);
    await page
      .locator('.hc-minimap__chapter')
      .nth(2)
      .locator('.hc-minimap__blocks i')
      .first()
      .click();
    await expectAt(page, firsts[2]!);
    await expectAnnounced(page, firsts[2]!, (await read(page)).scenes.length);
  },
);

test(
  'under forced colors the scrubber stays visible and works in the system colors',
  { annotation, tag },
  async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await load(page);
    const parts = await page.evaluate(() => {
      const visible = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          size: box.width > 0 && box.height > 0,
          shown: style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0',
          edge: [style.borderTopColor, style.outlineColor, style.backgroundColor, style.color],
        };
      };
      return {
        next: visible('.hc-scrub__transport button:last-child'),
        previous: visible('.hc-scrub__transport button:first-child'),
        window: visible('.hc-minimap__window'),
        chapter: visible('.hc-minimap__chapter a'),
        status: visible('.hc-scrub__status'),
      };
    });
    for (const [part, seen] of Object.entries(parts)) {
      expect(seen, part).not.toBeNull();
      expect(seen!.size && seen!.shown, `${part} shows`).toBe(true);
      // Something of it is drawn: not every edge, fill and ink transparent.
      expect(
        seen!.edge.some((color) => color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent'),
        `${part}: ${seen!.edge.join(', ')}`,
      ).toBe(true);
    }
    await shot(page, 'forced-colors');
    await page.getByRole('button', { name: 'Next scene' }).click();
    await expectAt(page, 1);
    await page.locator('.hc-minimap__chapter a').nth(1).click();
    await expect.poll(async () => (await read(page)).current).toBeGreaterThan(1);
  },
);
