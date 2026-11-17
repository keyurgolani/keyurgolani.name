import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';

// A browser hands an IntersectionObserver every entry queued since its last delivery, oldest
// first, so a page that comes back to a watched box and leaves it again before the observer's task
// runs (a busy main thread; the keyboard's Shift+Tab into a part and Tab out of it) delivers both in
// one call. An observer that reads the first entry keeps the stale state. These helpers coalesce
// every observer's deliveries over a wait, so that order is the one the page gets, and keep each
// delivery's entries, to show that one held the box coming into view and then leaving it.

/** How long every observer's deliveries are held and handed over together. */
export const COALESCE_MS = 500;

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

/** The complete fixture through `variant`, as the composition specs serve it. */
export const completeThrough = (variant: string) => ({
  portfolio: FIXTURE.files.portfolio,
  siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), variant),
  sourceFiles: Object.fromEntries(
    FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
  ),
});

declare global {
  interface Window {
    /** Each coalesced delivery's entries, as [target, intersecting, ratio, box top, root top]. */
    __coalescedDeliveries?: [Element, boolean, number, number, number | null][][];
  }
}

/** From the next load on, every IntersectionObserver's deliveries are held `wait` ms and handed over together. */
export const coalesceObserverDeliveries = (page: Page, wait = COALESCE_MS) =>
  page.addInitScript((wait) => {
    const Native = window.IntersectionObserver;
    window.IntersectionObserver = class extends Native {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        let held: IntersectionObserverEntry[] = [];
        let timer = 0;
        super((entries, observer) => {
          held.push(...entries);
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            const delivery = held;
            held = [];
            (window.__coalescedDeliveries ??= []).push(
              delivery.map((entry) => [
                entry.target,
                entry.isIntersecting,
                entry.intersectionRatio,
                entry.boundingClientRect.top,
                entry.rootBounds?.top ?? null,
              ]),
            );
            callback(delivery, observer);
          }, wait);
        }, options);
      }
    };
  }, wait);

/** How many coalesced deliveries the page has had. */
export const deliveries = (page: Page) =>
  page.evaluate(() => window.__coalescedDeliveries?.length ?? 0);

/** One entry as the page delivered it: whether it intersected, its ratio, and its box's and the root's tops. */
export interface Delivered {
  readonly at: boolean;
  readonly ratio: number;
  readonly top: number;
  readonly rootTop: number | null;
}

/** For each delivery since the `from`th, the entries it held for `selector`'s box, oldest first. */
export const entriesFor = (page: Page, selector: string, from: number) =>
  page.evaluate(
    ([selector, from]) => {
      const box = document.querySelector(selector);
      return (window.__coalescedDeliveries ?? [])
        .slice(from)
        .map((delivery) =>
          delivery
            .filter(([target]) => target === box)
            .map(([, at, ratio, top, rootTop]) => ({ at, ratio, top, rootTop })),
        );
    },
    [selector, from] as const,
  ) as Promise<Delivered[][]>;

/** Whether a delivery since the `from`th held `selector`'s box coming into view and then leaving it. */
export const heldInThenOut = async (page: Page, selector: string, from: number) =>
  (await entriesFor(page, selector, from)).some(
    (held) => held.length > 1 && held.some(({ at }) => at) && held.at(-1)?.at === false,
  );

/** Scrolls to each in turn ('top', 'bottom', or an element's start), at once and two frames apart, inside one delivery's wait. */
export const visitInTurn = (page: Page, selectors: readonly string[]) =>
  page.evaluate(async (selectors) => {
    const frames = () =>
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    for (const selector of selectors) {
      if (selector === 'top') window.scrollTo({ top: 0, behavior: 'instant' });
      else if (selector === 'bottom')
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      else
        document.querySelector(selector)!.scrollIntoView({ block: 'start', behavior: 'instant' });
      await frames();
    }
  }, selectors);

/** Two frames, for a render that follows a delivery. */
export const twoFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
