import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { loadHome } from '../harness/motion';

// Look only, for a CI proof: what a reader sees of Kinetic Cosmos's opening on this tree, on the
// complete contract fixture, at 1024 and at the perf lab's phone. The same spec runs on each
// tree a proof compares: the landing tree, whose three ambient loops never end, and a tree whose
// loops come to rest. For each width: a shot while turning (1 s after the runtime is active) and
// at rest (4.5 s after it), the angles every 250 ms between, when the run started and ended on
// the document timeline (ms from navigation: each animation's startTime, and startTime plus its
// active duration; null for one that never ends) and when the test first saw every loop finished
// (null if none did by 6.5 s), the style recalculations in 2 s after that, the opening's animations as
// the browser reads them (iterations, duration, fill, and each keyframe's easing), whether this
// browser honours a var() in a keyframe's easing, and a shot under reduced motion.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
// The CI proof's look task sets PROOF_LOOK_OUT, and uploads all it holds: the shots and each width's JSON.
const OUT =
  process.env.PROOF_LOOK_OUT ?? process.env.KGN_LOOK_OUT ?? path.resolve('reports/kc-rest-look');

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

function stage(page: Page) {
  return page.evaluate(
    () => document.querySelector('.kc-opening')?.getAttribute('data-runtime') ?? null,
  );
}

/** The loops' computed animation names, read from style alone. */
function loopNames(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.kc-opening :is(.kc-spin, .kc-sky__drift)')]
      .map((element) => getComputedStyle(element).animationName)
      .filter((name) => name !== 'none')
      .sort(),
  );
}

/** Each plane's turn in degrees and the far stars' shift in px, from their computed transforms. */
function angles(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.kc-opening :is(.kc-spin, .kc-sky__drift)')].map((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        const plane = element.closest('.kc-plane')?.className.split(' ').at(-1) ?? 'sky';
        const value = plane === 'sky' ? matrix.e : (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
        return [plane, Math.round(value * 100) / 100];
      }),
    ),
  );
}

/** The opening's animations as the browser reads them: each one's timing and its keyframes' easing. */
function timings(page: Page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation instanceof CSSAnimation &&
          animation.animationName.startsWith('kinetic-cosmos-'),
      )
      .map((animation) => {
        const effect = animation.effect as KeyframeEffect;
        const timing = effect.getComputedTiming();
        return {
          name: (animation as CSSAnimation).animationName,
          playState: animation.playState,
          iterations: timing.iterations,
          duration: timing.duration,
          endTime: timing.endTime,
          fill: timing.fill,
          easing: timing.easing,
          keyframes: effect.getKeyframes().map((frame) => ({
            offset: frame.computedOffset,
            easing: frame.easing,
            transform: frame.transform ?? null,
          })),
        };
      }),
  );
}

/**
 * Whether this browser honours a var() in a keyframe's easing: two paused probes, one easing by
 * var(--probe) = steps(2, end) and one by the literal, each read a quarter of the way in. A curve
 * honoured holds the box at 0 px there; linear moves it 25, and ease about 41.
 */
function varEasing(page: Page) {
  return page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `@keyframes kc-probe-var { 0% { transform: translateX(0); animation-timing-function: var(--kc-probe-curve); } to { transform: translateX(100px); } }
@keyframes kc-probe-literal { 0% { transform: translateX(0); animation-timing-function: steps(2, end); } to { transform: translateX(100px); } }
.kc-probe { --kc-probe-curve: steps(2, end); position: fixed; inset: -10px auto auto -10px; inline-size: 1px; block-size: 1px; animation: 10s linear 1 paused; }`;
    document.head.append(style);
    const read = (name: string) => {
      const box = document.createElement('div');
      box.className = 'kc-probe';
      box.style.animationName = name;
      document.body.append(box);
      const animation = box.getAnimations()[0];
      if (!animation) {
        box.remove();
        return null;
      }
      animation.currentTime = 2_500;
      const x = new DOMMatrixReadOnly(getComputedStyle(box).transform).e;
      const easing = (animation.effect as KeyframeEffect).getKeyframes()[0]?.easing ?? null;
      box.remove();
      return { x: Math.round(x * 10) / 10, easing };
    };
    const result = { var: read('kc-probe-var'), literal: read('kc-probe-literal') };
    style.remove();
    return result;
  });
}

async function recalcsIn(page: Page, ms: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const count = async () =>
    (await cdp.send('Performance.getMetrics')).metrics.find(
      (metric) => metric.name === 'RecalcStyleCount',
    )!.value;
  const before = await count();
  await page.waitForTimeout(ms);
  const after = await count();
  await cdp.detach();
  return after - before;
}

/** The page loaded, the pointer away from the orrery. */
async function opened(page: Page, away: { x: number; y: number }) {
  await loadHome(page, '/');
  await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'kinetic-cosmos');
  await page.mouse.move(away.x, away.y);
}

async function look(page: Page, width: string, away: { x: number; y: number }) {
  mkdirSync(OUT, { recursive: true });
  const shot = (name: string) => path.join(OUT, `${width}-${name}.png`);
  await opened(page, away);
  await expect.poll(() => stage(page)).toBe('active');
  const start = Date.now();
  const names = await loopNames(page);
  const timing = await timings(page);
  // The run, sampled every 250 ms from the runtime going active, with a shot 1 s in and one 4.5 s in.
  const samples: { ms: number; at: Record<string, number> }[] = [];
  let turning = false;
  while (Date.now() - start < 4_500) {
    samples.push({ ms: Date.now() - start, at: await angles(page) });
    if (!turning && Date.now() - start >= 1_000) {
      await page.screenshot({ path: shot('turning') });
      turning = true;
    }
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: shot('rest') });
  const atRest = await angles(page);
  // The run on the document timeline (ms from navigation): when each loop started, and when its
  // active duration ends; Infinity for a loop that never does, written null.
  const run = await page.evaluate(() => {
    const loops = document
      .getAnimations()
      .filter(
        (animation) =>
          animation instanceof CSSAnimation &&
          animation.animationName.startsWith('kinetic-cosmos-'),
      );
    const starts = loops.map((animation) => Number(animation.startTime ?? NaN));
    const ends = loops.map(
      (animation, at) => starts[at]! + Number(animation.effect?.getComputedTiming().endTime ?? NaN),
    );
    const round = (value: number) => (Number.isFinite(value) ? Math.round(value) : null);
    return {
      startAtMs: round(Math.min(...starts)),
      endAtMs: round(Math.max(...ends)),
      nowMs: round(Number(document.timeline.currentTime ?? NaN)),
    };
  });
  const seenAtMs = await page
    .waitForFunction(
      () => {
        const loops = document
          .getAnimations()
          .filter(
            (animation) =>
              animation instanceof CSSAnimation &&
              animation.animationName.startsWith('kinetic-cosmos-'),
          );
        return loops.length > 0 && loops.every((animation) => animation.playState === 'finished')
          ? Math.round(performance.now())
          : false;
      },
      undefined,
      { timeout: 2_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  const recalcs = await recalcsIn(page, 2_000);
  const timingAfter = await timings(page);
  const probe = await varEasing(page);
  // Reduced motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await opened(page, away);
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: shot('reduced') });
  const line = {
    width,
    side: process.env.PROOF_LOOK_SIDE ?? null,
    names,
    timing,
    samples,
    atRest,
    run,
    seenAtMs,
    recalcs,
    timingAfter: timingAfter.map(({ name, playState }) => ({ name, playState })),
    probe,
    reducedNames: await loopNames(page),
    reducedAngles: await angles(page),
  };
  writeFileSync(path.join(OUT, `${width}.json`), `${JSON.stringify(line, null, 2)}\n`);
  console.log(`[kc-rest-look] ${JSON.stringify(line)}`);
}

test('kinetic-cosmos rest look at 1024', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await look(page, '1024', { x: 1010, y: 760 });
});

test.describe('the lab phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  test('kinetic-cosmos rest look at 390', async ({ page }) => {
    test.setTimeout(180_000);
    await look(page, '390', { x: 380, y: 834 });
  });
});
