import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { decodePng, type Image } from '../quality/lib/pixels';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { SAMPLE_APP } from '../variants/target';
import { expect, test } from '../harness/fixtures';

// Swiss Signal's selected index rises 8 px, row by row, once the kit runtime's observer first
// reports the page in view. A capture waits for the page to settle (watchEnhancements(), the
// variant shots' and the quality cells' wait), and a rise that starts after it is fast-forwarded
// mid-flight by the shot's `animations: 'disabled'`: the sample's desktop shot then showed work 1's
// cover as an empty frame. So the page holds as unsettled until the rise has run. With every
// observer's delivery held back 800 ms, once the page has settled the rise has run, none of it
// starts or runs after, and the shot, taken as the variant shots take it, shows work 1's cover as
// the page at rest does. Held back past the hold's 4 s cap, the rise never runs: every row stands
// at rest, where it ends, at settle and after the delivery, and the shot shows the cover as well.

const annotation = [
  { type: 'route', description: '/sample?variant=swiss-signal' },
  { type: 'profile', description: 'demo' },
];
const DELAY_MS = 800;
/** Past the hold's cap (RISE_CAP_MS, 4 s), and well inside the test's time. */
const PAST_CAP_MS = 6_000;
/** The rise: --layout-motion-scene, and 40 ms a row, with a margin. */
const RISE_MS = 2_000;
const COVER = '.ss-sel__row:first-child[data-thumb] .ss-sel__thumb img';

test.use({ appOptions: SAMPLE_APP, viewport: { width: 1440, height: 900 } });
// The demo derives the sample's media once it starts, which the first test waits for.
test.describe.configure({ timeout: 120_000 });

/** Whether the server's log says its startup media derivation finished (variants/sample.spec.ts). */
const derived = (log: string) =>
  readFileSync(log, 'utf8')
    .split('\n')
    .some((line) => line.startsWith('{') && line.includes('"event":"media.startup.derived"'));

/** The rise's animations so far: how many started, and the states of those not finished. */
const rises = (page: Page) =>
  page.evaluate(() => {
    const all = (window as unknown as { __ssRises: Animation[] }).__ssRises;
    return {
      started: all.length,
      unfinished: all.filter((each) => each.playState !== 'finished').map((each) => each.playState),
    };
  });

/** The whole page shot as the variant shots take it, its images eager and decoded first. */
async function shot(page: Page): Promise<Image> {
  await page.evaluate(async () => {
    for (const image of document.images) image.loading = 'eager';
    await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
  });
  return decodePng(
    await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true }),
  );
}

/** The rows not at rest, where the rise ends: no translate, opaque, shown. */
const restless = (page: Page) =>
  page.locator('.ss-sel__row').evaluateAll((rows) =>
    rows.flatMap((row, index) => {
      const style = getComputedStyle(row);
      const still =
        ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(style.transform) &&
        ['none', '0px'].includes(style.translate) &&
        style.opacity === '1' &&
        row.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      return still
        ? []
        : [`row ${index + 1}: ${style.transform} ${style.translate} ${style.opacity}`];
    }),
  );

/** Work 1's cover, its box on the page. */
const coverBox = (page: Page) =>
  page.locator(COVER).evaluate((image: HTMLImageElement) => {
    const box = image.getBoundingClientRect();
    return {
      x: Math.round(box.left + scrollX),
      y: Math.round(box.top + scrollY),
      width: Math.round(box.width),
      height: Math.round(box.height),
      loaded: image.complete && image.naturalWidth > 0,
      shown: image.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
    };
  });

/** The share of the box's pixels that differ between two shots by more than 24 in a channel. */
function differing(
  a: Image,
  b: Image,
  box: { x: number; y: number; width: number; height: number },
) {
  let differ = 0;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      if ([0, 1, 2].some((c) => Math.abs(a.data[i + c]! - b.data[j + c]!) > 24)) differ++;
    }
  }
  return differ / (box.width * box.height);
}

/** What the page shows at settle, and once the held deliveries have come and any rise has run. */
async function read(page: Page, log: string, delay: number) {
  await expect
    .poll(() => derived(log), { message: 'startup media derived', timeout: 60_000 })
    .toBe(true);
  await page.addInitScript((delay) => {
    const Native = window.IntersectionObserver;
    window.IntersectionObserver = class extends Native {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(
          (entries, observer) => window.setTimeout(() => callback(entries, observer), delay),
          options,
        );
      }
    };
    // Every animation a selected row runs, from the page's first script on.
    const all: Animation[] = [];
    (window as unknown as { __ssRises: Animation[] }).__ssRises = all;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      const animation = animate.apply(this, args);
      if (this.matches('.ss-sel__row')) all.push(animation);
      return animation;
    };
  }, delay);
  const watch = watchEnhancements(page);
  try {
    await page.goto('/sample?variant=swiss-signal');
    await expect(page.locator('[data-variant]').first()).toHaveAttribute(
      'data-variant',
      'swiss-signal',
    );
    await expect(page.locator(COVER), 'work 1 has its cover').toHaveCount(1);
    expect(await watch.settled(), 'the page settles').toBe(true);
  } finally {
    watch.stop();
  }
  const atSettle = { ...(await rises(page)), restless: await restless(page) };
  const settledShot = await shot(page);
  // Delivered, any rise run, and at rest.
  await page.waitForTimeout(delay + RISE_MS);
  const landed = { ...(await rises(page)), restless: await restless(page) };
  const restShot = await shot(page);
  const box = await coverBox(page);
  const coverDiffers = differing(settledShot, restShot, box);
  const facts = JSON.stringify({ atSettle, landed, box, coverDiffers });
  console.log(`swiss rise settle (held ${delay} ms): ${facts}`);
  return { atSettle, landed, box, coverDiffers, facts };
}

test(
  "with its observers' first deliveries held back, Swiss Signal's sample settles only once its selected index has risen, work 1's cover in the shot",
  { annotation },
  async ({ page, app }) => {
    const { atSettle, landed, box, coverDiffers, facts } = await read(page, app.log, DELAY_MS);
    expect(
      {
        rose: landed.started > 0,
        risenAtSettle: atSettle.started > 0 && atSettle.unfinished.length === 0,
        nothingStartsAfterSettle: landed.started === atSettle.started,
        atRestAfter: landed.restless,
        coverShown: box.loaded && box.shown,
        coverAsAtRest: coverDiffers <= 0.02,
      },
      facts,
    ).toEqual({
      rose: true,
      risenAtSettle: true,
      nothingStartsAfterSettle: true,
      atRestAfter: [],
      coverShown: true,
      coverAsAtRest: true,
    });
  },
);

test(
  "with its observers' first deliveries held back past the hold's cap, the rise never runs and every selected row stands at rest, work 1's cover in the shot",
  { annotation },
  async ({ page, app }) => {
    const { atSettle, landed, box, coverDiffers, facts } = await read(page, app.log, PAST_CAP_MS);
    expect(
      {
        rose: landed.started > 0,
        atRestAtSettle: atSettle.restless,
        atRestAfter: landed.restless,
        coverShown: box.loaded && box.shown,
        coverAsAtRest: coverDiffers <= 0.02,
      },
      facts,
    ).toEqual({
      rose: false,
      atRestAtSettle: [],
      atRestAfter: [],
      coverShown: true,
      coverAsAtRest: true,
    });
  },
);
