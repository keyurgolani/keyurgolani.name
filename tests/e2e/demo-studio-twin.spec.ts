import { createRequire } from 'node:module';
import type { Locator, Page } from '@playwright/test';
import type * as PreviewScheduler from '../../apps/web/src/lib/studio/preview-scheduler';
import type * as FrameGate from '../../apps/web/src/app/(studio)/_components/demo/frame-gate';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import {
  checkedIn,
  DEMO_FRAME,
  openTask,
  optionsIn,
  pick,
  picker,
  reveal,
} from '../harness/studio-tasks';
import { decodePng, type Image } from '../quality/lib/pixels';

// apps/web has no "type": "module", so its modules are CommonJS to Node and load through
// require(), as perf.spec.ts loads SETTLE_MS: the app's own limits, not copies of them.
const appRequire = createRequire(import.meta.url);
const { GRID_MAX_LIVE, MAX_LIVE, SETTLE_MS } = appRequire(
  '../../apps/web/src/lib/studio/preview-scheduler.ts',
) as typeof PreviewScheduler;
const { LOADING_TEXT } = appRequire(
  '../../apps/web/src/app/(studio)/_components/demo/frame-gate.ts',
) as typeof FrameGate;

// Demo Studio without the blank frame (P-5 slice 4; director C's round 4 P1-F
// and round 5b P2-5). A pick that needs a new document, such as a composition,
// used to remount the stage's iframe, so the stage showed its empty ground for
// as long as the next document took to load. The stage's frame is
// double-buffered now: the next document loads in a hidden second frame over
// the one on screen, which stays until the next one has painted. So across a
// pick the stage never shows zero document pixels for longer than the 300 ms
// show-delay (SETTLE_MS), and the page never holds more than MAX_LIVE frames.
// The swap is instant, so it's the same under reduced motion. Compare's frames
// still load in their one frame each, which the negative control below
// relies on: there, the same held load does blank the pane, so the pixel
// sampling can see a blank when there is one.
//
// And Compare loads its frames with no extra tap (the lead, P-5 slice 4): at a
// phone's width a fresh visitor sees #166's poster, but Compare is an action
// that asks for a preview, as a pick is, so its frame loads at once.

const DEMO = { type: 'profile', description: 'demo' };
const STUDIO = { type: 'route', description: '/studio' };

test.use({ appOptions: DEMO_APP });

/** How long the next /sample document is held back, well past the show-delay. */
const HOLD_MS = 2500;

/** Holds every /sample document back by HOLD_MS from now on. */
async function holdSample(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === '/sample',
    async (route) => {
      if (route.request().resourceType() === 'document') {
        await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      }
      await route.continue();
    },
  );
}

/**
 * Whether an image of a stage shows no document: all but 1% of its pixels one colour, the stage's
 * empty ground. A document, even a quiet one, has text, rules or images over far more than that.
 */
function blank(image: Image): boolean {
  const counts = new Map<number, number>();
  const total = image.width * image.height;
  for (let i = 0; i < total; i += 1) {
    // Quantised a little, so antialiasing at an edge is one colour, not many.
    const key =
      ((image.data[i * 4]! >> 3) << 10) |
      ((image.data[i * 4 + 1]! >> 3) << 5) |
      (image.data[i * 4 + 2]! >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const most = Math.max(...counts.values());
  return total - most < total * 0.01;
}

/** How far inside the stage's box a shot starts, so its rounded, antialiased edge is never in it. */
const INSET = 4;

/** The stage's box inset by INSET on every side, in whole pixels, for a shot of its inside. */
async function insideOf(stage: Locator) {
  const box = await stage.boundingBox();
  expect(box, 'the stage is on the page').not.toBeNull();
  return {
    x: Math.ceil(box!.x) + INSET,
    y: Math.ceil(box!.y) + INSET,
    width: Math.floor(box!.width) - 2 * INSET - 1,
    height: Math.floor(box!.height) - 2 * INSET - 1,
  };
}

/** Whether the inside of `stage` shows no document right now, on the page's next frame. */
async function blankNow(page: Page, stage: Locator): Promise<boolean> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  return blank(
    decodePng(await page.screenshot({ clip: await insideOf(stage), animations: 'allow' })),
  );
}

interface Sample {
  readonly at: number;
  readonly blank: boolean;
}

/**
 * Shoots `stage` over and over, as fast as the browser lets it, until `done` says so, and gives
 * back each shot's time and whether it was blank. Each shot is of the stage's inside where it is
 * at that moment, since a pick can move it (Compare's bar takes a line for what differs, and the
 * panes under it move down), and comes after the page's next frame, with the caret hidden as
 * Playwright hides it by default.
 */
async function sampleStage(
  page: Page,
  stage: Locator,
  done: () => Promise<boolean>,
): Promise<Sample[]> {
  const samples: Sample[] = [];
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    samples.push({ at: Date.now(), blank: await blankNow(page, stage) });
    if (await done()) break;
  }
  return samples;
}

/**
 * The longest stretch the samples show the stage blank: from its first blank shot to the next
 * shot that isn't, or to the last shot when none follows, so it's never shorter than it was.
 */
function longestBlank(samples: readonly Sample[]): number {
  let longest = 0;
  let from: number | null = null;
  for (const sample of samples) {
    if (sample.blank && from === null) from = sample.at;
    if (!sample.blank && from !== null) {
      longest = Math.max(longest, sample.at - from);
      from = null;
    }
  }
  if (from !== null) longest = Math.max(longest, samples.at(-1)!.at - from);
  return longest;
}

/** Starts counting the page's iframes at every change to its DOM, keeping the most it held. */
async function countFrames(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const count = () => document.querySelectorAll('iframe').length;
    const state = { most: count() };
    new MutationObserver(() => {
      state.most = Math.max(state.most, count());
    }).observe(document.body, { childList: true, subtree: true });
    Object.assign(window, { kgnFrames: state });
  });
  return () =>
    page.evaluate(() => (window as unknown as { kgnFrames: { most: number } }).kgnFrames.most);
}

const composition = (page: Page) => picker(page, 'Composition');

/** A ready composition other than the checked one. */
async function another(page: Page): Promise<string> {
  const current = await checkedIn(composition(page));
  const other = (await optionsIn(composition(page))).find((value) => value !== current);
  expect(other, 'the build offers a second composition').toBeDefined();
  return other!;
}

/** The single stage, its frame's document loaded and on screen alone. */
async function openSettled(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto('/studio');
  expect(response?.status()).toBe(200);
  await openTask(page, 'Appearance');
  const stage = page.locator('.studio-split__stage .preview-surface__stage');
  await expect(stage).toHaveAttribute('data-phase', 'ready');
  await expect(stage.locator('iframe')).toHaveCount(1);
  await expect(stage.locator(DEMO_FRAME)).toBeVisible();
  // The document painted, not only loaded: the stage is no longer its empty ground.
  await expect.poll(() => blankNow(page, stage)).toBe(false);
  return stage;
}

for (const motion of ['no-preference', 'reduce'] as const) {
  test(
    `across a composition pick the stage never shows zero document pixels for longer than the show-delay, in at most MAX_LIVE frames, with the motion ${motion === 'reduce' ? 'reduced' : 'as the system has it'} (C P1-F, P2-5)`,
    { annotation: [STUDIO, DEMO] },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      const stage = await openSettled(page);
      const most = await countFrames(page);
      const leaving = stage.locator('iframe[data-twin="leaving"]');
      const next = await another(page);
      await holdSample(page);

      const sampled = sampleStage(page, stage, async () => {
        const src = (await stage.locator(DEMO_FRAME).getAttribute('src')) ?? '';
        return (
          new RegExp(`[?&]variant=${next}(?:&|#|$)`).test(src) &&
          (await stage.getAttribute('data-phase')) === 'ready' &&
          (await stage.locator('iframe').count()) === 1
        );
      });
      await pick(composition(page), next);
      // Mid-swap: the document on screen stays, out of reach, under the one replacing it.
      await expect(leaving).toHaveCount(1);
      await expect(leaving).toHaveAttribute('aria-hidden', 'true');
      await expect(leaving).toHaveAttribute('tabindex', '-1');
      expect(await leaving.evaluate((node) => (node as HTMLElement).inert)).toBe(true);
      await expect(stage.locator('iframe[data-twin="incoming"]')).toHaveCount(1);
      await expect(stage).toHaveAttribute('aria-busy', 'true');
      // Past PENDING_MS the stage says the click took: a quiet mark over its corner, static, and
      // the same words in a polite live region beside it, outside its aria-busy.
      const mark = stage.locator('.demo-frame__pending');
      const status = page.locator('.demo-frame__status');
      await expect(mark).toHaveText(LOADING_TEXT);
      await expect(mark).toBeVisible();
      await expect(mark).toHaveAttribute('aria-hidden', 'true');
      await expect(status).toHaveText(LOADING_TEXT);
      await expect(status).toHaveAttribute('aria-live', 'polite');
      expect(await status.evaluate((node) => node.closest('[aria-busy]'))).toBeNull();
      // An instant swap, reduced motion or not: neither frame, the stage, nor the mark animates.
      expect(
        await stage.evaluate((node) =>
          [node, ...node.querySelectorAll('iframe, .demo-frame__pending')].map((each) => {
            const style = getComputedStyle(each);
            return `${style.transitionDuration} ${style.animationName}`;
          }),
        ),
      ).toEqual(['0s none', '0s none', '0s none', '0s none']);
      expect(await stage.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
      const samples = await sampled;

      // The pick was let through, its document held well past the show-delay, so a stage that
      // blanked while it loaded would show it here.
      expect(samples.length, 'the stage was shot through the swap').toBeGreaterThan(5);
      expect(
        longestBlank(samples),
        'no blank stage for longer than the show-delay',
      ).toBeLessThanOrEqual(SETTLE_MS);
      const frame = stage.locator(DEMO_FRAME);
      await expect(frame).toHaveAttribute('src', new RegExp(`[?&]variant=${next}(?:&|#|$)`));
      await expect(frame.contentFrame().locator('[data-variant]').first()).toHaveAttribute(
        'data-variant',
        next,
      );
      // Two frames during the swap, never more, and one once it's done.
      expect(await most(), 'the swap held the old and the new').toBe(MAX_LIVE);
      await expect(stage.locator('iframe')).toHaveCount(1);
      // Swapped: the mark goes, and the status empties.
      await expect(mark).toHaveCount(0);
      await expect(status).toHaveText('');
    },
  );
}

test(
  "a pick while the next document still loads replaces it, never adding a third frame, and the stage keeps the one it showed until the last pick's has painted",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    const stage = await openSettled(page);
    const most = await countFrames(page);
    const shown = await stage.locator(DEMO_FRAME).getAttribute('src');
    const current = await checkedIn(composition(page));
    const [first, second] = (await optionsIn(composition(page))).filter(
      (value) => value !== current,
    );
    expect(second, 'the build offers three compositions').toBeDefined();
    await holdSample(page);

    const sampled = sampleStage(page, stage, async () => {
      const src = (await stage.locator(DEMO_FRAME).getAttribute('src')) ?? '';
      return (
        new RegExp(`[?&]variant=${second}(?:&|#|$)`).test(src) &&
        (await stage.getAttribute('data-phase')) === 'ready' &&
        (await stage.locator('iframe').count()) === 1
      );
    });
    await pick(composition(page), first!);
    await expect(stage.locator('iframe[data-twin="incoming"]')).toHaveAttribute(
      'src',
      new RegExp(`[?&]variant=${first}(?:&|#|$)`),
    );
    // The first pick's document is still held back: the second replaces it in the incoming frame.
    await pick(composition(page), second!);
    await expect(stage.locator('iframe[data-twin="incoming"]')).toHaveAttribute(
      'src',
      new RegExp(`[?&]variant=${second}(?:&|#|$)`),
    );
    // The one on screen is still the one the stage showed before either pick.
    await expect(stage.locator('iframe[data-twin="leaving"]')).toHaveAttribute('src', shown!);
    const samples = await sampled;
    expect(longestBlank(samples)).toBeLessThanOrEqual(SETTLE_MS);
    expect(await most(), 'never a third frame').toBe(MAX_LIVE);
  },
);

test(
  "the stage's first document, with nothing on screen to keep, shows the stage's ground while it's held, so the sampling sees a blank on this stage when there is one (control)",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await holdSample(page);
    await page.goto('/studio');
    await openTask(page, 'Appearance');
    const stage = page.locator('.studio-split__stage .preview-surface__stage');
    await expect(stage.locator(DEMO_FRAME)).toHaveAttribute('src', /^\/sample\?/);
    const samples = await sampleStage(
      page,
      stage,
      async () =>
        (await stage.getAttribute('data-phase')) === 'ready' && !(await blankNow(page, stage)),
    );
    expect(longestBlank(samples), 'blank while the first document is held').toBeGreaterThan(
      SETTLE_MS,
    );
    await expect(stage.locator('iframe[data-twin]')).toHaveCount(0);
  },
);

test(
  "Compare's frames still load in their one frame each: the same held load blanks B's pane, so the stage's sampling sees a blank when there is one (negative control)",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await openSettled(page);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    // Side by side from the start, so the pick below changes B's document and not the layout.
    await page
      .getByRole('radiogroup', { name: 'Compare layout' })
      .locator('label[data-option="side"]')
      .click();
    const pane = page.locator('.studio-compare__pane[data-side="b"] .preview-surface__stage');
    await expect(pane).toHaveAttribute('data-phase', 'ready');
    await expect.poll(() => blankNow(page, pane)).toBe(false);
    const most = await countFrames(page);
    const next = await another(page);
    await holdSample(page);
    const sampled = sampleStage(page, pane, async () => {
      const src = (await pane.locator('iframe').getAttribute('src')) ?? '';
      return (
        new RegExp(`[?&]variant=${next}(?:&|#|$)`).test(src) &&
        (await pane.getAttribute('data-phase')) === 'ready' &&
        !(await blankNow(page, pane))
      );
    });
    await pick(composition(page), next);
    const samples = await sampled;
    expect(longestBlank(samples), 'B blanks while its document is held').toBeGreaterThan(SETTLE_MS);
    // A and B: two frames, and the twin never adds a third to Compare's.
    expect(await most()).toBe(MAX_LIVE);
    await expect(page.locator('iframe[data-twin]')).toHaveCount(0);
  },
);

test(
  'at a phone’s width a fresh visitor sees the poster, and one tap on Compare loads its frame with no Show preview (the lead, P-5 slice 4)',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/studio?task=appearance');
    await expect(
      page.getByRole('button', { name: 'Reset demo', includeHidden: true }).first(),
    ).toBeAttached();
    // #166's poster, for a visitor who hasn't acted yet.
    const ask = page.getByRole('button', { name: 'Show preview' });
    await expect(ask).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    const most = await countFrames(page);
    await reveal(composition(page));
    await page.locator('.studio-compare-phone').click();
    await expect(page.getByRole('group', { name: 'Compare A and B' })).toBeVisible();
    await expect(ask).toHaveCount(0);
    const frame = page.locator(`.studio-compare ${DEMO_FRAME}`);
    await expect(frame).toHaveAttribute('src', /^\/sample\?/);
    await expect(page.locator('.studio-compare .preview-surface__stage')).toHaveAttribute(
      'data-phase',
      'ready',
    );
    expect(await most()).toBeLessThanOrEqual(MAX_LIVE);
  },
);

test(
  'at the narrowest width with the Grid, where no poster applies, Compare and Vary: Scheme show A and three schemes as four live plates, within GRID_MAX_LIVE (the lead, P-5 slice 4)',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/studio?task=appearance');
    await expect(
      page.getByRole('button', { name: 'Reset demo', includeHidden: true }).first(),
    ).toBeAttached();
    const most = await countFrames(page);
    await reveal(composition(page));
    await page.getByRole('button', { name: 'Compare compositions' }).first().click();
    await page
      .getByRole('radiogroup', { name: 'Vary' })
      .locator('label[data-option="colorScheme"]')
      .click();
    await expect(page.locator('.studio-plate')).toHaveCount(4);
    await expect(page.locator('.studio-plate iframe')).toHaveCount(4, { timeout: 20_000 });
    await expect(page.locator('.studio-plate__view[data-compare-live="live"]')).toHaveCount(4);
    for (const each of await page.locator('.studio-plate iframe').all()) {
      await expect(each).toHaveAttribute('src', /^\/sample\?/);
    }
    await expect(page.getByRole('button', { name: 'Show preview' })).toHaveCount(0);
    expect(await most()).toBeLessThanOrEqual(GRID_MAX_LIVE);
  },
);
