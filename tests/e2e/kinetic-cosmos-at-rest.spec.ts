import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { loadHome, runningAnimations } from '../harness/motion';

// Kinetic Cosmos at rest on a phone, its runtime active, on the complete
// contract fixture, at the perf lab's 390 px, where its sections fold and its
// script closes them. While any CSS animation runs on a page the browser
// observes for intersections (its own observation of the page's links is
// one), each vsync gives the main thread a frame that restyles the animated
// element (Blink's reason: Animation), and that work is the idle time the
// perf cell measures: at the lab's 4x throttle, hundreds of ms in its 5 s
// window, where the page with every animation still takes 11 to 21. So the
// opening's three animations come to rest in about 3 s and hold where they
// stopped, and after that the page's main thread has nothing to restyle.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  // The perf lab's phone (tests/quality/lib/perf/measure.ts's LAB_DEVICE).
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

/** The opening's run, about 3 s, and a second's margin: after it, the page is at rest. */
const RUN_MS = 4_000;
/** How long the page is watched at rest. */
const AT_REST_MS = 2_000;
/**
 * The style recalculations allowed in that time. A running animation the
 * main thread ticks restyles its element every vsync, about 120 in 2 s at
 * 60 Hz; a page at rest restyles only on an event, such as an observer's
 * callback.
 */
const AT_REST_RECALCS = 8;

/** What the stage says of its runtime. */
function stage(page: Page) {
  return page.evaluate(() => ({
    runtime: document.querySelector('.kc-opening')?.getAttribute('data-runtime') ?? null,
    activity: document.querySelector('.kc-opening')?.getAttribute('data-activity') ?? null,
  }));
}

/** The animation names the stage's three boxes compute to, read from their style alone. */
function loopNames(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.kc-opening :is(.kc-spin, .kc-sky__drift)')]
      .map((element) => getComputedStyle(element).animationName)
      .filter((name) => name !== 'none')
      .sort(),
  );
}

test(
  'once the opening has come to rest, the main thread restyles nothing frame by frame',
  { annotation },
  async ({ page }) => {
    await loadHome(page, '/');
    await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'kinetic-cosmos');
    await expect.poll(() => stage(page)).toMatchObject({ runtime: 'active', activity: null });
    // The three are on: read from computed style, so nothing here holds an animation object.
    await expect
      .poll(() => loopNames(page))
      .toEqual(['kinetic-cosmos-drift', 'kinetic-cosmos-spin', 'kinetic-cosmos-spin-inner']);
    // The pointer away from the orrery, which holds the orbits while hovered.
    await page.mouse.move(380, 834);
    await page.waitForTimeout(RUN_MS);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const recalcs = async () =>
      (await cdp.send('Performance.getMetrics')).metrics.find(
        (metric) => metric.name === 'RecalcStyleCount',
      )!.value;
    const before = await recalcs();
    await page.waitForTimeout(AT_REST_MS);
    const restyled = (await recalcs()) - before;
    expect(
      restyled,
      `style recalculations in ${AT_REST_MS} ms once the opening has come to rest`,
    ).toBeLessThanOrEqual(AT_REST_RECALCS);
    // At rest: nothing runs, and the runtime is still active, so the window was the page's own.
    expect(await runningAnimations(page)).toEqual([]);
    expect(await stage(page)).toMatchObject({ runtime: 'active', activity: null });
  },
);
