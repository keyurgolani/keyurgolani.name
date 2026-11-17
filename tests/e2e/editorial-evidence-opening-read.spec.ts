import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { completeThrough, entriesFor, twoFrames } from './observer-deliveries';
import {
  heldFor,
  holdableObserverDeliveries,
  holdDeliveriesFor,
  releaseDeliveries,
} from './observer-hold';

// Editorial Evidence reads the opening again back at the top of the page, whatever the order its
// observer's entries arrive in. Where nothing covers the reading line at the very top, as larger
// type can leave it, the opening is also watched in the window under the line: in view there with
// its top below the line, it's the place being read, and no chapter is. A page that goes into the
// first chapter and back to the top before that watch's task runs delivers both entries in one
// call, oldest first; read from the first, the opening was out of view, and the first chapter
// stayed marked at the top. Here the opening is set down to start under the line, and its watch
// is held while the page goes to the first chapter's opener and back (observer-hold.ts), so its
// one delivery holds the opening out of view and then in view under the line; every other
// observer delivers as it goes, and marks the chapter on the way.

test.use({
  appOptions: completeThrough('editorial-evidence'),
  viewport: { width: 1440, height: 900 },
});

/** The chapters the chapter index marks as being read. */
const marked = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-ee-rail][data-current]')].map(
      (entry) => entry.dataset.eeRail ?? '',
    ),
  );

/** How far the opening's top is under the reading line, in px. */
const underLine = (page: Page) =>
  page.evaluate(() => {
    const spy = document.querySelector<HTMLElement>('.ee-spy')!;
    const line = Math.ceil(Number.parseFloat(getComputedStyle(spy).paddingBlockStart) || 0);
    return document.querySelector('.ee-opening')!.getBoundingClientRect().top - line;
  });

test(
  "with the opening's watch's entries delivered together, back at the top after a visit into the first chapter, no chapter stays marked",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    await holdableObserverDeliveries(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // The opening set down to start 24 px under the reading line, the page and all after it.
    const set = await underLine(page);
    if (set < 24) {
      await page.evaluate((by) => {
        const opening = document.querySelector<HTMLElement>('.ee-opening')!;
        opening.style.marginBlockStart = `${by}px`;
      }, 24 - set);
    }
    await twoFrames(page);
    expect(await underLine(page), "the opening's top under the reading line").toBeGreaterThan(0);
    // Its watch reads it, in view under the line, and no chapter is marked.
    await expect
      .poll(async () =>
        (await entriesFor(page, '.ee-opening', 0)).some((held) =>
          held.some(({ at, top, rootTop }) => at && rootTop !== null && top > rootTop),
        ),
      )
      .toBe(true);
    await twoFrames(page);
    expect(await marked(page), 'at the top').toEqual([]);
    await expect.poll(async () => (await heldFor(page, '.ee-opening')).length).toBe(1);
    const id = (await heldFor(page, '.ee-opening'))[0]!.id;
    // Held, into the first chapter, its opener just under the line, and back to the top.
    await holdDeliveriesFor(page, '.ee-opening');
    const first = await page.evaluate(async () => {
      const frames = () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 100))),
        );
      const spy = document.querySelector<HTMLElement>('.ee-spy')!;
      const line = Math.ceil(Number.parseFloat(getComputedStyle(spy).paddingBlockStart) || 0);
      const chapter = document.querySelector<HTMLElement>('[data-ee-chapter]')!;
      const opener = chapter.querySelector<HTMLElement>('.ee-chapter__open')!;
      window.scrollTo({
        top: window.scrollY + opener.getBoundingClientRect().top - line + 8,
        behavior: 'instant',
      });
      await frames();
      return chapter.dataset.eeChapter ?? '';
    });
    await expect.poll(() => marked(page), 'reading the first chapter').toEqual([first]);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await twoFrames(page);
    await page.waitForTimeout(100);
    // The same watch still watches the opening, and holds it out of view and then under the line.
    const watching = await heldFor(page, '.ee-opening');
    expect(
      watching.map((each) => each.id),
      "the opening's watch, not made again",
    ).toEqual([id]);
    const held = watching[0]!.held;
    const last = held.at(-1);
    expect(
      held.length > 1 &&
        !held[0]!.at &&
        last !== undefined &&
        last.at &&
        last.rootTop !== null &&
        last.top > last.rootTop,
      `the held entries, out of view and then under the line: ${JSON.stringify(held)}`,
    ).toBe(true);
    expect(await marked(page), 'back at the top, before the watch delivers').toEqual([first]);
    // In one call: the watch reads the latest, the opening is read, and no chapter is marked.
    await releaseDeliveries(page);
    await twoFrames(page);
    expect(await marked(page), 'back at the top').toEqual([]);
  },
);
