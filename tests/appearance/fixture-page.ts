// What the appearance specs share (#19, Slice 3): the server they start,
// from the fixture host built with APPEARANCE_FIXTURES=1, and the fixture
// page, loaded and hydrated.
import { expect, type Page } from '@playwright/test';
import type { AppOptions } from '../harness/fixtures';

/** read-only on the harness's fixtures, from the fixture host's build. */
export const FIXTURE_APP: AppOptions = { fixtureHost: true };

export const FIXTURES = '/_fixtures/appearance';

export const ROUTE = { type: 'route', description: FIXTURES };

/** The page's document boundary. */
export const DOCUMENT = '[data-appearance-boundary="document"]';

/** Every plate on the page. */
export const PLATE = '[data-appearance-boundary="plate"]';

/** How many plates the page renders, each of another selection. */
export const PLATES = 5;

/**
 * Loads the fixture page, with `query` picking the document's selection, and
 * waits for it to hydrate: the document's tabs become a tablist only then.
 */
export async function openFixtures(page: Page, query = ''): Promise<void> {
  const response = await page.goto(`${FIXTURES}${query}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.locator(DOCUMENT).getByRole('tablist', { name: 'Evidence views' }),
  ).toBeVisible();
}

/**
 * Records every listener the page adds to window or document, from before
 * its first script runs, as `window:type` or `document:type`, with
 * `capture` when it listens in the capture phase.
 */
export async function recordGlobalListeners(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, '__globalListeners', { value: seen });
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (this === window || this === document) {
        const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
        seen.push(`${this === window ? 'window' : 'document'}:${type}${capture ? ':capture' : ''}`);
      }
      return add.call(this, type, listener, options);
    };
  });
}

/** The window and document listeners the page has added so far, each kind once, sorted. */
export async function globalListeners(page: Page): Promise<string[]> {
  const seen = await page.evaluate(
    () => (window as unknown as { __globalListeners: string[] }).__globalListeners,
  );
  return [...new Set(seen)].sort();
}
