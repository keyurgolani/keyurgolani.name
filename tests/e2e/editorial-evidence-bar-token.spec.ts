import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { LAB_DEVICE } from '../quality/lib/perf/measure';
import { completeThrough } from './observer-deliveries';

// Editorial Evidence's bar token (--layout-ee-bar on the variant's root) follows the masthead's
// real height, for the chapter bar, the Contents sheet and the reading line. Every change to it
// restyles the whole page, so it's written only when the height it stands for changes, and never
// read back while a write of it is pending: removed to measure the masthead with the stylesheet's
// token in place, then set again, it made the page's style and layout run twice more each time
// one of the masthead's items changed size, a forced recalculation and layout inside the load.
// On the lab profile's device, 390 by 844.

test.use({ appOptions: completeThrough('editorial-evidence'), ...LAB_DEVICE });

declare global {
  interface Window {
    /** Each write that changed the bar token, and each geometry read while one was pending. */
    __barToken?: { writes: string[]; forced: number };
  }
}

/** From the next load on, counts the bar token's writes and the geometry reads they force. */
const watchToken = (page: Page) =>
  page.addInitScript(() => {
    const seen = { writes: [] as string[], forced: 0 };
    window.__barToken = seen;
    let pending = false;
    const root = () => document.querySelector<HTMLElement>('[data-variant]')?.style;
    const wrote = (what: string) => {
      seen.writes.push(what);
      pending = true;
      queueMicrotask(() => {
        pending = false;
      });
    };
    const { setProperty, removeProperty } = CSSStyleDeclaration.prototype;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
      if (name === '--layout-ee-bar' && this === root() && this.getPropertyValue(name) !== value)
        wrote(`set ${value}`);
      return setProperty.call(this, name, value, priority);
    };
    CSSStyleDeclaration.prototype.removeProperty = function (name) {
      if (name === '--layout-ee-bar' && this === root() && this.getPropertyValue(name) !== '')
        wrote('remove');
      return removeProperty.call(this, name);
    };
    const { getBoundingClientRect } = Element.prototype;
    Element.prototype.getBoundingClientRect = function () {
      if (pending) seen.forced += 1;
      return getBoundingClientRect.call(this);
    };
  });

/** Two frames and a beat, for a resize the observer reports. */
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 200))),
      ),
  );

/** The token as set, and the masthead's height with the stylesheet's own token in place. */
const tokenAndHeight = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-variant]')!;
    const masthead = root.querySelector<HTMLElement>('.ee-masthead')!;
    const token = root.style.getPropertyValue('--layout-ee-bar');
    root.style.removeProperty('--layout-ee-bar');
    const height = masthead.getBoundingClientRect().height;
    if (token) root.style.setProperty('--layout-ee-bar', token);
    return { token: Number.parseFloat(token), height };
  });

test(
  "at 390, the bar token is written once at load and not again when the window's height changes, with nothing read back while a write is pending",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    await watchToken(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    const atLoad = await page.evaluate(() => structuredClone(window.__barToken!));
    expect(atLoad.forced, `geometry read while a token write was pending, at load`).toBe(0);
    expect(atLoad.writes.length, `the token's writes at load: ${atLoad.writes}`).toBeLessThan(2);
    // The window's height changes, as a phone's toolbar shows and hides: the masthead's items keep
    // their sizes, the page's sentinel the window's, so the masthead's height is as it was.
    await page.setViewportSize({ width: 390, height: 760 });
    await settle(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    const after = await page.evaluate(() => structuredClone(window.__barToken!));
    expect(after.writes.slice(atLoad.writes.length), 'writes as the height changed').toEqual([]);
    expect(after.forced, 'geometry read while a token write was pending').toBe(0);
  },
);

test(
  "at 390, the bar token follows the masthead's real height as its name grows and shrinks back",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    const before = await tokenAndHeight(page);
    expect(Math.abs(before.token - before.height), JSON.stringify(before)).toBeLessThan(0.5);
    // The name in a larger size, as larger type sets it: the masthead outgrows its token.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.ee-masthead__name')!.style.fontSize = '2.5em';
    });
    await settle(page);
    const grown = await tokenAndHeight(page);
    expect(grown.height, 'the masthead grew').toBeGreaterThan(before.height + 4);
    expect(Math.abs(grown.token - grown.height), JSON.stringify(grown)).toBeLessThan(0.5);
    // Back to its own size: the token comes back with it.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.ee-masthead__name')!.style.removeProperty('font-size');
    });
    await settle(page);
    const back = await tokenAndHeight(page);
    expect(Math.abs(back.height - before.height), JSON.stringify(back)).toBeLessThan(0.5);
    expect(Math.abs(back.token - back.height), JSON.stringify(back)).toBeLessThan(0.5);
  },
);
