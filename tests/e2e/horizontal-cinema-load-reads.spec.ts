import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Horizontal Cinema's controller asks the stage's computed style whether the strip shows, and the
// ask makes the browser bring the page's style up to date then and there. As the page hydrates, the
// runtime marks the shell, which leaves every scene's style to recompute, and the controller asked
// twice more in the same task: once to fit the strip again on the live scrubber, once more as the
// faces, already in, came ready. On a phone, where the strip never shows, neither pass changes
// anything, yet each paid for the whole page's style inside the load's longest task. A read in an
// animation frame costs nothing the frame doesn't pay anyway. At 390 by 844, once the scrubber is
// live, the controller reads the stage's style outside a frame no more as the page loads; at 1440
// by 900, where the strip shows, it still fits the strip again on the live scrubber at once. On the
// complete contract fixture.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/**
 * Loads the home and counts the computed-style reads of the stage made with the scrubber live and
 * outside an animation frame's callback, to two seconds after the load, the faces in.
 */
async function readsOnceLive(page: Page) {
  await page.addInitScript(() => {
    const state = { live: false, reads: [] as number[], inFrame: [] as number[] };
    (window as unknown as { __hcStageReads: typeof state }).__hcStageReads = state;
    let frame = false;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        frame = true;
        try {
          callback(time);
        } finally {
          frame = false;
        }
      });
    const own = window.getComputedStyle.bind(window);
    window.getComputedStyle = (element: Element, pseudo?: string | null) => {
      if (element instanceof Element && element.matches('.hc-stage')) {
        state.live ||= document.querySelector('.hc-scrub[data-live]') !== null;
        if (state.live) (frame ? state.inFrame : state.reads).push(Math.round(performance.now()));
      }
      return own(element, pseudo);
    };
  });
  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2_000);
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __hcStageReads: { live: boolean; reads: number[]; inFrame: number[] };
        }
      ).__hcStageReads,
  );
}

test.describe('390', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test(
    'at 390 by 844, once the scrubber is live, the controller reads the stage style outside a frame no more as the page loads',
    { annotation },
    async ({ page }) => {
      const read = await readsOnceLive(page);
      expect(read.live, 'the scrubber went live').toBe(true);
      expect(read.reads.length, JSON.stringify(read)).toBe(0);
    },
  );
});

test.describe('1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test(
    'at 1440 by 900, where the strip shows, the controller fits the strip again once the scrubber is live',
    { annotation },
    async ({ page }) => {
      const read = await readsOnceLive(page);
      expect(read.live, 'the scrubber went live').toBe(true);
      expect(read.reads.length, JSON.stringify(read)).toBeGreaterThan(0);
    },
  );
});
