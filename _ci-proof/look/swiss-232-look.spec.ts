// Look for Swiss Signal's part openers (not for commit): every part's opener on home, base and head,
// at 320 and 390 with 200% root text under Humanist UI and Accessible Reading, where the part words
// broke inside the word, and as stills ("still-", where nothing may move) at 320 and 390 at 100% text
// and at 768 with 200% text under Humanist UI. PNGs under $PROOF_LOOK_OUT; the same bytes at both sides.
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
      const el = page.locator(`.ss-part[data-part='${part}'] .ss-part__open`);
      await expect(el, `${part}'s opener`).toHaveCount(1);
      await el.scrollIntoViewIfNeeded();
      await frames(page);
      const box = await el.boundingBox();
      const stem = `${view.stem}-${part}`;
      await el.screenshot({ path: path.join(OUT, `${stem}.png`), animations: 'disabled' });
      writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify({ part, box }));
    }
  });
