import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_PORTFOLIO, startApp } from '../harness/app-server.mjs';
import {
  frameLoops,
  loadHome,
  runningAnimations,
  scrollThrough,
  scrollTops,
} from '../harness/motion';
import { FALLBACK_ID, VARIANTS } from '../harness/registry';

// #34's reduced-motion contract, for every composition this build registers
// (#5). Under motionPolicy reduce, whatever the visitor's setting, and under
// respect-os when the visitor asks for less motion: nothing runs once the
// page has settled, or after a jump, or as each part of the page scrolls
// into view; no script keeps asking for animation frames; and a navigation
// link jumps to its section, in the window or in a scroll container of the
// composition's own. The Web Animations API lists CSS animations,
// transitions, and script animations, so a reduced-motion rule in a
// stylesheet can't hide one. Each variant passes this as it registers (#13,
// #14). The fallback composition renders for a selection no package
// registers, so its case selects missing-variant. The controls show what
// each check sees: an animation and a frame loop the test starts, and smooth
// scrolling it turns on; tests/e2e/motion-harness.spec.ts shows the rest on
// pages of its own.
//
// Each case needs its own site document, so each starts its own server
// rather than the harness's one per file. The browser reaches nothing
// outside it, and the server nothing outside the machine.

const MOTION = path.join(path.dirname(DEFAULT_PORTFOLIO), 'motion');
const READ_ONLY = { type: 'profile', description: 'read-only' };
const SITE = readFileSync(path.join(MOTION, 'site.yml'), 'utf8');
const UNREGISTERED = 'missing-variant';

/** The motion fixture's site document, selecting `variant` under `policy`. */
function site(variant: string, policy: 'reduce' | 'respect-os'): string {
  const [selection, motion] = [`\n  variant: ${UNREGISTERED}\n`, '\nmotionPolicy: respect-os\n'];
  if (!SITE.includes(selection) || !SITE.includes(motion)) {
    throw new Error(`${MOTION}/site.yml no longer selects ${UNREGISTERED} under respect-os.`);
  }
  return SITE.replace(selection, `\n  variant: ${variant}\n`).replace(
    motion,
    `\nmotionPolicy: ${policy}\n`,
  );
}

const CASES = [
  { policy: 'reduce', reducedMotion: 'no-preference', when: 'under motionPolicy reduce' },
  {
    policy: 'respect-os',
    reducedMotion: 'reduce',
    when: 'under respect-os, when the visitor asks for reduced motion',
  },
] as const;

type App = Awaited<ReturnType<typeof startApp>>;

for (const { manifest } of VARIANTS) {
  const fallback = manifest.id === FALLBACK_ID;
  const selected = fallback ? UNREGISTERED : manifest.id;

  for (const { policy, reducedMotion, when } of CASES) {
    test.describe(`${manifest.id}, ${when}`, () => {
      // One server for the group's tests, in order.
      test.describe.configure({ mode: 'default' });
      test.use({
        contextOptions: { reducedMotion },
        // Short enough that the contact section starts below the fold.
        viewport: { width: 1280, height: 480 },
      });
      const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
      let app: App;

      test.beforeAll(async () => {
        // As long as the harness gives a server to start.
        test.setTimeout(120_000);
        app = await startApp({
          portfolio: path.join(MOTION, 'portfolio.yml'),
          siteText: site(selected, policy),
          logFile: test.info().outputPath('server.log'),
        });
      });
      test.afterAll(async () => {
        await app?.stop();
      });
      test.beforeEach(async ({ context }) => {
        await context.route('**/*', (route) =>
          new URL(route.request().url()).origin === app.origin
            ? route.continue()
            : route.abort('blockedbyclient'),
        );
      });
      test.afterEach(() => {
        expect(app.egress(), 'hosts the server tried to reach').toEqual([]);
      });

      test('nothing runs once the page has settled', { annotation }, async ({ page }) => {
        await loadHome(page, `${app.origin}/`);
        const root = page.locator('[data-variant]');
        await expect(root).toHaveAttribute('data-variant', manifest.id);
        await expect(root).toHaveAttribute('data-motion-policy', policy);
        if (fallback) await expect(root).toHaveAttribute('data-requested-variant', UNREGISTERED);
        const endless = (await runningAnimations(page)).filter((animation) => animation.endless);
        expect(endless).toEqual([]);
        await expect.poll(() => runningAnimations(page), { timeout: 5_000 }).toEqual([]);
        // No script keeps asking for frames.
        expect(await frameLoops(page)).toBeLessThan(5);
        // Nothing starts as each part of the page comes into view, and what
        // a scroll set off has stopped once it's done.
        expect(await scrollThrough(page)).toEqual([]);
        await expect.poll(() => runningAnimations(page), { timeout: 5_000 }).toEqual([]);

        // The controls: an endless animation and a frame loop the page starts
        // are ones the checks see.
        await page.evaluate(() => {
          document.querySelector('main')!.animate([{ opacity: 1 }, { opacity: 0.99 }], {
            duration: 1_000,
            iterations: Infinity,
          });
          const tick = () => requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        });
        expect(await runningAnimations(page)).toContainEqual({
          kind: 'script opacity',
          target: expect.stringMatching(/^main\b/),
          endless: true,
        });
        expect(await frameLoops(page)).toBeGreaterThan(20);
      });

      test('a navigation link jumps to its section', { annotation }, async ({ page }) => {
        await loadHome(page, `${app.origin}/`);
        const jump = await scrollTops(page, '#contact');
        // It moved the page, and no scroll event saw it anywhere but in place.
        expect(jump.before - jump.settled).toBeGreaterThan(100);
        expect(jump.farthest).toBeLessThan(4);
        // Arriving starts nothing endless, and whatever it started stops.
        const arrived = (await runningAnimations(page)).filter((animation) => animation.endless);
        expect(arrived).toEqual([]);
        await expect.poll(() => runningAnimations(page), { timeout: 5_000 }).toEqual([]);

        // The control: with smooth scrolling on, scroll events see the same click on its way.
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.addStyleTag({ content: 'html { scroll-behavior: smooth !important; }' });
        const smooth = await scrollTops(page, '#contact');
        expect(smooth.before - smooth.settled).toBeGreaterThan(100);
        expect(smooth.farthest).toBeGreaterThan(50);
      });
    });
  }
}
