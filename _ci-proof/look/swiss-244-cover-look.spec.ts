// Probe for Swiss Signal's sample cover (not for commit), run as a look on CI Linux at the base and the
// head: the sample at 1440 shot on the variant shot's own path (variants/modes.ts: prepareShot() before
// the load, settle(), capturePage(): the enhancements settled, loadImages(), finite animations waited
// out, the whole page with animations disabled), then two more whole-page shots straight after, as
// toHaveScreenshot takes consecutive shots. 20 runs plain, and 10 with Chromium told of critical
// memory pressure just before the capture (Memory.simulatePressureNotification), which drops decoded
// images. Per run: whether work 1's Selected-work cover box is painted in each shot (the spread of its
// pixels' luminance), the img's decoding and state. A PNG of the box and a JSON per run to
// $PROOF_LOOK_OUT, and a "coverprobe {json}" line to stdout.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { decodePng, encodePng, type Image } from '../quality/lib/pixels';
import { capturePage, prepareShot, settle } from '../variants/modes';
import { SAMPLE_APP } from '../variants/target';
import { expect, test } from '../harness/fixtures';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
const COVER = '.ss-sel__row:first-child[data-thumb] .ss-sel__thumb img';
const SHOT = { animations: 'disabled', caret: 'hide', fullPage: true } as const;
test.use({ appOptions: SAMPLE_APP, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

const derived = (log: string) =>
  readFileSync(log, 'utf8')
    .split('\n')
    .some((line) => line.startsWith('{') && line.includes('"event":"media.startup.derived"'));

const state = (page: Page) =>
  page.evaluate((selector) => {
    const img = document.querySelector<HTMLImageElement>(selector)!;
    const r = img.getBoundingClientRect();
    return {
      box: {
        x: Math.round(r.left + scrollX),
        y: Math.round(r.top + scrollY),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
      img: {
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        loading: img.getAttribute('loading'),
        decoding: img.getAttribute('decoding'),
      },
    };
  }, COVER);

/** The box's luminance spread (its standard deviation, 0 to 255) and its distinct colours. */
function spread(image: Image, box: { x: number; y: number; width: number; height: number }) {
  const values: number[] = [];
  const colours = new Set<number>();
  for (let y = box.y; y < Math.min(image.height, box.y + box.height); y++)
    for (let x = box.x; x < Math.min(image.width, box.x + box.width); x++) {
      const i = (y * image.width + x) * 4;
      const [r, g, b] = [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!];
      values.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      colours.add((r << 16) | (g << 8) | b);
    }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  return { sd: Math.round(sd * 10) / 10, colours: colours.size };
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

for (const [arm, runs] of [
  ['plain', 20],
  ['pressure', 10],
] as const)
  for (let run = 1; run <= runs; run++) {
    const stem = `${arm}-${String(run).padStart(2, '0')}`;
    test(`coverprobe ${stem}`, async ({ page, app }) => {
      await expect.poll(() => derived(app.log), { timeout: 60_000 }).toBe(true);
      const watch = await prepareShot(page);
      try {
        await page.goto('/sample?variant=swiss-signal');
        await expect(page.locator('[data-variant="swiss-signal"]')).toHaveCount(1);
        await settle(page, true);
        const before = await state(page);
        const first = decodePng(
          await capturePage(page, watch, {
            beforeShot:
              arm === 'pressure'
                ? async () => {
                    const cdp = await page.context().newCDPSession(page);
                    await cdp.send('Memory.simulatePressureNotification', { level: 'critical' });
                    await cdp.detach();
                  }
                : undefined,
          }),
        );
        const second = decodePng(await page.screenshot(SHOT));
        const third = decodePng(await page.screenshot(SHOT));
        const box = before.box;
        const read = {
          stem,
          shots: [spread(first, box), spread(second, box), spread(third, box)],
          before,
          after: await state(page),
        };
        writeFileSync(path.join(OUT, `${stem}.png`), encodePng(crop(first, box)));
        writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify(read));
        console.log(`coverprobe ${JSON.stringify(read)}`);
      } finally {
        watch.stop();
      }
    });
  }
