// Look for Swiss Signal's part words (not for commit), v2: every part's heading on home, base and
// head, at 320 and 390 with 200% root text under Humanist UI and Accessible Reading, where the part
// words broke inside the word, and as stills ("still-", where nothing may move) at 320 and 390 at
// 100% text and at 768 with 200% text under Humanist UI. Each shot clips the part's h2 alone, its
// box and 16 px around it, after scrolling the page so the h2 sits 32 px below the sticky masthead's
// foot (the masthead stays as it is, never hidden); the test fails if the clip would reach the
// masthead or leave the window. v1 clipped the whole opener, taller than the window, and the
// masthead painted over its top. PNGs and each shot's boxes under $PROOF_LOOK_OUT.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
test.use({ appOptions: servingSwissSignal() });
test.describe.configure({ timeout: 180_000 });

const HUMANIST: Tuple = 'platform-neutral/warm-parchment/humanist-ui/system';
const ACCESSIBLE: Tuple = 'memphis/neon-city/accessible-reading/dark';
const PARTS = ['work', 'writing', 'record', 'about', 'contact'];
const PAD = 16;
const BELOW = 32;

const VIEWS: readonly {
  stem: string;
  tuple: Tuple;
  width: number;
  height: number;
  text: number;
}[] = [
  { stem: 'humanist-320-200', tuple: HUMANIST, width: 320, height: 568, text: 2 },
  { stem: 'humanist-390-200', tuple: HUMANIST, width: 390, height: 844, text: 2 },
  { stem: 'accessible-320-200', tuple: ACCESSIBLE, width: 320, height: 568, text: 2 },
  { stem: 'accessible-390-200', tuple: ACCESSIBLE, width: 390, height: 844, text: 2 },
  { stem: 'still-humanist-320', tuple: HUMANIST, width: 320, height: 568, text: 1 },
  { stem: 'still-humanist-390', tuple: HUMANIST, width: 390, height: 844, text: 1 },
  { stem: 'still-humanist-768-200', tuple: HUMANIST, width: 768, height: 1024, text: 2 },
];

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Scrolls the part's h2 to BELOW px under the masthead's foot; returns both boxes, in the window. */
const place = (page: Page, part: string) =>
  page.evaluate(
    ({ part, below }) => {
      const h2 = document.querySelector<HTMLElement>(
        `.ss-part[data-part='${part}'] .ss-part__title`,
      );
      const mast = document.querySelector<HTMLElement>('.ss-masthead');
      if (!h2 || !mast) return null;
      const foot = mast.getBoundingClientRect().bottom;
      window.scrollTo(0, h2.getBoundingClientRect().top + window.scrollY - foot - below);
      const box = h2.getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        foot: mast.getBoundingClientRect().bottom,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        window: { width: window.innerWidth, height: window.innerHeight },
      };
    },
    { part, below: BELOW },
  );

for (const view of VIEWS)
  test(`look ${view.stem}`, async ({ page, app }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: view.width, height: view.height });
    await openTuple(page, app.origin, view.tuple);
    if (view.text !== 1)
      await page.evaluate(
        (scale) =>
          document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
        view.text,
      );
    await frames(page);
    for (const part of PARTS) {
      await place(page, part);
      await frames(page);
      const at = await place(page, part);
      expect(at, `${part}'s h2 and the masthead`).not.toBeNull();
      const { box, foot } = at!;
      const x = Math.max(0, Math.floor(box.x - PAD));
      const y = Math.floor(box.y - PAD);
      const clip = {
        x,
        y,
        width: Math.min(at!.window.width, Math.ceil(box.x + box.width + PAD)) - x,
        height: Math.ceil(box.height + 2 * PAD),
      };
      expect(y, `${part}'s clip starts below the masthead's foot`).toBeGreaterThanOrEqual(foot);
      expect(y + clip.height, `${part}'s clip stays in the window`).toBeLessThanOrEqual(
        at!.window.height,
      );
      const stem = `${view.stem}-${part}`;
      await page.screenshot({
        path: path.join(OUT, `${stem}.png`),
        clip,
        animations: 'disabled',
        caret: 'hide',
      });
      writeFileSync(
        path.join(OUT, `${stem}.json`),
        JSON.stringify({ part, method: 'scrolled below the masthead', ...at, clip }),
      );
    }
  });
