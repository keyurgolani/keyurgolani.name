// Probe for Swiss Signal's sample cover (not for commit), run as a look on CI Linux at the base and the
// head: the sample at 1440 shot as the variant shots take it (variants/modes.ts: settle(), the
// enhancements' settle, loadImages(), a whole-page shot with animations disabled), 10 runs plain and 10
// with every observer's delivery held back 800 ms. Per run: whether work 1's cover box is painted (the
// spread of its pixels' luminance), the img's state, the document's animations, the settle holds, any
// containment above the img, and the same box in a second shot a second later. A PNG of the box and a
// JSON per run to $PROOF_LOOK_OUT, and a "coverprobe {json}" line to stdout.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { decodePng, encodePng, type Image } from '../quality/lib/pixels';
import { loadImages, settle } from '../variants/modes';
import { SAMPLE_APP } from '../variants/target';
import { expect, test } from '../harness/fixtures';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
const COVER = '.ss-sel__row:first-child[data-thumb] .ss-sel__thumb img';
const DELAY_MS = 800;
test.use({ appOptions: SAMPLE_APP, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

const derived = (log: string) =>
  readFileSync(log, 'utf8')
    .split('\n')
    .some((line) => line.startsWith('{') && line.includes('"event":"media.startup.derived"'));

/** The img's box on the page, its state, the animations, the holds and any containment above it. */
const state = (page: Page) =>
  page.evaluate(async (selector) => {
    const img = document.querySelector<HTMLImageElement>(selector)!;
    const r = img.getBoundingClientRect();
    const decode = await Promise.race([
      img.decode().then(
        () => 'resolved',
        (error: unknown) => `rejected ${String(error)}`,
      ),
      new Promise((done) => setTimeout(() => done('timeout 2s'), 2_000)),
    ]);
    const contained: string[] = [];
    for (let at: Element | null = img; at; at = at.parentElement) {
      const s = getComputedStyle(at);
      const parts = [
        s.contentVisibility !== 'visible' ? `content-visibility ${s.contentVisibility}` : '',
        s.contain !== 'none' ? `contain ${s.contain}` : '',
        s.transform !== 'none' ? `transform ${s.transform}` : '',
        s.willChange !== 'auto' ? `will-change ${s.willChange}` : '',
        Number(s.opacity) < 1 ? `opacity ${s.opacity}` : '',
      ].filter(Boolean);
      if (parts.length > 0)
        contained.push(`${at.localName}.${[...at.classList].join('.')}: ${parts.join(', ')}`);
    }
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
        currentSrc: img.currentSrc.replace(location.origin, ''),
        loading: img.getAttribute('loading'),
        decoding: img.getAttribute('decoding'),
        decode,
      },
      animations: document.getAnimations().map((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return `${a.constructor.name} ${a.playState} on ${target ? `${target.localName}.${[...target.classList].join('.')}` : 'none'}`;
      }),
      holds: [...document.querySelectorAll('[data-enhancement-pending]')].map(
        (el) =>
          `${el.localName}.${[...el.classList].join('.')}=${el.getAttribute('data-enhancement-pending')}`,
      ),
      contained,
      scrollY,
      now: Math.round(performance.now()),
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

const shot = async (page: Page) =>
  decodePng(await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true }));

for (const held of [false, true])
  for (let run = 1; run <= 10; run++) {
    const stem = `${held ? 'held' : 'plain'}-${String(run).padStart(2, '0')}`;
    test(`coverprobe ${stem}`, async ({ page, app }) => {
      await expect.poll(() => derived(app.log), { timeout: 60_000 }).toBe(true);
      if (held)
        await page.addInitScript((delay) => {
          const Native = window.IntersectionObserver;
          window.IntersectionObserver = class extends Native {
            constructor(
              callback: IntersectionObserverCallback,
              options?: IntersectionObserverInit,
            ) {
              super(
                (entries, observer) => window.setTimeout(() => callback(entries, observer), delay),
                options,
              );
            }
          };
        }, DELAY_MS);
      const watch = watchEnhancements(page);
      try {
        await page.goto('/sample?variant=swiss-signal');
        await expect(page.locator('[data-variant="swiss-signal"]')).toHaveCount(1);
        await settle(page, true);
        const settled = await watch.settled();
        await loadImages(page);
        const before = await state(page);
        const first = await shot(page);
        const after = await state(page);
        await page.waitForTimeout(1_000);
        const second = await shot(page);
        const box = before.box;
        const read = {
          stem,
          settled,
          firstSpread: spread(first, box),
          secondSpread: spread(second, box),
          before,
          afterShot: { animations: after.animations, holds: after.holds, img: after.img },
        };
        writeFileSync(path.join(OUT, `${stem}.png`), encodePng(crop(first, box)));
        writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify(read));
        console.log(`coverprobe ${JSON.stringify(read)}`);
      } finally {
        watch.stop();
      }
    });
  }
