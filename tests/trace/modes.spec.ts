// The runtime's modes (#6, items 6 and 7, verification 3 and 4), traced on
// fixture-variant-medium, the one registered variant with effects: a WebGL2
// shader on useFrameLoop, a pulse on an infinite CSS animation under the
// same runtime root, an EnhancementIsland, and a MotionControl. Each mode
// holds the page for 5 s of the probe's window and reads its counters: no
// frame loop, recurring timer, or running infinite animation while the
// document is hidden, the root is offscreen, the OS reduces motion, the
// site's policy reduces it, the visitor paused it, or a preview frame is out
// of focus. The running page shows the pulse, so a window that counts
// nothing counts something there. Then a WebGL2 the browser lacks, and an
// enhancement chunk, the still, and the unit's stylesheet that fail to load,
// each leave the headings, links, and navigation targets the no-JavaScript
// render has, and the page's layout shift is measured with fonts and media
// blocked, for #11.
//
// It runs in the trace's projects for fixture-variant-medium under
// read-only, in a BUDGET_FIXTURES=1 build, and skips everywhere else.
import type { Page } from '@playwright/test';
import { expect, installProbe, nextFrames, readProbes, startProbes, test } from './fixtures';
import type { TraceTarget } from './targets';

const FIXTURE = 'fixture-variant-medium';
/** How long each mode holds, as the scope's 5 s of trace. */
const WINDOW_MS = 5_000;

test.beforeEach(({}, testInfo) => {
  const target = testInfo.project.metadata as unknown as TraceTarget;
  test.skip(
    target.composition !== FIXTURE || target.profile !== 'read-only',
    `the modes trace ${FIXTURE} under read-only`,
  );
});

/** The continuous work the probe counted over a window of `ms`, on the whole page. */
async function windowOf(page: Page, ms = WINDOW_MS) {
  await nextFrames(page);
  await startProbes(page);
  await page.waitForTimeout(ms);
  const probe = await readProbes(page);
  return {
    frameLoops: probe.frames.loopCount,
    recurringTimers: probe.timers.recurring,
    infiniteAnimations: probe.animations.infinite.length,
    loops: probe.frames.loops.map(({ site }: { site: string }) => site),
    animations: probe.animations.infinite.map(
      ({ kind, target }: { kind: string; target: string }) => `${kind} on ${target}`,
    ),
  };
}

const NOTHING_RUNS = { frameLoops: 0, recurringTimers: 0, infiniteAnimations: 0 };

/** The stage's runtime, as its root and its canvas show it. */
async function stage(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('.fvm-stage');
    return {
      activity: root?.getAttribute('data-activity') ?? null,
      running: document.querySelector('.fvm-canvas')?.hasAttribute('data-running') ?? false,
    };
  });
}

/** Loads / with the probe, settled. */
async function load(page: Page) {
  await installProbe(page);
  const response = await page.goto('/', { waitUntil: 'load' });
  expect(response?.status()).toBe(200);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
}

/** Headings, links, and navigation targets, as a reader of the page finds them. */
async function readable(page: Page) {
  return page.evaluate(() => ({
    headings: [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((element) =>
      (element.textContent ?? '').trim(),
    ),
    links: [...document.querySelectorAll('a[href]')].map((element) => element.getAttribute('href')),
    targets: [...document.querySelectorAll('[id]')]
      .map((element) => element.id)
      .filter((id) => !id.startsWith('«')),
  }));
}

/** What the page reads as without JavaScript, from a context of its own. */
async function withoutJavaScript(page: Page) {
  const context = await page
    .context()
    .browser()!
    .newContext({ javaScriptEnabled: false, baseURL: new URL(page.url()).origin });
  try {
    const plain = await context.newPage();
    await plain.goto('/', { waitUntil: 'load' });
    return await readable(plain);
  } finally {
    await context.close();
  }
}

test('running, the pulse animates, and the first client render was static', async ({ page }) => {
  await load(page);
  const html = await (await page.request.get('/')).text();
  // The server's markup: no runtime has run yet, so nothing runs.
  expect(html).toMatch(/<div class="fvm-stage" aria-hidden="true">/);
  expect(html).not.toMatch(/data-running/);
  const counts = await windowOf(page);
  expect(counts.infiniteAnimations, 'the pulse runs').toBeGreaterThan(0);
  expect(await stage(page)).toMatchObject({ activity: null });
});

test('hidden, the runtime pauses, and nothing runs', async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await stage(page)).activity).toBe('paused');
  expect(await windowOf(page)).toMatchObject(NOTHING_RUNS);
});

test('offscreen, the stage pauses, and nothing runs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await load(page);
  // Far past the stage and its 200px margin.
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.blockSize = '400vh';
    document.querySelector('main')?.append(spacer);
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect.poll(async () => (await stage(page)).activity).toBe('paused');
  expect(await windowOf(page)).toMatchObject(NOTHING_RUNS);
});

test('with the OS reducing motion, the runtime stays static, and MotionControl is disabled and says so', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await load(page);
  await expect.poll(async () => (await stage(page)).activity).toBe('paused');
  const control = page.locator('[data-motion-control] button');
  await expect(control).toBeDisabled();
  await expect(page.locator('[data-motion-control] [role="status"]')).toHaveText(
    'Reduced by system',
  );
  expect(await windowOf(page)).toMatchObject(NOTHING_RUNS);
});

test("under the site's reduce policy, the runtime stays static, and MotionControl isn't there", async ({
  page,
}) => {
  await load(page);
  // The boundary carries the site's policy; the runtime follows it as it changes.
  await page.evaluate(() =>
    document.querySelector('[data-variant]')?.setAttribute('data-motion-policy', 'reduce'),
  );
  await expect.poll(async () => (await stage(page)).activity).toBe('paused');
  await expect(page.locator('[data-motion-control]')).toHaveCount(0);
  expect(await windowOf(page)).toMatchObject(NOTHING_RUNS);
});

test('the visitor pauses motion with MotionControl, which says so, and resumes it', async ({
  page,
}) => {
  await load(page);
  const control = page.locator('[data-motion-control] button');
  const status = page.locator('[data-motion-control] [role="status"]');
  await expect(control).toHaveAttribute('aria-pressed', 'false');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await control.click();
  await expect(control).toHaveAttribute('aria-pressed', 'true');
  await expect(status).toHaveText('Motion is paused.');
  await expect.poll(async () => (await stage(page)).activity).toBe('paused');
  expect(await windowOf(page)).toMatchObject(NOTHING_RUNS);
  // The pause lasts for the tab.
  await page.reload({ waitUntil: 'load' });
  await expect(control).toHaveAttribute('aria-pressed', 'true');
  await control.click();
  await expect(control).toHaveAttribute('aria-pressed', 'false');
  await expect(status).toHaveText('Motion is on.');
  await expect.poll(async () => (await stage(page)).activity).toBe(null);
  expect((await windowOf(page, 2_000)).infiniteAnimations).toBeGreaterThan(0);
});

test('a preview frame out of focus, as #7 lifecycle says, pauses the runtime, and a focused one runs', async ({
  page,
}) => {
  await load(page);
  const lifecycle = (state: string, focused: boolean) =>
    page.evaluate(
      ([state, focused]) => {
        const detail = Object.freeze({ state, focused });
        (window as unknown as Record<symbol, unknown>)[Symbol.for('kgn-preview.lifecycle')] =
          detail;
        window.dispatchEvent(new CustomEvent('kgn-preview-lifecycle', { detail }));
      },
      [state, focused] as const,
    );
  await lifecycle('visible', false);
  await expect.poll(async () => (await stage(page)).activity).toBe('paused');
  expect(await windowOf(page)).toMatchObject(NOTHING_RUNS);
  await lifecycle('hidden', false);
  expect(await windowOf(page, 2_000)).toMatchObject(NOTHING_RUNS);
  await lifecycle('visible', true);
  await expect.poll(async () => (await stage(page)).activity).toBe(null);
});

test('without WebGL2, the stage keeps its still, draws nothing, and the page reads the same', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (type === 'webgl2') return null;
      return (get as (...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof get;
  });
  await load(page);
  expect(await stage(page)).toMatchObject({ running: false });
  expect((await windowOf(page, 2_000)).frameLoops).toBe(0);
  expect(await readable(page)).toEqual(await withoutJavaScript(page));
});

test('an enhancement chunk that fails to load tears its island down to the server markup, and the page reads the same', async ({
  page,
}) => {
  // Every chunk the document doesn't name fails, as a blocked one would:
  // the glint's, which its island loads on demand, once it's active.
  const html = await (await page.request.get('/')).text();
  const named = new Set(
    [...html.matchAll(/\/_next\/static\/chunks\/[^"'\s)]+\.(?:js|css)/g)].map(([path]) => path),
  );
  const blocked: string[] = [];
  await page.route('**/_next/static/chunks/**', (route) => {
    const at = new URL(route.request().url()).pathname;
    if (named.has(at)) return route.fallback();
    blocked.push(at);
    return route.abort('failed');
  });
  await load(page);
  const plain = await withoutJavaScript(page);
  await page.locator('[data-enhancement-island="glint"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-enhancement-island="glint"]')).toHaveAttribute(
    'data-island',
    'failed',
  );
  await expect(page.locator('[data-enhancement-island="glint"] .fvm-glint')).toHaveCount(1);
  // Asked for once the island was active, and given up on: Turbopack's
  // loader tries a chunk twice, and the island never asks again.
  expect(blocked.length, "the glint's chunk, which the island asked for").toBeGreaterThan(0);
  await page.waitForTimeout(2_000);
  expect(
    blocked.length,
    `the requests for the failed chunk: ${blocked.join(', ')}`,
  ).toBeLessThanOrEqual(2);
  expect(await readable(page)).toEqual(plain);
});

/**
 * Fails every request `pattern` matches from here on, the browser's cache
 * off, so nothing it already holds gets past. The trace's site publishes
 * fixture-type-font, which ships a font; a public page links it once #19's
 * fourth slice links the selected packs, and 6-5's CSP follow-up then
 * asserts a font was refused.
 */
async function block(page: Page, pattern: RegExp) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.route(pattern, (route) => route.abort('failed'));
}

test('with the still, the unit stylesheet, and fonts blocked, the page reads the same', async ({
  page,
}) => {
  await load(page);
  const plain = await withoutJavaScript(page);
  await block(page, /\/_portfolio\/(?:asset|font|variant)\/|\.woff2?(?:$|\?)/);
  await page.reload({ waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  expect(await readable(page)).toEqual(plain);
});

test("the page's layout shift, with fonts and media blocked and without, is recorded for #11", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const shifts: number[] = [];
    (window as unknown as { __shifts: number[] }).__shifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!entry.hadRecentInput) shifts.push(entry.value);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const cls = async () => {
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    return page.evaluate(() =>
      (window as unknown as { __shifts: number[] }).__shifts.reduce((sum, value) => sum + value, 0),
    );
  };
  await load(page);
  const loaded = await cls();
  await block(page, /\/_portfolio\/(?:asset|font)\/|\.woff2?(?:$|\?)/);
  await page.reload({ waitUntil: 'load' });
  const blocked = await cls();
  await testInfo.attach('layout-shift.json', {
    body: JSON.stringify({ loaded, fontsAndMediaBlocked: blocked }, null, 2),
    contentType: 'application/json',
  });
  console.log(
    `[trace] layout shift: ${loaded.toFixed(4)} loaded, ${blocked.toFixed(4)} with fonts and media blocked`,
  );
  // #11 sets the threshold by tier. The fixture measures none either way,
  // with font-display: swap and its fallback stack, so any shift is new.
  expect(loaded).toBe(0);
  expect(blocked).toBe(0);
});
