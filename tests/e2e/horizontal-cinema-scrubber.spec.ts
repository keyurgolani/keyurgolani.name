import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { expectAnnounced, expectAt, frames, load, read } from './horizontal-cinema-model';

// Horizontal Cinema's strip hides its stage's own scrollbar, so its scrubber is the stage's bar,
// and it does that bar's whole job, each part its own test, on the complete fixture at 1440x900:
// Previous and Next reach every scene from the keyboard, focus visible, the status saying each
// one; the minimap's window tracks the stage's span as the reader scrolls by wheel, by a
// trackpad's sideways swipe and by touch; a click on a chapter, or on a scene's block in it, goes
// there; and under forced colors the scrubber stays visible and works in the system's colors.
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

/** The minimap's window as the page draws it, and the stage's span, each as a share of the strip. */
const windowAndSpan = (page: Page) =>
  page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.hc-stage')!;
    const map = document.querySelector<HTMLElement>('.hc-minimap')!;
    const window = document.querySelector<HTMLElement>('.hc-minimap__window')!;
    const blocks = document.querySelector('.hc-minimap ol')!.getBoundingClientRect();
    const box = window.getBoundingClientRect();
    return {
      drawn: {
        start: (box.left - blocks.left) / blocks.width,
        size: box.width / blocks.width,
      },
      set: {
        start: Number.parseFloat(map.style.getPropertyValue('--layout-window-start')) / 100,
        size: Number.parseFloat(map.style.getPropertyValue('--layout-window-size')) / 100,
      },
      span: {
        start: Math.abs(stage.scrollLeft) / stage.scrollWidth,
        size: stage.clientWidth / stage.scrollWidth,
      },
    };
  });

async function expectTracks(page: Page, how: string) {
  await expect
    .poll(
      async () => {
        const { set, span } = await windowAndSpan(page);
        return Math.abs(set.start - span.start) < 0.02 && Math.abs(set.size - span.size) < 0.02;
      },
      { message: `${how}: the window's start and size are the stage's span` },
    )
    .toBe(true);
  // Drawn where it's set, once the window's own move has landed.
  await expect
    .poll(
      async () => {
        const { drawn, set } = await windowAndSpan(page);
        return Math.abs(drawn.start - set.start) < 0.02;
      },
      { message: `${how}: drawn where it's set` },
    )
    .toBe(true);
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
  "the minimap's window tracks the stage's span as the reader scrolls by wheel, by a trackpad's swipe and by touch",
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await expectTracks(page, 'at load');
    // A wheel: the page's own scroll travels the pinned strip.
    await page.mouse.move(720, 450);
    for (let notch = 0; notch < 3; notch++) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(80);
    }
    await expect.poll(async () => (await read(page)).along).toBeGreaterThan(0);
    await expectTracks(page, 'the wheel');
    await shot(page, 'window-wheel');
    // A trackpad's sideways swipe, over the stage, toward the end with more room: the wheel may
    // have carried the strip to its end.
    const before = (await read(page)).along;
    const room = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('.hc-stage')!;
      return stage.scrollWidth - stage.clientWidth;
    });
    const way = before < room / 2 ? 1 : -1;
    for (let swipe = 0; swipe < 3; swipe++) {
      await page.mouse.wheel(500 * way, 0);
      await page.waitForTimeout(80);
    }
    await expect.poll(async () => (await read(page)).along).not.toBe(before);
    await expectTracks(page, 'the swipe');
    // Touch: a finger drags the stage sideways.
    const touched = (await read(page)).along;
    // The finger moves against the way the strip should go: left to go on, right to go back.
    const toward = touched < room / 2 ? -1 : 1;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizeScrollGesture', {
      x: 720,
      y: 400,
      xDistance: 600 * toward,
      yDistance: 0,
      gestureSourceType: 'touch',
      speed: 1200,
    });
    await cdp.detach();
    await expect.poll(async () => (await read(page)).along).not.toBe(touched);
    await expectTracks(page, 'touch');
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
