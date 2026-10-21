import path from 'node:path';
import { DEFAULT_PORTFOLIO } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { loadHome, runningAnimations, scrollTops } from '../harness/motion';

// Kinetic Cosmos under motionPolicy: respect-os (#4): the visitor's
// reduced-motion setting decides. With it on, nothing repeats forever, what
// starts settles, and a link jumps to its section. With it off, the same page
// animates and scrolls smoothly, which shows these checks, and
// motion-reduce.spec.ts's, can see what they look for.

const MOTION = path.join(path.dirname(DEFAULT_PORTFOLIO), 'motion');
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({
  appOptions: {
    portfolio: path.join(MOTION, 'portfolio.yml'),
    site: path.join(MOTION, 'site.yml'),
  },
});

test.describe('when the visitor asks for reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test(
    'nothing repeats forever, and every animation settles',
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await loadHome(page);
      const endless = (await runningAnimations(page)).filter((animation) => animation.endless);
      expect(endless).toEqual([]);
      await expect.poll(() => runningAnimations(page), { timeout: 5_000 }).toEqual([]);
    },
  );

  test(
    'a navigation link jumps to its section',
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await loadHome(page);
      const { first, settled } = await scrollTops(page, '#contact');
      expect(Math.abs(first - settled)).toBeLessThan(4);
    },
  );
});

test.describe('when nothing asks for reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test(
    'the page animates, and something repeats forever',
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await loadHome(page);
      const running = await runningAnimations(page);
      expect(running.length).toBeGreaterThan(0);
      expect(running.filter((animation) => animation.endless).length).toBeGreaterThan(0);
    },
  );

  test(
    'a navigation link scrolls smoothly to its section',
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await loadHome(page);
      const { first, settled } = await scrollTops(page, '#contact');
      expect(Math.abs(first - settled)).toBeGreaterThan(100);
    },
  );
});
