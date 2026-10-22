import { stripVTControlCharacters } from 'node:util';
import { expect, test, type Page, type Route } from '@playwright/test';
import { expectEveryEnhancementFailed, failEveryEnhancement, loadImages } from './modes';

// The modes' own checks (#12), each on a page that stands in for a
// composition, served from a host the test answers itself, so no app runs:
// the throw-switch check with an enhancement that mounts after the page goes
// idle, and the screenshot's wait for lazy images and for one that never
// loads.

const ORIGIN = 'https://modes.test';
/** A 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** Serves `body` as the page at ORIGIN/, and a PNG for every image but `stalled`, which never answers. */
async function open(page: Page, body: string, stalled?: string): Promise<void> {
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
}

/**
 * A page that mounts one enhancement as it loads and another once it's
 * idle, as #6's islands will, each adding to the kit's count and failing
 * under the switch as the kit's do, the late one only if `lateFails`.
 */
const enhancements = (lateFails: boolean) => `
<main><h1>Stand-in</h1></main>
<script>
  function mount(fails) {
    globalThis.__portfolioMountedEnhancements += 1;
    if (fails && globalThis.__portfolioFailEnhancements) {
      console.error(new Error('Every enhancement fails: globalThis.__portfolioFailEnhancements is set.'));
    }
  }
  mount(true);
  requestIdleCallback(() => setTimeout(() => mount(${lateFails}), 300));
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

const mounted = (page: Page) =>
  page.evaluate(
    () =>
      (globalThis as { __portfolioMountedEnhancements?: number }).__portfolioMountedEnhancements,
  );

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
    expect(await failure(expectEveryEnhancementFailed(page, failed))).toContain(
      '2 mounted, 1 failed',
    );
  });

  test('fails when the kit mounted fewer than the floor', async ({ page }) => {
    const failed = await failEveryEnhancement(page);
    await open(page, '<main><h1>Stand-in</h1></main>');
    expect(await failure(expectEveryEnhancementFailed(page, failed, 1))).toContain(
      '0 mounted, 0 failed',
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
