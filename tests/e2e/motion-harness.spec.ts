import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  frameLoops,
  loadHome,
  MOTION_STALL_RERUN,
  nextFrames,
  runningAnimations,
  scrollThrough,
  scrollTops,
  watchFrames,
  withStallRerun,
} from '../harness/motion';

// The motion contract's checks (tests/e2e/motion-contract.spec.ts) against
// pages planted with what each must see (#5, review of #42): a smooth scroll
// inside a composition's own scroll container, an endless animation an
// IntersectionObserver starts once its section is in view, and a
// requestAnimationFrame loop. Static pages, no server, and nothing leaves
// the browser.

test.use({
  viewport: { width: 1280, height: 480 },
  contextOptions: { reducedMotion: 'no-preference' },
});

test.beforeEach(async ({ context }) => {
  await context.route('**/*', (route) => route.abort('blockedbyclient'));
});

const SECTIONS = Array.from(
  { length: 6 },
  (_, index) =>
    `<section id="s${index}" style="min-height: 400px"><h2>Section ${index}</h2></section>`,
).join('');

const HEADER_NAV = '<header><nav><a href="#contact">Contact</a></nav></header>';

/**
 * A composition's page, with `css` in its head and `extra` in its last
 * section. `footer` moves the link to the contact section from a header nav
 * to a footer nav below the fold, as Horizontal Cinema's chapter index has it.
 */
async function plant(page: Page, css: string, extra = '', footer = false): Promise<void> {
  await watchFrames(page);
  // A navigation runs the init script; setContent() alone doesn't.
  await page.goto('about:blank');
  await page.setContent(`<!doctype html><html><head><style>body { margin: 0 } ${css}</style></head><body>
<div data-variant="probe" data-motion-policy="reduce">
  ${footer ? '' : HEADER_NAV}
  <main id="main">${SECTIONS}<section id="contact" style="min-height: 400px"><h2>Contact</h2>${extra}</section></main>
  ${footer ? '<footer style="min-height: 600px"><nav><a href="#contact">Contact</a></nav></footer>' : ''}
</div></body></html>`);
  await nextFrames(page);
}

const INNER = "[data-variant='probe'] { display: block; height: 100vh; overflow-y: auto; }";

test("a jump inside the composition's own scroll container is a jump, and a smooth one is not", async ({
  page,
}) => {
  await plant(page, INNER);
  const jump = await scrollTops(page, '#contact');
  expect(jump.before - jump.settled).toBeGreaterThan(100);
  expect(jump.farthest).toBeLessThan(4);

  await plant(page, `${INNER} [data-variant='probe'] { scroll-behavior: smooth; }`);
  const smooth = await scrollTops(page, '#contact');
  expect(smooth.before - smooth.settled).toBeGreaterThan(100);
  expect(smooth.farthest).toBeGreaterThan(50);
});

test('a scroll before the click is no part of the jump, and a smooth scroll after it still is', async ({
  page,
}) => {
  // A scroll that reaches a frame of its own after the page starts recording
  // and before the click, as Playwright's scroll of a link into view can under load.
  const scrollFirst = async () => {
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
    await nextFrames(page);
  };
  await plant(page, '');
  const jump = await scrollTops(page, '#contact', { beforeClick: scrollFirst });
  expect(jump.before - jump.settled).toBeGreaterThan(100);
  expect(jump.farthest).toBeLessThan(4);

  await plant(page, 'html { scroll-behavior: smooth; }');
  const smooth = await scrollTops(page, '#contact', { beforeClick: scrollFirst });
  expect(smooth.before - smooth.settled).toBeGreaterThan(100);
  expect(smooth.farthest).toBeGreaterThan(50);

  // A link below the fold, which Playwright scrolls into view before it clicks.
  await plant(page, '', '', true);
  const below = await scrollTops(page, '#contact');
  expect(below.before - below.settled).toBeGreaterThan(100);
  expect(below.farthest).toBeLessThan(4);
});

test('a click the record never sees fails the check, rather than passing it as a jump', async ({
  page,
}) => {
  await plant(page, 'html { scroll-behavior: smooth; }');
  // A page handler first in the click's path that keeps every other listener from it.
  await page.evaluate(() =>
    window.addEventListener('click', (event) => event.stopImmediatePropagation(), {
      capture: true,
    }),
  );
  await expect(scrollTops(page, '#contact')).rejects.toThrow(/never reached the scroll record/);
});

test('an endless animation that starts once its section is in view shows after the jump and on the way down', async ({
  page,
}) => {
  const reveal = `<span id="dot">ongoing</span><script>
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) document.getElementById('dot').classList.add('on');
    }).observe(document.getElementById('dot'));
  </script>`;
  const css =
    "@keyframes probe-pulse { to { opacity: 0.5; } } [data-variant='probe'] .on { animation: probe-pulse 1s infinite; }";
  await plant(page, css, reveal);
  // At load the section is below the fold, so nothing runs yet.
  expect(await runningAnimations(page)).toEqual([]);
  await scrollTops(page, '#contact');
  expect(await runningAnimations(page)).toContainEqual({
    kind: 'css probe-pulse',
    target: 'span.on',
    endless: true,
  });

  // Reading down the page finds it too, inside a scroll container of its own included.
  const fresh = await page.context().newPage();
  await plant(fresh, `${INNER} ${css}`, reveal);
  expect(await runningAnimations(fresh)).toEqual([]);
  expect(await scrollThrough(fresh)).toContainEqual({
    kind: 'css probe-pulse',
    target: 'span.on',
    endless: true,
  });
});

test('a requestAnimationFrame loop is one frameLoops() sees, and a double frame is not', async ({
  page,
}) => {
  await plant(page, '');
  expect(await frameLoops(page, 500)).toBeLessThan(5);
  await page.evaluate(() => {
    // A one-off double frame, as code waits for layout.
    requestAnimationFrame(() => requestAnimationFrame(() => {}));
  });
  expect(await frameLoops(page, 500)).toBeLessThan(5);
  await page.evaluate(() => {
    const tick = () => requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  });
  expect(await frameLoops(page, 1_000)).toBeGreaterThan(20);
});

// Row 60: a page whose frames stop, or whose main thread blocks, once a scroll
// reaches a step. Either gets one rerun of the whole check from its start, in
// a fresh context, as the test's annotation; a stall on both runs fails.

/** How a stub page stalls: its frames stop, or its main thread blocks, at STALL_STEP. */
type Stall = 'frames' | 'block';

/**
 * The step a stub page stalls at, by its index in scrollThrough()'s pass, never by a scroll
 * position: where a scroll by pixels lands, and so which frame its scroll event reaches, depends on
 * the platform's metrics (row 60's pins went red on CI Linux at step 2 where macOS gave 3). The page
 * has six steps, so STALL_STEP and the steps after it exist at any viewport the spec sets.
 */
const STALL_STEP = 2;

/**
 * http://stall.test/: six screens of sections that stall as `stall` says
 * at scrollThrough()'s step STALL_STEP, on its first load alone (`once`) or on
 * every one. The page watches the harness's own step record (__motionSteps,
 * which the pass sets once it marks the scrollers and adds each step's
 * `scroller:step` to from inside that step's scroll), so the trap is set
 * inside step STALL_STEP's scroll itself. Serves it to the test's context and
 * to each fresh one `fresh` opens, which reaches nothing else, as the test's
 * own doesn't, and counts the loads.
 */
async function stallSite(browser: Browser, page: Page, stall: Stall, once: boolean) {
  const served = { loads: 0 };
  const serve = (context: BrowserContext) =>
    context.route('http://stall.test/**', (route) => {
      served.loads++;
      const stalls = !once || served.loads === 1;
      // A frame stall: from that step's next frames on, the harness's own requestAnimationFrame
      // never calls back, and the main thread stays free. A block: that step's scroll runs 9 s, past
      // the bound and the probe.
      const trap =
        stall === 'frames'
          ? 'window.__motionFrames.frame = () => 0;'
          : 'const end = Date.now() + 9000; while (Date.now() < end) {}';
      const script = stalls
        ? `<script>let steps; Object.defineProperty(window, '__motionSteps', {
            configurable: true,
            get: () => steps,
            set(list) {
              steps = list;
              const push = list.push.bind(list);
              list.push = (...items) => {
                const length = push(...items);
                if (length === ${STALL_STEP} + 1) { ${trap} }
                return length;
              };
            },
          });</script>`
        : '';
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><style>body { margin: 0 }</style></head><body>
<div data-variant="probe"><main id="main">${SECTIONS}</main></div>${script}</body></html>`,
      });
    });
  await serve(page.context());
  const fresh = async () => {
    const context = await browser.newContext();
    await context.route('**/*', (route) => route.abort('blockedbyclient'));
    await serve(context);
    return context.newPage();
  };
  return { served, fresh };
}

/** The whole check on a stub page, from its load: counts its runs, and keeps the pages and steps. */
function counted() {
  const record = { runs: 0, pages: [] as Page[], steps: [] as string[] };
  const run = async (page: Page) => {
    record.runs++;
    record.pages.push(page);
    await loadHome(page, 'http://stall.test/');
    expect(await scrollThrough(page)).toEqual([]);
    record.steps = await page.evaluate(
      () => (window as Window & { __motionSteps?: string[] }).__motionSteps ?? [],
    );
  };
  return { record, run };
}

/** The test's reruns, by their annotations' descriptions. */
const reruns = () =>
  test
    .info()
    .annotations.filter(({ type }) => type === MOTION_STALL_RERUN)
    .map(({ description }) => description);

/** Every rerun annotation's fixed shape, which later runs are counted by. */
const SHAPE =
  /^kind=(frame-stall|main-thread-block) scroller=(\d+|none) step=(\d+|none) call=(mark-scrollers|scroll|next-frames|running-animations)$/;

test('a scroll whose frames stop fails within its bound, naming the kind, the scroller, the step and the call', async ({
  browser,
  page,
}) => {
  // Under the test's own timeout: an unbounded call would run into it instead.
  test.setTimeout(20_000);
  const { run } = counted();
  await stallSite(browser, page, 'frames', false);
  await expect(run(page)).rejects.toThrow(
    `frame-stall at scroller 0, step ${STALL_STEP}: next-frames gave no answer in 5000 ms, and evaluate(() => 1) answered`,
  );
});

test('a frame stall gets one rerun of the whole check, from its start, in a fresh context, as an annotation', async ({
  browser,
  page,
}) => {
  const { served, fresh } = await stallSite(browser, page, 'frames', true);
  const { record, run } = counted();
  await withStallRerun(page, run, fresh);
  expect(served.loads).toBe(2);
  expect(record.runs).toBe(2);
  // The rerun's page is a fresh context's, and the stalled one is closed.
  expect(record.pages[1]!.context()).not.toBe(page.context());
  expect(page.isClosed()).toBe(true);
  // It scrolled every step from the first, not from the step that hung.
  expect(record.steps.length).toBeGreaterThan(STALL_STEP + 1);
  expect(record.steps).toEqual(record.steps.map((_, at) => `0:${at}`));
  expect(reruns()).toEqual([`kind=frame-stall scroller=0 step=${STALL_STEP} call=next-frames`]);
  expect(reruns()[0]).toMatch(SHAPE);
});

test('a main-thread block gets the same one rerun, named as a block', async ({ browser, page }) => {
  const { served, fresh } = await stallSite(browser, page, 'block', true);
  const { record, run } = counted();
  await withStallRerun(page, run, fresh);
  expect(served.loads).toBe(2);
  expect(record.runs).toBe(2);
  expect(record.pages[1]!.context()).not.toBe(page.context());
  // The block is inside the step's own scroll, so that's the call that hangs.
  expect(reruns()).toEqual([`kind=main-thread-block scroller=0 step=${STALL_STEP} call=scroll`]);
  expect(reruns()[0]).toMatch(SHAPE);
});

test('a stall on both runs fails, naming both kinds, after one rerun', async ({
  browser,
  page,
}) => {
  const { served, fresh } = await stallSite(browser, page, 'frames', false);
  const { record, run } = counted();
  await expect(withStallRerun(page, run, fresh)).rejects.toThrow(
    `The test stalled on both runs: first frame-stall at scroller 0, step ${STALL_STEP}: next-frames gave no answer in 5000 ms, and evaluate(() => 1) answered; then, in a fresh context, frame-stall at scroller 0, step ${STALL_STEP}:`,
  );
  expect(served.loads).toBe(2);
  expect(record.runs).toBe(2);
  expect(reruns()).toEqual([`kind=frame-stall scroller=0 step=${STALL_STEP} call=next-frames`]);
});
