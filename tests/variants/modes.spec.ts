import { stripVTControlCharacters } from 'node:util';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { ENHANCEMENT_PENDING } from '../../packages/variant-contract/src/settle';
import { BUSY_LIMIT_MS, STILL_ENHANCING, watchEnhancements } from '../quality/lib/a11y/conditions';
import {
  checkMode,
  enhancementFloor,
  expectEnhancementsSettled,
  expectEveryEnhancementFailed,
  expectNothingFixed,
  expectReadable,
  failEveryEnhancement,
  loadImages,
} from './modes';

// The modes' own checks (#12), each on a page that stands in for a
// composition, served from a host the test answers itself, so no app runs:
// the throw-switch check with an enhancement that mounts after the page goes
// idle, on a page that stays busy before it does, and the floor `complete`
// sets; the readable and print checks, and what each leaves out; the
// screenshot's wait for lazy images and for one that never loads, and for an
// enhancement's chunk, which a lazy <Enhancement> starts after the page
// loads, and for one that never lands, and for a first pass the page marks
// pending, and one that never runs; and the stand-in host, which lets
// nothing out.

const ORIGIN = 'https://modes.test';
/** A 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** A script the stand-in host serves at its path, `after` ms late. */
interface StandInScript {
  readonly body: string;
  readonly after: number;
}

/**
 * Serves `body` as the page at ORIGIN/, each of `scripts` at its path, and a
 * PNG for every image but `stalled`, which never answers. A catch-all
 * registered first refuses every other request and every WebSocket.
 * Playwright tries the route registered last first, so the stand-in host's
 * own route answers ahead of it, and nothing the page asks for leaves the
 * machine. Returns the URLs the catch-all refused.
 */
async function open(
  page: Page,
  body: string,
  stalled?: string,
  scripts: Readonly<Record<string, StandInScript>> = {},
): Promise<string[]> {
  const refused: string[] = [];
  await page.route('**/*', (route) => {
    refused.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.routeWebSocket(/.*/, (socket) => {
    refused.push(socket.url());
    return socket.close();
  });
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><body>${body}</body></html>`,
      });
    }
    if (pathname === stalled) return new Promise<void>(() => {});
    const script = scripts[pathname];
    if (script) {
      await new Promise((resolve) => setTimeout(resolve, script.after));
      return route.fulfill({ contentType: 'text/javascript', body: script.body });
    }
    return route.fulfill({ contentType: 'image/png', body: PNG });
  });
  await page.goto(`${ORIGIN}/`);
  return refused;
}

/**
 * Mounts a stand-in enhancement as the kit does, adding to its count, and
 * failing under the switch as the kit's do, if `fails`.
 */
const MOUNT = `
  function mount(fails) {
    globalThis.__portfolioMountedEnhancements += 1;
    if (fails && globalThis.__portfolioFailEnhancements) {
      console.error(new Error('Every enhancement fails: globalThis.__portfolioFailEnhancements is set.'));
    }
  }`;

/**
 * A page that mounts one enhancement as it loads and another once it's
 * idle, as #6's islands will, the late one failing only if `lateFails`.
 */
const enhancements = (lateFails: boolean) => `
<main><h1>Stand-in</h1></main>
<script>
  ${MOUNT}
  mount(true);
  requestIdleCallback(() => setTimeout(() => mount(${lateFails}), 300));
</script>`;

/**
 * A page that mounts one enhancement once it loads, then keeps its main
 * thread busy for `ms`, in 5 ms slices one after another, as React's
 * scheduler does while it hydrates, so it never goes idle in that time,
 * and then mounts one that nothing fails.
 */
const busy = (ms: number) => `
<main><h1>Stand-in</h1></main>
<script>
  ${MOUNT}
  addEventListener('load', () => {
    mount(true);
    const end = performance.now() + ${ms};
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const slice = performance.now() + 5;
      while (performance.now() < slice);
      if (performance.now() < end) channel.port2.postMessage(undefined);
      else mount(false);
    };
    channel.port2.postMessage(undefined);
  });
</script>`;

/** What `check` failed with, its colours stripped, or nothing when it passed. */
async function failure(check: Promise<void>): Promise<string> {
  try {
    await check;
    return '';
  } catch (error) {
    return stripVTControlCharacters((error as Error).message);
  }
}

/** The tests that expect the check to fail stop its reads at 2 s, not 10. */
const SHORT = { timeout: 2_000 };
const SHORT_TIMEOUT = 'Timeout 2000ms exceeded';

const mounted = (page: Page) =>
  page.evaluate(
    () =>
      (globalThis as { __portfolioMountedEnhancements?: number }).__portfolioMountedEnhancements,
  );

/** A manifest's enhancements, one for each `requires` given. */
const declaring = (...requires: string[][]) => ({
  enhancements: requires.map((needs, index) => ({
    id: `stand-in-${index}`,
    export: `./enhancements/stand-in-${index}`,
    requires: needs,
  })),
});

test.describe('the throw-switch check', () => {
  test('waits for an enhancement that mounts once the page is idle, and passes when the switch failed it', async ({
    page,
  }) => {
    const failed = await failEveryEnhancement(page);
    await open(page, enhancements(true));
    await expectEveryEnhancementFailed(page, failed);
    expect(await mounted(page)).toBe(2);
    expect(failed()).toBe(2);
  });

  test('fails when an enhancement that mounts once the page is idle is not failed', async ({
    page,
  }) => {
    const failed = await failEveryEnhancement(page);
    await open(page, enhancements(false));
    const message = await failure(expectEveryEnhancementFailed(page, failed, 0, SHORT));
    expect(message).toContain('2 mounted, 1 failed');
    expect(message).toContain(SHORT_TIMEOUT);
  });

  test('fails when an enhancement that nothing fails mounts after 2.5 s of hydration-like work', async ({
    page,
  }) => {
    // Longer than the second the counts have to hold, so only the wait for
    // idle keeps the check from passing before the late one mounts.
    const failed = await failEveryEnhancement(page);
    await open(page, busy(2_500));
    expect(await failure(expectEveryEnhancementFailed(page, failed, 0, SHORT))).toContain(
      '2 mounted, 1 failed',
    );
  });

  test('waits out a page still busy when an idle callback times out, and fails the enhancement that mounts after', async ({
    page,
  }) => {
    // Busy past the idle callback's 5 s timeout: the wait arms it again,
    // where taking the timed-out callback as idle passed at about 6.3 s.
    const failed = await failEveryEnhancement(page);
    await open(page, busy(7_000));
    expect(await failure(expectEveryEnhancementFailed(page, failed, 0, SHORT))).toContain(
      '2 mounted, 1 failed',
    );
  });

  test('fails when the kit mounted fewer than the floor', async ({ page }) => {
    const failed = await failEveryEnhancement(page);
    await open(page, '<main><h1>Stand-in</h1></main>');
    const message = await failure(expectEveryEnhancementFailed(page, failed, 1, SHORT));
    expect(message).toContain('0 mounted, 0 failed');
    expect(message).toContain(SHORT_TIMEOUT);
  });

  test('on complete, an enhancement with no requires sets a floor of one, and one behind requires sets none', async ({
    page,
  }) => {
    // fixtures.spec.ts names the project's fixture for each mode; complete
    // renders every kind, so it's where a composition mounts one.
    expect(enhancementFloor(declaring([]), 'complete')).toBe(1);
    expect(enhancementFloor(declaring(['webgl2'], []), 'complete')).toBe(1);
    expect(enhancementFloor(declaring(['webgl2']), 'complete')).toBe(0);
    expect(enhancementFloor(declaring(['motion-allowed', 'min-width:768']), 'complete')).toBe(0);
    expect(enhancementFloor(declaring([]), 'sparse')).toBe(0);
    expect(enhancementFloor(declaring([]), undefined)).toBe(0);
    expect(enhancementFloor({}, 'complete')).toBe(0);
    // Behind requires, a page that mounts none passes, as headless Chromium
    // without WebGL 2 would leave it.
    const failed = await failEveryEnhancement(page);
    await open(page, '<main><h1>Stand-in</h1></main>');
    await expectEveryEnhancementFailed(
      page,
      failed,
      enhancementFloor(declaring(['webgl2']), 'complete'),
    );
  });
});

test.describe('the fixture a check names', () => {
  // fixtures.spec.ts passes each project's fixture to checkMode, and the
  // floor follows it, so a project that names one fails a check naming
  // another, or none, before it looks at the page.
  for (const named of [undefined, 'sparse'] as const) {
    test(`fails on the complete project when the check names ${named ?? 'no fixture'}`, async ({
      page,
      context,
      request,
    }, testInfo) => {
      const project = { ...testInfo.project, metadata: { fixture: 'complete' } };
      const message = await failure(
        checkMode({
          mode: 'desktop',
          page,
          context,
          request,
          variant: { manifest: { id: 'stand-in', ...declaring([]) } } as never,
          testInfo: { ...testInfo, project } as TestInfo,
          go: (target) => target.goto(`${ORIGIN}/`),
          shot: 'stand-in',
          fixture: named,
        }),
      );
      expect(message).toContain("the fixture the check names is the project's");
    });
  }
});

test.describe('the readable check', () => {
  /** A nav with a link and no box: what a reader can't reach. */
  const boxless = '<nav style="width: 0; height: 0; overflow: hidden"><a href="#a">A</a></nav>';
  const within = (inside: string) => `<main><h1>Stand-in</h1>${inside}</main>`;

  test('fails an open, visible nav with no box', async ({ page }) => {
    await open(page, within(boxless));
    expect(await failure(expectReadable(page))).toContain(JSON.stringify('nav "A": no box'));
  });

  test('passes a nav with no height whose links are placed outside it, as an arc places its stops', async ({
    page,
  }) => {
    await open(
      page,
      within(
        `<div style="position: relative; height: 80px"><nav style="width: 100%"><ol style="display: block; padding: 0; margin: 0">
<li style="position: absolute; top: 10px; left: 30%"><a href="#a">A</a></li>
<li style="position: absolute; top: 40px; left: 60%"><a href="#b">B</a></li></ol></nav></div>`,
      ),
    );
    expect(await page.locator('nav').evaluate((nav) => nav.getBoundingClientRect().height)).toBe(0);
    await expectReadable(page);
  });

  test('fails a nav with a box whose links have none', async ({ page }) => {
    await open(
      page,
      within('<nav style="padding: 16px"><a href="#a" style="display: none">A</a></nav>'),
    );
    expect(await failure(expectReadable(page))).toContain(JSON.stringify('nav "A": no box'));
  });

  test('fails a nav with no box inside an open <details>, a shown popover, or an open <dialog>', async ({
    page,
  }) => {
    await open(
      page,
      within(
        `<details open><summary>Open</summary>${boxless}</details><div id="sheet" popover>${boxless}</div><dialog open>${boxless}</dialog>`,
      ),
    );
    await page.evaluate(() => document.getElementById('sheet')!.showPopover());
    const message = await failure(expectReadable(page));
    expect(message.split(JSON.stringify('nav "A": no box')).length - 1).toBe(3);
  });

  test('fails a hidden or transparent nav, and an h1 with no box', async ({ page }) => {
    await open(
      page,
      `<main><h1 style="display: inline-block; width: 0; height: 0; overflow: hidden">Stand-in</h1>
<nav style="visibility: hidden"><a href="#b">B</a></nav>
<nav style="opacity: 0"><a href="#c">C</a></nav></main>`,
    );
    const message = await failure(expectReadable(page));
    expect(message).toContain(JSON.stringify('h1 "Stand-in": no box'));
    expect(message).toContain(JSON.stringify('nav "B": visibility hidden'));
    expect(message).toContain(JSON.stringify('nav "C": no opacity'));
  });

  test('passes a nav inside a closed popover, a closed <dialog>, a closed <details>, or a hidden or inert subtree', async ({
    page,
  }) => {
    await open(
      page,
      within(
        `<nav><a href="#top">Top</a></nav>
<div popover>${boxless}</div>
<section data-section-id="top"><dialog><h2>Menu</h2>${boxless}</dialog></section>
<details><summary>Closed</summary>${boxless}</details>
<div hidden>${boxless}</div>
<div inert style="visibility: hidden">${boxless}</div>`,
      ),
    );
    await expectReadable(page);
  });
});

test.describe("the readable check's wait for an entrance", () => {
  /** An h1 that fades up from 0 after `delay`, over `duration`, held at 0 until it starts. */
  const fading = (delay: string, duration: string) => `
<style>
  @keyframes rise { from { opacity: 0; } to { opacity: 1; } }
  h1 { animation: rise ${duration} ease-out ${delay} backwards; }
</style>
<main><h1>Stand-in</h1></main>`;
  const NO_OPACITY = JSON.stringify('h1 "Stand-in": no opacity');

  test('fails an h1 at opacity 0 with no animation', async ({ page }) => {
    await open(page, '<main><h1 style="opacity: 0">Stand-in</h1></main>');
    expect(await failure(expectReadable(page))).toContain(NO_OPACITY);
  });

  test('passes an h1 read mid-fade once its fade ends', async ({ page }) => {
    // HC's title card: a 0.36 s delay, a 0.9 s fade, and a backwards fill.
    await open(page, fading('0.36s', '0.9s'));
    await expectReadable(page);
  });

  test.describe('with JavaScript off', () => {
    // The no-javascript mode's page runs no timer or promise callback, so
    // the wait can't happen in it.
    test.use({ javaScriptEnabled: false });

    test('passes an h1 read mid-fade once its fade ends', async ({ page }) => {
      await open(page, fading('0.36s', '0.9s'));
      await expectReadable(page);
    });

    test('fails an h1 still at 0 when the wait ends', async ({ page }) => {
      await open(page, fading('30s', '1s'));
      const started = Date.now();
      expect(await failure(expectReadable(page))).toContain(NO_OPACITY);
      expect(Date.now() - started).toBeGreaterThanOrEqual(2_500);
    });
  });

  test('fails an h1 still at 0 when the wait ends', async ({ page }) => {
    await open(page, fading('30s', '1s'));
    const started = Date.now();
    expect(await failure(expectReadable(page))).toContain(NO_OPACITY);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_500);
  });

  test('reads an h1 under an infinite animation at once, and fails it at 0', async ({ page }) => {
    await open(
      page,
      `<style>
  @keyframes hold { from, to { opacity: 0; } }
  main { animation: hold 1s linear infinite; }
</style>
<main><h1>Stand-in</h1></main>`,
    );
    const started = Date.now();
    expect(await failure(expectReadable(page))).toContain(NO_OPACITY);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

test.describe('the print check', () => {
  test('fails a rendered element that is fixed or sticky', async ({ page }) => {
    await open(
      page,
      `<main><h1>Stand-in</h1><div class="pinned" style="position: fixed">P</div>
<nav class="rail" style="position: sticky; top: 0"><a href="#a">A</a></nav></main>`,
    );
    const message = await failure(expectNothingFixed(page));
    expect(message).toContain('div.pinned: fixed');
    expect(message).toContain('nav.rail: sticky');
  });

  test('passes a fixed or sticky element that is not rendered', async ({ page }) => {
    await open(
      page,
      `<main><h1>Stand-in</h1><div style="position: fixed; display: none">P</div>
<div style="display: none"><div style="position: sticky; top: 0">S</div></div></main>`,
    );
    await expectNothingFixed(page);
  });
});

test.describe('the screenshot image wait', () => {
  /** Images below the fold, which a lazy load leaves alone until the window nears them. */
  const below = (...names: string[]) =>
    `<main><h1>Stand-in</h1><div style="height: 6000px"></div>${names
      .map((name) => `<img src="${ORIGIN}${name}" loading="lazy" width="40" height="40" alt="">`)
      .join('')}</main>`;
  const incomplete = (page: Page) =>
    page.evaluate(() => [...document.images].filter((image) => !image.complete).length);

  test('loads every lazy image below the fold before the shot', async ({ page }) => {
    await open(page, below('/a.png', '/b.png', '/c.png'));
    expect(await incomplete(page), 'images the lazy load left alone').toBe(3);
    await loadImages(page);
    expect(await incomplete(page)).toBe(0);
    expect(
      await page.evaluate(() => [...document.images].every((image) => image.naturalWidth === 1)),
    ).toBe(true);
  });

  test('names an image that never loads, after about 10 s', async ({ page }) => {
    await open(page, below('/a.png', '/stalled.png'), '/stalled.png');
    const started = Date.now();
    expect(await failure(loadImages(page))).toContain(`${ORIGIN}/stalled.png`);
    expect(Date.now() - started).toBeGreaterThanOrEqual(9_500);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('the screenshot enhancement wait', () => {
  /**
   * A page that starts an enhancement's chunk as it loads, as a lazy
   * <Enhancement> does once the page hydrates, and whose chunk, once it
   * lands, hides the no-script contents list, as Aurora Glass's sky does
   * when it marks the page live (the capture race, 2026-11-03).
   */
  const lazy = (chunk: string) => `<main><h1>Stand-in</h1><nav id="contents">Index</nav></main>
<script>
  addEventListener('load', () => {
    const script = document.createElement('script');
    script.src = '${ORIGIN}${chunk}';
    document.head.append(script);
  });
</script>`;
  const LIVE = "document.getElementById('contents').hidden = true;";
  const listed = (page: Page) => page.evaluate(() => !document.getElementById('contents')!.hidden);

  test('waits for an enhancement chunk that lands after the page loaded, so the shot is the page it made', async ({
    page,
  }) => {
    const watch = watchEnhancements(page);
    try {
      await open(page, lazy('/chunk.js'), undefined, { '/chunk.js': { body: LIVE, after: 1_500 } });
      // Loaded, fonts in and two frames drawn, as settle() leaves it: the chunk is still on its way.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      expect(await listed(page), 'the contents list before the chunk lands').toBe(true);
      await expectEnhancementsSettled(watch);
      expect(await listed(page), 'the contents list once the chunk has run').toBe(false);
    } finally {
      watch.stop();
    }
  });

  /**
   * A page whose enhancement's first pass changes it a while after load with
   * no chunk or island to show it, as Aurora Glass's sky marks the page live
   * after hydration: it marks its own markup pending
   * (@portfolio/variant-contract/settle) until then, and `clears` says
   * whether it ever does.
   */
  const marked = (clears: boolean) => `<main><h1>Stand-in</h1>
<nav id="contents" ${ENHANCEMENT_PENDING}="stand-in">Index</nav></main>
<script>
  addEventListener('load', () => setTimeout(() => {
    if (!${clears}) return;
    const contents = document.getElementById('contents');
    contents.hidden = true;
    contents.removeAttribute('${ENHANCEMENT_PENDING}');
  }, 1500));
</script>`;

  test('waits for a first pass its markup marks pending, which no chunk or island shows', async ({
    page,
  }) => {
    const watch = watchEnhancements(page);
    try {
      await open(page, marked(true));
      expect(await listed(page), 'the contents list before the first pass').toBe(true);
      await expectEnhancementsSettled(watch);
      expect(await listed(page), 'the contents list once the first pass has run').toBe(false);
    } finally {
      watch.stop();
    }
  });

  test('fails, saying so, when a first pass marked pending never runs', async ({ page }) => {
    const watch = watchEnhancements(page);
    try {
      await open(page, marked(false));
      const started = Date.now();
      expect(await failure(expectEnhancementsSettled(watch))).toContain(STILL_ENHANCING);
      expect(Date.now() - started).toBeGreaterThanOrEqual(BUSY_LIMIT_MS - 100);
    } finally {
      watch.stop();
    }
  });

  test('fails, saying so, when an enhancement chunk never lands', async ({ page }) => {
    const watch = watchEnhancements(page);
    try {
      await open(page, lazy('/stalled.js'), '/stalled.js');
      const started = Date.now();
      expect(await failure(expectEnhancementsSettled(watch))).toContain(STILL_ENHANCING);
      expect(Date.now() - started).toBeGreaterThanOrEqual(BUSY_LIMIT_MS - 100);
    } finally {
      watch.stop();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});

test.describe('the stand-in host', () => {
  test('refuses every request and WebSocket outside its origin', async ({ page }) => {
    const elsewhere = 'https://elsewhere.test';
    const refused = await open(
      page,
      `<main><h1>Stand-in</h1><img src="${elsewhere}/a.png" alt=""></main>
<script>
  fetch('${elsewhere}/data').catch(() => {});
  new WebSocket('${elsewhere.replace('https', 'wss')}/socket');
</script>`,
    );
    await expect
      .poll(() => [...refused].sort())
      .toEqual([`${elsewhere}/a.png`, `${elsewhere}/data`, 'wss://elsewhere.test/socket']);
  });
});
