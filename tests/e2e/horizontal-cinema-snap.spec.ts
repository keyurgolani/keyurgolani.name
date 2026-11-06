import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { expectAt, expectSnapped, load, read } from './horizontal-cinema-model';

// Horizontal Cinema's pin snap follows the reader's own scroll only (complete fixture, 1440 by 900): a
// wheel, a touch, a press on the scroller or its scrollbar, or a scrolling key, each held until its
// scroll ends, finishes onto a scene; a scroll the page makes (scrollIntoView, a find-in-page match,
// assistive technology bringing its target into view) rests where it lands. A wheel or a touch is only
// noted, never cancelled, and the controller makes no scroll of its own for one.

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

const LATE = 'a[href$="#event-entry"] > .hc-timeline-figure__label > .hc-timeline-figure__title';

test(
  "a scroll the page makes to a long scene's far end rests where it lands",
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true });
    const late = page.locator(LATE);
    await late.scrollIntoViewIfNeeded();
    const box = await late.boundingBox();
    await page.waitForTimeout(1000);
    expect(await late.boundingBox()).toEqual(box);
  },
);

/** From the page at rest on scene 2 (two wheel notches), with focus on nothing in the strip. */
async function atSceneTwo(page: import('@playwright/test').Page): Promise<number> {
  await load(page);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 200);
  await expectAt(page, 1);
  await page.mouse.wheel(0, 200);
  await expectAt(page, 2);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return (await read(page)).scrollY;
}

test(
  'a wheel that stops between scenes finishes onto one',
  { annotation, tag },
  async ({ page }) => {
    const from = await atSceneTwo(page);
    await page.mouse.wheel(0, 300);
    await expectSnapped(page, from);
  },
);

for (const type of ['touchstart', 'pointerdown'] as const) {
  test(
    `a scroll under a ${type} that stops between scenes finishes onto one`,
    { annotation, tag },
    async ({ page }) => {
      const from = await atSceneTwo(page);
      await page.evaluate((type) => {
        document.documentElement.dispatchEvent(
          type === 'touchstart'
            ? new TouchEvent(type, { bubbles: true })
            : new PointerEvent(type, { bubbles: true }),
        );
        scrollBy({ top: 300, behavior: 'instant' });
      }, type);
      await expectSnapped(page, from);
    },
  );
}

for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Space', 'Home', 'End'] as const) {
  test(`${key}'s scroll finishes onto a scene`, { annotation, tag }, async ({ page }) => {
    const from = await atSceneTwo(page);
    await page.keyboard.press(key);
    await expectSnapped(page, from);
  });
}

/** A scroll the page makes after `gesture`, one that scrolled nothing: the late entry rests where it lands. */
async function restsAfter(
  page: import('@playwright/test').Page,
  gesture: () => Promise<void>,
): Promise<void> {
  await load(page);
  const where = () =>
    page.evaluate(() => ({
      scrollY: window.scrollY,
      scrollLeft: document.querySelector('.hc-stage')!.scrollLeft,
    }));
  const before = await where();
  await gesture();
  await page.waitForTimeout(300);
  // The gesture scrolled nothing, so what follows is the page's own scroll alone.
  expect(await where()).toEqual(before);
  const late = page.locator(LATE);
  await late.scrollIntoViewIfNeeded();
  const box = await late.boundingBox();
  await page.waitForTimeout(1000);
  expect(await late.boundingBox()).toEqual(box);
}

test(
  'after a click that scrolls nothing, a scroll the page makes still rests where it lands',
  { annotation, tag },
  async ({ page }) => {
    await restsAfter(page, async () => {
      // The title card's name: words, not a control, so the press and release move nothing.
      await page.locator('.hc-card__name').first().click();
    });
  },
);

test(
  'after Space on a focused control, a scroll the page makes still rests where it lands',
  { annotation, tag },
  async ({ page }) => {
    await restsAfter(page, async () => {
      const summary = page.locator('#appearance > summary');
      await summary.focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Escape');
    });
  },
);

test(
  'after a ctrl-wheel (a zoom), a scroll the page makes still rests where it lands',
  { annotation, tag },
  async ({ page }) => {
    await restsAfter(page, async () => {
      // A zoom's wheel, dispatched: Playwright's Chromium scrolls on Control and the wheel rather than
      // zooming, and an untrusted wheel moves nothing, as a zoom moves nothing on the page.
      await page.evaluate(() => {
        document.querySelector('.hc-stage')!.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: 100,
            clientX: 720,
            clientY: 450,
          }),
        );
      });
    });
  },
);

test(
  'a wheel and a touch that scroll nothing are never cancelled, and the controller scrolls nothing for them',
  { annotation, tag },
  async ({ page }) => {
    // Every scroll call the page's script could make, counted from before it runs.
    await page.addInitScript(() => {
      const calls: string[] = [];
      (window as Window & { __scrolls?: string[] }).__scrolls = calls;
      const owners = [Element.prototype, window] as unknown as Record<string, unknown>[];
      for (const owner of owners) {
        for (const name of ['scroll', 'scrollTo', 'scrollBy', 'scrollIntoView']) {
          const original = owner[name];
          if (typeof original !== 'function') continue;
          owner[name] = function (this: unknown, ...args: unknown[]) {
            calls.push(name);
            return (original as (...rest: unknown[]) => unknown).apply(this, args);
          };
        }
      }
    });
    await load(page);
    expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true });
    await page.waitForTimeout(1000);
    const where = () =>
      page.evaluate(() => ({
        scrollY: window.scrollY,
        scrollLeft: document.querySelector('.hc-stage')!.scrollLeft,
      }));
    const before = await where();
    // A wheel, then a touch's start and end, on the strip, cancelable; untrusted, so none scrolls.
    const prevented = await page.evaluate(() => {
      (window as Window & { __scrolls?: string[] }).__scrolls!.length = 0;
      const stage = document.querySelector('.hc-stage')!;
      const at = { bubbles: true, cancelable: true, clientX: 720, clientY: 450 };
      return [
        new WheelEvent('wheel', { ...at, deltaY: 100 }),
        new TouchEvent('touchstart', { bubbles: true, cancelable: true }),
        new TouchEvent('touchend', { bubbles: true, cancelable: true }),
      ].map((event) => {
        stage.dispatchEvent(event);
        return event.defaultPrevented;
      });
    });
    expect(prevented).toEqual([false, false, false]);
    // Past a settle and the two frames a gesture's end waits.
    await page.waitForTimeout(1000);
    expect(
      await page.evaluate(() => (window as Window & { __scrolls?: string[] }).__scrolls),
    ).toEqual([]);
    expect(await where()).toEqual(before);
  },
);
