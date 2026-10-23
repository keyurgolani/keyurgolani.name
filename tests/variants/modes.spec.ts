import { stripVTControlCharacters } from 'node:util';
import { expect, test, type Page, type Route } from '@playwright/test';
import {
  enhancementFloor,
  expectEveryEnhancementFailed,
  failEveryEnhancement,
  loadImages,
} from './modes';

// The modes' own checks (#12), each on a page that stands in for a
// composition, served from a host the test answers itself, so no app runs:
// the throw-switch check with an enhancement that mounts after the page goes
// idle, on a page that stays busy before it does, and the floor `complete`
// sets; the screenshot's wait for lazy images and for one that never loads;
// and the stand-in host, which lets nothing out.

const ORIGIN = 'https://modes.test';
/** A 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Serves `body` as the page at ORIGIN/, and a PNG for every image but
 * `stalled`, which never answers. A catch-all registered first refuses
 * every other request and every WebSocket. Playwright tries the route
 * registered last first, so the stand-in host's own route answers ahead
 * of it, and nothing the page asks for leaves the machine. Returns the
 * URLs the catch-all refused.
 */
async function open(page: Page, body: string, stalled?: string): Promise<string[]> {
  const refused: string[] = [];
  await page.route('**/*', (route) => {
    refused.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.routeWebSocket(/.*/, (socket) => {
    refused.push(socket.url());
    return socket.close();
  });
  await page.route(`${ORIGIN}/**`, (route: Route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><body>${body}</body></html>`,
      });
    }
    if (pathname === stalled) return new Promise<void>(() => {});
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
