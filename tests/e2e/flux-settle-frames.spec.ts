import type { Route } from '@playwright/test';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { MOTION_SAMPLER, motionFindings } from '../quality/lib/a11y/motion';
import { appFor } from './flux-shared';

// The kit's settle signal under reduced motion, through the quality cells' own
// frame-loop check (tests/quality/lib/a11y/motion.ts): no animation frame from
// 1 s to 4 s after load. <Enhancement> drops its signal at a task boundary
// after the enhancement's first commit, never at a frame, so an enhancement
// that attaches late in that window asks for none. On CI's slower runner,
// Flux's tabs enhancement attaches more than 1 s after load; here its chunk is
// held until 1.5 s after load, so the attach lands inside the window every
// run, with no CPU throttle. Its own file, since appOptions are per file.

const FIXTURE = contractFixture('complete');
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({ viewport: { width: 1440, height: 900 }, appOptions: appFor(FIXTURE) });

/** Only Flux's tabs enhancement sets this attribute, so only its chunk carries the name. */
const TABS_CHUNK_MARK = 'data-fx-scrolled';
const HOLD_AFTER_LOAD_MS = 1500;

test(
  "under reduced motion an enhancement attaching inside the frame window asks for no frame: Flux's tabs, held to 1.5 s after load",
  { annotation },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(MOTION_SAMPLER);
    const held: string[] = [];
    const loadEnd = () =>
      page.evaluate(
        () =>
          (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
            ?.loadEventEnd ?? 0,
      );
    await page.route(/\/_next\/static\/.+\.js(\?.*)?$/, async (route: Route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes(TABS_CHUNK_MARK)) {
        held.push(route.request().url());
        // The load event must come without it: a chunk that held load would move the window with it.
        await expect.poll(loadEnd, { timeout: 10_000 }).toBeGreaterThan(0);
        const release = (await loadEnd()) + HOLD_AFTER_LOAD_MS;
        await expect
          .poll(() => page.evaluate((at) => performance.now() >= at, release), { intervals: [50] })
          .toBe(true);
      }
      await route.fulfill({ response, body });
    });
    await page.goto('/');
    await expect(page.locator('[data-variant="flux"]')).toHaveCount(1);
    // The tabs attach (data-fx-folds), inside the window, and the settle signal goes.
    await expect(page.locator('.fx[data-fx-folds]')).toHaveCount(1, { timeout: 10_000 });
    const attachedAt = await page.evaluate(() => performance.now());
    const load = await loadEnd();
    expect(held).toHaveLength(1);
    expect(attachedAt - load).toBeGreaterThan(1000);
    expect(attachedAt - load).toBeLessThan(4000);
    await expect(page.locator('template[data-enhancement-pending]')).toHaveCount(0);
    const frameLoop = (await motionFindings(page)).filter(
      (finding) => finding.rule === 'frame-loop',
    );
    expect(frameLoop).toEqual([]);
  },
);
