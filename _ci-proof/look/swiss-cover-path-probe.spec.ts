// Probe for Swiss Signal's sample cover (not for commit), run as a look on CI Linux at the base and the
// head, on the rise look's own path (swiss-rise-look.spec.ts): goto, the enhancements' settle, for a
// plain run 4.4 s more, every image eager and decoded, then a whole-page shot clipped to the selected
// index. 10 runs plain and 10 with every observer's delivery held back 800 ms. Per run: whether work 1's
// cover is painted in that clipped shot, in an unclipped whole-page shot right after (the variants'
// form) and in a clipped one a second later; the img's state, the animations, the holds, the anchor's
// and the cover's computed opacity, visibility, content-visibility and transform, and the times. PNGs
// of the cover and a JSON per run to $PROOF_LOOK_OUT, and a "coverpath {json}" line to stdout.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { decodePng, encodePng, type Image } from '../quality/lib/pixels';
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

const ANCHOR = '.ss span[hidden]';

/** Computed opacity, visibility, content-visibility and transform of an element and its ancestors. */
const looks = (page: Page) =>
  page.evaluate(
    ({ cover, anchor }) => {
      const read = (el: Element | null) => {
        const out: string[] = [];
        for (let at = el; at && at !== document.documentElement; at = at.parentElement) {
          const s = getComputedStyle(at);
          const parts = [
            s.opacity !== '1' ? `opacity ${s.opacity}` : '',
            s.visibility !== 'visible' ? `visibility ${s.visibility}` : '',
            s.contentVisibility !== 'visible' ? `content-visibility ${s.contentVisibility}` : '',
            s.transform !== 'none' ? `transform ${s.transform}` : '',
          ].filter(Boolean);
          if (parts.length)
            out.push(`${at.localName}.${[...at.classList].join('.')}: ${parts.join(', ')}`);
        }
        return out;
      };
      const a = document.querySelector(anchor);
      return {
        cover: read(document.querySelector(cover)),
        anchor: a ? { pending: a.getAttribute('data-enhancement-pending'), chain: read(a) } : null,
      };
    },
    { cover: COVER, anchor: ANCHOR },
  );

for (const held of [false, true])
  for (let run = 1; run <= 10; run++) {
    const stem = `${held ? 'held' : 'plain'}-${String(run).padStart(2, '0')}`;
    test(`coverpath ${stem}`, async ({ page, app }) => {
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
        const t0 = Date.now();
        await page.goto('/sample?variant=swiss-signal');
        await expect(page.locator('[data-variant="swiss-signal"]')).toHaveCount(1);
        expect(await watch.settled()).toBe(true);
        const settledAt = Date.now() - t0;
        if (!held) await page.waitForTimeout(DELAY_MS * 3 + 2_000);
        // The look's shoot(): every image eager and decoded, then the clip of the selected index.
        await page.evaluate(async () => {
          for (const image of document.images) image.loading = 'eager';
          await Promise.all(
            [...document.images].map((image) => image.decode().catch(() => undefined)),
          );
        });
        const clip = await page
          .locator('.ss-sel')
          .first()
          .evaluate((el) => {
            const r = el.getBoundingClientRect();
            return {
              x: 0,
              y: Math.max(0, Math.round(r.top + scrollY)),
              width: innerWidth,
              height: Math.round(r.height),
            };
          });
        const before = await state(page);
        const style = await looks(page);
        const clipped = decodePng(
          await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true, clip }),
        );
        const shotAt = Date.now() - t0;
        const inClip = { ...before.box, x: before.box.x - clip.x, y: before.box.y - clip.y };
        const whole = decodePng(
          await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true }),
        );
        await page.waitForTimeout(1_000);
        const again = decodePng(
          await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true, clip }),
        );
        const read = {
          stem,
          settledAt,
          shotAt,
          clipped: spread(clipped, inClip),
          whole: spread(whole, before.box),
          again: spread(again, inClip),
          clip,
          before,
          style,
        };
        writeFileSync(path.join(OUT, `${stem}.png`), encodePng(crop(clipped, inClip)));
        writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify(read));
        console.log(`coverpath ${JSON.stringify(read)}`);
      } finally {
        watch.stop();
      }
    });
  }
