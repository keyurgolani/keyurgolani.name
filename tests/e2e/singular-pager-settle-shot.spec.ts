import { createRequire } from 'node:module';
import { expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { startApp } from '../harness/app-server.mjs';
import { optionalFaces, pinFaces } from '../harness/optional-faces';
import { SCREENSHOT_COMPARISON } from '../harness/screenshots.mjs';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { RANDOM_SEED, seedRandomScript } from '../quality/lib/visual';
import { FIXTURE, ROUTE, VIEWPORTS } from '../variants/distinct-capture';
import { expectEnhancementsSettled, loadImages, settle } from '../variants/modes';
import { fixtureApp, WEB } from '../variants/target';

// Singular's home as the variant shots take it (the complete fixture, settled, its enhancements
// settled, its images in), at desktop and at mobile, shot twice as it is and twice with every
// IntersectionObserver's delivery held back 800 ms. The pager docks the bar's name and fills the
// strip from those deliveries, and the page holds as unsettled until they've run, so the shot is
// the same both ways: held, it showed the name in full and an empty strip. Each pair of a kind must
// agree too, so a flake can't pass for a difference.

const HELD_MS = 800;
const comparePng = (() => {
  const playwright = createRequire(import.meta.url).resolve('playwright/package.json');
  const { getComparator } = createRequire(playwright)('playwright-core/lib/utils') as {
    getComparator: (
      mimeType: string,
    ) => (
      actual: Buffer,
      expected: Buffer,
      options: typeof SCREENSHOT_COMPARISON,
    ) => { errorMessage?: string } | null;
  };
  return getComparator('image/png');
})();

/** Every IntersectionObserver's callback, run `ms` after the browser delivers. */
function holdDeliveries(ms: number): void {
  const Native = window.IntersectionObserver;
  if (!Native) return;
  window.IntersectionObserver = class extends Native {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      super((entries, observer) => {
        setTimeout(() => callback(entries, observer), ms);
      }, options);
    }
  };
}

/** Null when two shots are the same within the harness's comparison; else why they differ. */
function differ(a: Buffer, b: Buffer): string | null {
  if (a.equals(b)) return null;
  const result = comparePng(a, b, { ...SCREENSHOT_COMPARISON });
  return result ? (result.errorMessage?.split('\n')[0] ?? 'differs') : null;
}

async function shoot(
  browser: Browser,
  origin: string,
  emulation: BrowserContextOptions,
  held: boolean,
): Promise<Buffer> {
  const context = await browser.newContext({ ...emulation, baseURL: origin });
  try {
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort('blockedbyclient'),
    );
    const page = await context.newPage();
    await page.addInitScript(seedRandomScript, RANDOM_SEED);
    if (held) await page.addInitScript(holdDeliveries, HELD_MS);
    await pinFaces(page, await optionalFaces(page, ROUTE), 'designed');
    const watch = watchEnhancements(page);
    try {
      const response = await page.goto(ROUTE);
      expect(response?.status(), `${ROUTE}'s status`).toBe(200);
      await settle(page, true);
      await expectEnhancementsSettled(watch);
      await loadImages(page);
      return await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true });
    } finally {
      watch.stop();
    }
  } finally {
    await context.close();
  }
}

for (const [viewport, emulation] of Object.entries(VIEWPORTS)) {
  test(`Singular's home at ${viewport} shoots the same with its observers' first deliveries held back`, async ({
    playwright,
  }, testInfo) => {
    testInfo.setTimeout(5 * 60_000);
    // As the variants projects launch Chromium: no WebGL.
    const browser = await playwright.chromium.launch({ args: ['--disable-3d-apis'] });
    const app = await startApp({
      ...fixtureApp(FIXTURE, { manifest: { id: 'singular' } }),
      web: WEB,
      logFile: testInfo.outputPath('server.log'),
    });
    const shots: Record<string, Buffer> = {};
    try {
      for (const [kind, held] of [
        ['as-is-1', false],
        ['held-1', true],
        ['as-is-2', false],
        ['held-2', true],
      ] as const) {
        shots[kind] = await shoot(browser, app.origin, emulation, held);
      }
    } finally {
      await app.stop();
      await browser.close();
    }
    for (const [kind, png] of Object.entries(shots)) {
      await testInfo.attach(`singular-${viewport}-${kind}.png`, {
        body: png,
        contentType: 'image/png',
      });
    }
    const read = {
      asIs: differ(shots['as-is-1']!, shots['as-is-2']!),
      held: differ(shots['held-1']!, shots['held-2']!),
      asIsAgainstHeld: differ(shots['as-is-1']!, shots['held-1']!),
    };
    console.log(`singular pager settle shot ${viewport}: ${JSON.stringify(read)}`);
    expect(read, 'each kind steady, and the held shot the same as the shot as it is').toEqual({
      asIs: null,
      held: null,
      asIsAgainstHeld: null,
    });
  });
}
