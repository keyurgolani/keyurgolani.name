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
 * The ids of the packs this build registers on `axis`, as the page's
 * Registered packs table lists them, the fixture packs included.
 */
export async function registeredPacks(
  page: Page,
  axis: 'Design language' | 'Color scheme' | 'Typography',
): Promise<string[]> {
  const rows = await page
    .locator('#packs-table tbody tr')
    .evaluateAll((elements) =>
      elements.map((row) => [...row.children].map((cell) => (cell.textContent ?? '').trim())),
    );
  const ids = rows.filter(([, kind]) => kind === axis).map(([, , id]) => id!);
  expect(ids.length, `the build's ${axis} packs`).toBeGreaterThan(0);
  return ids;
}

/**
 * Every React handler on an element inside `scope`, each plate by default,
 * as `<tag>#<id> <prop>`. React delegates events at its root, so a handler
 * never shows as a listener of its element: the element's own props, which
 * React keeps on it, do.
 */
export async function reactHandlers(page: Page, scope = PLATE): Promise<string[]> {
  return page.locator(scope).evaluateAll((boundaries) =>
    boundaries.flatMap((boundary) =>
      [boundary, ...boundary.querySelectorAll('*')].flatMap((element) => {
        const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'));
        if (!key) return [];
        const props = (element as unknown as Record<string, Record<string, unknown>>)[key]!;
        return Object.entries(props)
          .filter(([name, value]) => /^on[A-Z]/.test(name) && typeof value === 'function')
          .map(([name]) => `${element.tagName.toLowerCase()}#${element.id} ${name}`);
      }),
    ),
  );
}

/** One listener added to window or document, and whether the document was still loading. */
interface GlobalListener {
  readonly kind: string;
  readonly loading: boolean;
}

/**
 * Records every listener the page adds to window or document, from before
 * its first script runs, as `window:type` or `document:type`, with
 * `capture` when it listens in the capture phase.
 */
export async function recordGlobalListeners(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: GlobalListener[] = [];
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
        seen.push({
          kind: `${this === window ? 'window' : 'document'}:${type}${capture ? ':capture' : ''}`,
          loading: document.readyState === 'loading',
        });
      }
      return add.call(this, type, listener, options);
    };
  });
}

/**
 * The listener the framework adds only while the document is still loading,
 * so whether a page has it depends on how fast the page streams: Next's
 * bootstrap (next/dist/client/app-index.js) listens for DOMContentLoaded
 * then, and so does React for each Suspense boundary still streaming in
 * (registerSuspenseInstanceRetry in react-dom). One added once the document
 * has loaded is the page's own.
 */
const WHILE_LOADING = 'document:DOMContentLoaded';

/**
 * The window and document listeners the page has added so far, each kind
 * once, sorted, without the framework's DOMContentLoaded listeners.
 */
export async function globalListeners(page: Page): Promise<string[]> {
  const seen = await page.evaluate(
    () => (window as unknown as { __globalListeners: GlobalListener[] }).__globalListeners,
  );
  const kinds = seen
    .filter(({ kind, loading }) => !(kind === WHILE_LOADING && loading))
    .map(({ kind }) => kind);
  return [...new Set(kinds)].sort();
}
