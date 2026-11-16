// A look spec beside capture-candidates.spec.ts: the same capture candidates on a real page where
// today's capture loses an image. Swiss Signal's sample at 1440 shows work 1's cover as an empty
// frame in about 1 first shot in 10 on CI Linux, with the img complete and decoded and nothing
// animating (L6's cover probe). Each candidate takes 20 first shots, as the variant shots take
// them (modes.ts: settle(), the enhancements' settle, loadImages()), and reads whether the cover's
// box is painted (its luminance spread, about 87 painted and 11 empty):
// - beyond: today's capture, fullPage past the viewport (the control);
// - grown-viewport: the viewport grown to the page's height and settled, then a viewport-only shot;
// - beyond-quiet: today's capture, with the page's resize listeners kept from the capture's resize
//   event by a capture-phase listener an init script adds before the page's own.
// A crop of the box and a JSON per shot go to PROOF_LOOK_OUT.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { decodePng, encodePng, type Image } from '../quality/lib/pixels';
import { loadImages, settle } from '../variants/modes';
import { SAMPLE_APP } from '../variants/target';
import { expect, test } from '../harness/fixtures';

const OUT = process.env.PROOF_LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
const COVER = '.ss-sel__row:first-child[data-thumb] .ss-sel__thumb img';
const VIEWPORT = { width: 1440, height: 900 };
test.use({ appOptions: SAMPLE_APP, viewport: VIEWPORT });
test.describe.configure({ timeout: 120_000 });

const derived = (log: string) =>
  readFileSync(log, 'utf8')
    .split('\n')
    .some((line) => line.startsWith('{') && line.includes('"event":"media.startup.derived"'));

/** Keeps the page's own resize listeners from a resize event while window.__shooting is set. */
function quietResize(): void {
  window.addEventListener(
    'resize',
    (event) => {
      if ((window as unknown as { __shooting?: boolean }).__shooting)
        event.stopImmediatePropagation();
    },
    true,
  );
}

/** The box's luminance spread (its standard deviation, 0 to 255). */
function spread(
  image: Image,
  box: { x: number; y: number; width: number; height: number },
): number {
  const values: number[] = [];
  for (let y = box.y; y < Math.min(image.height, box.y + box.height); y++)
    for (let x = box.x; x < Math.min(image.width, box.x + box.width); x++) {
      const i = (y * image.width + x) * 4;
      values.push(
        0.2126 * image.data[i]! + 0.7152 * image.data[i + 1]! + 0.0722 * image.data[i + 2]!,
      );
    }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return (
    Math.round(Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length) * 10) / 10
  );
}

function crop(image: Image, box: { x: number; y: number; width: number; height: number }): Image {
  const data = new Uint8Array(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++)
    for (let x = 0; x < box.width; x++) {
      const from = ((box.y + y) * image.width + box.x + x) * 4;
      data.set(image.data.subarray(from, from + 4), (y * box.width + x) * 4);
    }
  return { width: box.width, height: box.height, data };
}

const coverBox = (page: Page) =>
  page.evaluate((selector) => {
    const r = document.querySelector(selector)!.getBoundingClientRect();
    return {
      x: Math.round(r.left + scrollX),
      y: Math.round(r.top + scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }, COVER);

const MODES = ['beyond', 'grown-viewport', 'beyond-quiet'] as const;

for (const mode of MODES)
  for (let run = 1; run <= 20; run++) {
    const stem = `swiss-${mode}-${String(run).padStart(2, '0')}`;
    test(`swiss cover ${stem}`, async ({ page, app }) => {
      await expect.poll(() => derived(app.log), { timeout: 60_000 }).toBe(true);
      if (mode === 'beyond-quiet') await page.addInitScript(quietResize);
      const watch = watchEnhancements(page);
      try {
        await page.goto('/sample?variant=swiss-signal');
        await expect(page.locator('[data-variant="swiss-signal"]')).toHaveCount(1);
        await settle(page, true);
        const settled = await watch.settled();
        await loadImages(page);
        if (mode === 'grown-viewport') {
          const height = await page.evaluate(() =>
            Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
          );
          await page.setViewportSize({ width: VIEWPORT.width, height });
          await settle(page, true);
          await loadImages(page);
        }
        if (mode === 'beyond-quiet') {
          await page.evaluate(() => {
            (window as unknown as { __shooting?: boolean }).__shooting = true;
          });
        }
        const box = await coverBox(page);
        const first = decodePng(
          await page.screenshot({
            animations: 'disabled',
            caret: 'hide',
            fullPage: mode !== 'grown-viewport',
          }),
        );
        const sd = spread(first, box);
        const read = { stem, mode, settled, box, sd, painted: sd > 40 };
        writeFileSync(path.join(OUT, `${stem}.png`), encodePng(crop(first, box)));
        writeFileSync(path.join(OUT, `${stem}.json`), `${JSON.stringify(read)}\n`);
        console.log(`swisscover ${JSON.stringify(read)}`);
      } finally {
        watch.stop();
      }
    });
  }
