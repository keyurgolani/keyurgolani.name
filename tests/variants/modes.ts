// The six modes every composition passes (#5, Slice 6), and the checks they
// share. Every mode: the composition under test renders, with one h1 and one
// main, the skip link moves focus to main, one visitor-control slot, nothing
// wider than the window, every internal link resolves, each section's
// data-renderer matches the manifest's renderedKinds and no kind it leaves
// out renders, and no console error. Desktop and mobile take a screenshot of
// the whole page, every image on it loaded. Without JavaScript, in print, and
// with its enhancements failing, the page stays readable: the h1, the
// navigation, and each visible section's heading have a box, opacity, and
// visibility. Print also has nothing fixed or sticky. Under reduced motion
// nothing runs once the page settles. A failed enhancement runs twice: with
// every script chunk blocked while the stylesheets load, and with the kit's
// throw switch on, which fails every enhancement the kit mounted on the page.
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { runningAnimations } from '../harness/motion';
import { COMPARE_SCREENSHOTS, firstParty, type RegisteredVariant } from './target';

export type ModeName =
  'desktop' | 'mobile' | 'no-javascript' | 'print' | 'failed-enhancement' | 'reduced-motion';

export interface Mode {
  readonly name: ModeName;
  /** Context options the mode's tests run with. */
  readonly context: {
    readonly viewport: { readonly width: number; readonly height: number };
    readonly isMobile?: boolean;
    readonly hasTouch?: boolean;
    readonly javaScriptEnabled?: boolean;
    readonly reducedMotion?: 'reduce' | 'no-preference';
  };
}

const DESKTOP = { width: 1440, height: 900 };

export const MODES: readonly Mode[] = [
  { name: 'desktop', context: { viewport: DESKTOP } },
  {
    name: 'mobile',
    context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  },
  { name: 'no-javascript', context: { viewport: DESKTOP, javaScriptEnabled: false } },
  { name: 'print', context: { viewport: DESKTOP } },
  { name: 'failed-enhancement', context: { viewport: DESKTOP } },
  { name: 'reduced-motion', context: { viewport: DESKTOP, reducedMotion: 'reduce' } },
];

/**
 * The app's chunks. The first failed-enhancement run fails every script
 * among them. Next serves the stylesheets from there too, and those load,
 * as they do for a visitor whose scripts fail.
 */
const CHUNKS = '**/_next/static/chunks/**';

/** How a failed-enhancement run fails them. */
type FailedRun = 'blocked-chunks' | 'throw-switch';

/** What the kit throws for each enhancement while its throw switch is on. */
const THROW_SWITCH_ERROR = 'globalThis.__portfolioFailEnhancements is set';

/** The kit's test switches (packages/kit/src/enhancements/load.tsx). */
interface KitSwitches {
  /** Every enhancement throws. */
  __portfolioFailEnhancements?: boolean;
  /** Each enhancement that mounts adds 1. */
  __portfolioMountedEnhancements?: number;
}

/**
 * The page's console errors, read when called: every one but a resource
 * that failed on purpose, which `expected` names, or that the page never
 * got, such as what the harness blocks outside the app, and, with
 * `thrown`, the error the kit's throw switch makes each enhancement throw,
 * which React reports as its boundary catches it.
 */
function consoleErrors(
  page: Page,
  expected: (url: string) => boolean,
  thrown = false,
): () => string[] {
  const failed = new Set<string>();
  const seen: { text: string; url: string }[] = [];
  page.on('requestfailed', (request) => failed.add(request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error')
      seen.push({ text: message.text(), url: message.location().url });
  });
  page.on('pageerror', (error) => seen.push({ text: `${error.name}: ${error.message}`, url: '' }));
  return () =>
    seen
      .filter(
        ({ text, url }) =>
          !(text.startsWith('Failed to load resource') && (failed.has(url) || expected(url))) &&
          !(thrown && text.includes(THROW_SWITCH_ERROR)),
      )
      .map(({ text, url }) => (url ? `${text} (${url})` : text));
}

/** The page's settled state: loaded, its fonts in, and two frames drawn. */
async function settle(page: Page, javaScript: boolean): Promise<void> {
  await page.waitForLoadState('load');
  if (!javaScript) return;
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** Links already checked, by URL, so each mode doesn't fetch them again. */
const resolved = new Map<string, number>();

/** Every check each mode makes. */
export async function expectEveryMode(
  page: Page,
  request: APIRequestContext,
  variant: RegisteredVariant,
  errors: () => string[],
): Promise<void> {
  // The composition under test renders, not one standing in for it: the
  // sample project has no parity check to notice.
  await expect(page.locator('[data-variant]'), 'one presentation boundary').toHaveCount(1);
  await expect(page.locator('[data-variant]'), 'the composition under test').toHaveAttribute(
    'data-variant',
    variant.manifest.id,
  );
  await expect(page.locator('h1'), 'one h1').toHaveCount(1);
  await expect(page.locator('main'), 'one main').toHaveCount(1);
  await expect(page.locator('[data-visitor-control-slot]'), 'one visitor-control slot').toHaveCount(
    1,
  );

  // The skip link comes first, and moves focus to the composition's main.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();

  // Nothing is wider than the window, so the page never scrolls sideways.
  const width = await page
    .locator('html')
    .evaluate((html) => ({ scroll: html.scrollWidth, client: html.clientWidth }));
  expect(width.scroll, 'the page is no wider than the window').toBeLessThanOrEqual(width.client);

  // Each section is bespoke exactly when the manifest renders its kind itself.
  const sections = await page
    .locator('[data-renderer]')
    .evaluateAll((elements) =>
      elements.map((element) => [
        element.getAttribute('data-kind') ?? '',
        element.getAttribute('data-renderer') ?? '',
      ]),
    );
  expect(sections.length, 'sections with data-renderer').toBeGreaterThan(0);
  const rendered: readonly string[] = variant.manifest.renderedKinds;
  const unsupported: readonly string[] = variant.manifest.unsupportedKinds;
  for (const [kind, renderer] of sections) {
    // A kind the manifest leaves out renders nothing, not the shared renderer.
    expect(unsupported.includes(kind!), `${kind}, which the manifest leaves out, renders`).toBe(
      false,
    );
    expect(renderer, kind).toBe(rendered.includes(kind!) ? 'bespoke' : 'shared');
  }

  // Every internal link resolves: a fragment to an element on the page, a
  // path to a page that answers.
  const here = new URL(page.url());
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
  for (const href of new Set(hrefs)) {
    const url = new URL(href);
    if (url.origin !== here.origin) continue;
    if (url.hash && url.pathname === here.pathname && url.search === here.search) {
      const id = decodeURIComponent(url.hash.slice(1));
      await expect(page.locator(`[id="${id.replaceAll('"', '\\"')}"]`), href).toHaveCount(1);
      continue;
    }
    const target = `${url.pathname}${url.search}`;
    let status = resolved.get(`${url.origin}${target}`);
    if (status === undefined) {
      status = (await request.get(target)).status();
      resolved.set(`${url.origin}${target}`, status);
    }
    expect(status, `${href} answers`).toBe(200);
  }

  expect(errors(), 'console errors').toEqual([]);
}

/**
 * The h1, the navigation, and each visible section's heading have a box,
 * opacity, and visibility, so the page reads without its scripts, on paper,
 * and with its enhancements gone.
 */
export async function expectReadable(page: Page): Promise<void> {
  const unreadable = await page.evaluate(() => {
    const opacity = (element: Element | null): number => {
      let value = 1;
      for (let node = element; node; node = node.parentElement) {
        value *= Number(getComputedStyle(node).opacity);
      }
      return value;
    };
    const targets = [
      ...document.querySelectorAll('h1, nav'),
      ...[...document.querySelectorAll('[data-section-id]')].flatMap((section) => {
        const heading = section.querySelector('h1, h2, h3, h4, h5, h6');
        return heading ? [heading] : [];
      }),
    ];
    return targets.flatMap((element) => {
      const box = element.getBoundingClientRect();
      const { visibility } = getComputedStyle(element);
      const problems = [
        box.width > 0 && box.height > 0 ? null : 'no box',
        opacity(element) > 0 ? null : 'no opacity',
        visibility === 'visible' ? null : `visibility ${visibility}`,
      ].filter((problem) => problem !== null);
      const name = `${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 40)}"`;
      return problems.length > 0 ? [`${name}: ${problems.join(', ')}`] : [];
    });
  });
  expect(unreadable, 'unreadable headings and navigation').toEqual([]);
}

/** The page's stylesheet requests, as the network saw them, read when called. */
function stylesheets(page: Page): () => { loaded: number; failed: string[] } {
  let loaded = 0;
  const failed: string[] = [];
  page.on('requestfinished', (request) => {
    if (request.resourceType() === 'stylesheet') loaded += 1;
  });
  page.on('requestfailed', (request) => {
    if (request.resourceType() === 'stylesheet') failed.push(request.url());
  });
  return () => ({ loaded, failed: [...failed] });
}

/**
 * The blocked-chunks run failed scripts, `blocked` of them, and nothing
 * else: every stylesheet the page asked for loaded.
 */
function expectScriptsAlone(blocked: number, sheets: { loaded: number; failed: string[] }): void {
  expect(blocked, 'script chunks the run failed').toBeGreaterThan(0);
  expect(sheets.failed, 'stylesheets that failed to load').toEqual([]);
  expect(sheets.loaded, 'stylesheets that loaded').toBeGreaterThan(0);
}

/** Nothing fixed or sticky in print, which would repeat on every page or cover the text. */
export async function expectNothingFixed(page: Page): Promise<void> {
  const pinned = await page.evaluate(() =>
    [...document.querySelectorAll('body *')].flatMap((element) => {
      const { position } = getComputedStyle(element);
      return position === 'fixed' || position === 'sticky'
        ? [`${[element.tagName.toLowerCase(), ...element.classList].join('.')}: ${position}`]
        : [];
    }),
  );
  expect(pinned, 'fixed or sticky in print').toEqual([]);
}

/** Nothing runs once the page has settled under reduced motion. */
export async function expectStill(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  expect(await runningAnimations(page), 'running animations').toEqual([]);
}

/**
 * Turns the kit's throw switch on for `page`'s next document, and counts
 * each enhancement it fails: React reports the kit's error as the
 * enhancement's boundary catches it. The kit counts each one it mounts.
 */
export async function failEveryEnhancement(page: Page): Promise<() => number> {
  let failed = 0;
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes(THROW_SWITCH_ERROR)) failed += 1;
  });
  page.on('pageerror', (error) => {
    if (error.message.includes(THROW_SWITCH_ERROR)) failed += 1;
  });
  await page.addInitScript(() => {
    const kit = globalThis as KitSwitches;
    kit.__portfolioFailEnhancements = true;
    kit.__portfolioMountedEnhancements = 0;
  });
  return () => failed;
}

/**
 * That the throw switch failed every enhancement the kit has mounted on
 * `page`, and that the kit mounted `floor` at least. First the page goes
 * idle, which is when #6's islands mount theirs, and the counts have to
 * hold for a second, so one that mounts late is in them before the check
 * passes. With `settle: false` it reads them again, for one that mounted
 * since, without waiting for either.
 */
export async function expectEveryEnhancementFailed(
  page: Page,
  failed: () => number,
  floor = 0,
  { settle = true }: { settle?: boolean } = {},
): Promise<void> {
  if (settle) {
    await page.evaluate(
      () =>
        new Promise((resolve) => requestIdleCallback(() => resolve(undefined), { timeout: 5_000 })),
    );
  }
  const held = settle ? 1_000 : 0;
  let last: { mounted: number; failed: number } | undefined;
  let since = 0;
  await expect
    .poll(
      async () => {
        const now = {
          mounted: await page.evaluate(() =>
            Number((globalThis as KitSwitches).__portfolioMountedEnhancements),
          ),
          failed: failed(),
        };
        if (last === undefined || now.mounted !== last.mounted || now.failed !== last.failed) {
          last = now;
          since = Date.now();
        }
        const done = Date.now() - since >= held && now.mounted === now.failed;
        return done && now.mounted >= floor
          ? 'every one failed'
          : `${now.mounted} mounted, ${now.failed} failed`;
      },
      {
        message: `enhancements the kit mounted, at least ${floor}, and the throw switch failed`,
        intervals: [100],
        timeout: 10_000,
      },
    )
    .toBe('every one failed');
}

/**
 * Every image on the page loaded, or failed, and decoded. A lazy image
 * starts loading only once the window scrolls near it, so most of a long
 * page's would still be empty boxes in a whole-page shot. Each one is made
 * eager, which loads it as that scroll would, without moving the page.
 */
export async function loadImages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const images = [...document.images];
    for (const image of images) image.loading = 'eager';
    // A broken image rejects, and the shot shows it broken. One still
    // loading after 10 s is named below rather than waited on.
    const decoded = Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    await Promise.race([decoded, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  });
  const loading = await page.evaluate(() =>
    [...document.images]
      .filter((image) => !image.complete)
      .map((image) => image.currentSrc || image.src),
  );
  expect(loading, 'images still loading at the screenshot').toEqual([]);
}

/**
 * The whole page's screenshot, every image on it loaded, attached to the
 * report, and compared against its baseline for the platform's own variants
 * in the pinned image.
 */
async function screenshot(
  page: Page,
  testInfo: TestInfo,
  variant: RegisteredVariant,
  name: string,
): Promise<void> {
  await loadImages(page);
  const options = { animations: 'disabled', caret: 'hide', fullPage: true } as const;
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot(options),
    contentType: 'image/png',
  });
  if (COMPARE_SCREENSHOTS && firstParty(variant)) {
    await expect(page).toHaveScreenshot(`${name}.png`, options);
  }
}

export interface ModeCheck {
  readonly mode: ModeName;
  readonly page: Page;
  readonly context: BrowserContext;
  readonly request: APIRequestContext;
  readonly variant: RegisteredVariant;
  readonly testInfo: TestInfo;
  /** Loads the page under test. */
  readonly go: (page: Page) => Promise<unknown>;
  /** The screenshot's name, for desktop and mobile. */
  readonly shot: string;
  /** The contract fixture the page renders, if it renders one. */
  readonly fixture?: string;
  /** A resource the page may fail to load without a console error counting, such as a missing image. */
  readonly expectedFailure?: (url: string) => boolean;
}

/** Every check `mode` makes, on the page `go` loads: twice for a failed enhancement. */
export async function checkMode(check: ModeCheck): Promise<void> {
  if (check.mode !== 'failed-enhancement') {
    await checkPage(check, check.page);
    return;
  }
  await checkPage(check, check.page, 'blocked-chunks');
  await checkPage(check, await check.context.newPage(), 'throw-switch');
}

async function checkPage(check: ModeCheck, page: Page, run?: FailedRun): Promise<void> {
  const { mode, context } = check;
  const errors = consoleErrors(
    page,
    check.expectedFailure ?? (() => false),
    run === 'throw-switch',
  );
  if (mode === 'print') await page.emulateMedia({ media: 'print' });
  const sheets = stylesheets(page);
  let blocked = 0;
  if (run === 'blocked-chunks') {
    // Registered after the harness's route, so it answers the app's own chunks.
    await context.route(CHUNKS, (route) => {
      if (route.request().resourceType() !== 'script') return route.fallback();
      blocked += 1;
      return route.abort('failed');
    });
  }
  const failed = run === 'throw-switch' ? await failEveryEnhancement(page) : undefined;
  try {
    await check.go(page);
    await settle(page, mode !== 'no-javascript' && run !== 'blocked-chunks');
    // Before the keyboard checks, which focus main and scroll to it: the
    // page as a visitor first sees it.
    if (mode === 'desktop' || mode === 'mobile') {
      await screenshot(page, check.testInfo, check.variant, check.shot);
    }
    await expectEveryMode(page, check.request, check.variant, errors);
    if (run === 'blocked-chunks') expectScriptsAlone(blocked, sheets());
    // complete renders every kind, so a composition that declares an
    // enhancement mounts one there at least.
    const floor =
      check.fixture === 'complete' && (check.variant.manifest.enhancements?.length ?? 0) > 0
        ? 1
        : 0;
    if (failed) await expectEveryEnhancementFailed(page, failed, floor);
    if (mode === 'no-javascript' || mode === 'print' || mode === 'failed-enhancement') {
      await expectReadable(page);
    }
    // And any enhancement that mounted while those checks ran.
    if (failed) await expectEveryEnhancementFailed(page, failed, floor, { settle: false });
    if (mode === 'print') await expectNothingFixed(page);
    if (mode === 'reduced-motion') await expectStill(page);
  } finally {
    if (run === 'blocked-chunks') await context.unroute(CHUNKS);
  }
}
