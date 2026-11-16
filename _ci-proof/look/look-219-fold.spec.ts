// Look shots for one proof (laid in by the proof kit, never in a head's tree): Obsidian Atelier's
// missing-media home in Warm Parchment, light, on phone emulation, the window's top: at 390 at the
// default text size, at 390 with the root text at 200%, closed and then with the Appearance control
// opened from the keyboard, and at 320 at the default text size. Beside each shot, the page's width
// and the top row's boxes: the name, the corner, the Appearance summary and panel, Index's slot and
// plate, and the entrance's plaque and band.
// Out: $PROOF_LOOK_OUT/<width>-<100|200>[-open].png and .json.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import {
  PANEL,
  SUMMARY,
  home,
  onMissingMediaHome,
  openFromKeyboard,
} from './obsidian-atelier-appearance';

onMissingMediaHome();

function boxes(page: Page) {
  return page.evaluate(
    ({ panel, summary }) => {
      const r = (n: number) => Math.round(n * 10) / 10;
      const at = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return b.width > 0 ? [r(b.left), r(b.top), r(b.right), r(b.bottom)] : null;
      };
      const entrance = document.querySelector('.oa-entrance');
      return {
        pageWide: document.scrollingElement!.scrollWidth,
        innerWidth,
        clientWidth: document.documentElement.clientWidth,
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        chrome: at('.oa-chrome'),
        mark: at('.oa-chrome__mark'),
        corner: at('.oa-chrome__corner'),
        summary: at(summary),
        panel: at(panel),
        dock: at('.oa-chrome__dock'),
        pin: at('.oa-chrome__pin'),
        entrance: at('.oa-entrance'),
        band: entrance ? getComputedStyle(entrance).paddingBlockStart : null,
        plaque: at('.oa-plaque'),
      };
    },
    { panel: PANEL, summary: SUMMARY },
  );
}

async function shot(page: Page, name: string) {
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(await boxes(page), null, 2)}\n`);
  const width = await page.evaluate(() => innerWidth);
  await page.screenshot({
    path: path.join(out, `${name}.png`),
    clip: { x: 0, y: 0, width, height: 560 },
    animations: 'disabled',
    caret: 'hide',
  });
}

test.describe('390', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('look 390 at the default text size', async ({ page, app }) => {
    await home(page, app.origin, { mode: 'light' });
    await shot(page, '390-100');
  });
  test('look 390 with the root text at 200%, closed and open', async ({ page, app }) => {
    await home(page, app.origin, { mode: 'light', rootText: '200%' });
    await shot(page, '390-200');
    await openFromKeyboard(page);
    await page.waitForTimeout(150);
    await shot(page, '390-200-open');
  });
});

test.describe('320', () => {
  test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  test('look 320 at the default text size', async ({ page, app }) => {
    await home(page, app.origin, { mode: 'light' });
    await shot(page, '320-100');
  });
});
