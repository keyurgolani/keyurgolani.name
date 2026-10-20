import path from 'node:path';
import { DEFAULT_PORTFOLIO } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { loadHome, runningAnimations, scrollTops } from '../harness/motion';

// The site's motionPolicy: reduce under Kinetic Cosmos (#4), whatever the
// visitor's setting. framer-motion animates through the Web Animations API,
// which the stylesheet's reduced-motion rule doesn't reach, so the variant
// itself has to stop it: nothing runs once the page loads, and a link jumps
// to its section. motion-os.spec.ts shows the same page animating when
// nothing asks for less.

const MOTION = path.join(path.dirname(DEFAULT_PORTFOLIO), 'motion');
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({
  appOptions: {
    portfolio: path.join(MOTION, 'portfolio.yml'),
    site: path.join(MOTION, 'site-reduce.yml'),
  },
  contextOptions: { reducedMotion: 'no-preference' },
});

test(
  'under motionPolicy reduce nothing animates once the page has loaded',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await loadHome(page);
    await expect(page.locator('[data-variant]').first()).toHaveAttribute(
      'data-motion-policy',
      'reduce',
    );
    // The hero is there without an entrance.
    await expect(page.locator('.kc-hero__inner')).toHaveCSS('opacity', '1');
    expect(await runningAnimations(page)).toEqual([]);
  },
);

test(
  'under motionPolicy reduce a navigation link jumps to its section',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await loadHome(page);
    const { first, settled } = await scrollTops(page, '#contact');
    expect(Math.abs(first - settled)).toBeLessThan(4);
  },
);
