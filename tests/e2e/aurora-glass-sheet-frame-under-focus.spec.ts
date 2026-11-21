import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { decodePng, pixel } from '../quality/lib/pixels';

// On a phone the signature sheet laps the opening pane's foot one focus ring's width below the
// ring of the action above it. While that action has focus, nothing the sheet casts may lie over
// the ring, but what it draws between the ring and its own top edge stays as it is: in art deco,
// the sheet's frame, a canvas and an accent line round its edge. The rows between the ring's outer
// edge and the sheet's top, across the sheet, read the same focused as at rest.

const TUPLE = 'art-deco/warm-parchment/humanist-ui/light';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const [designLanguage, colorScheme, typography, displayMode] = TUPLE.split('/');

test.use({
  isMobile: true,
  hasTouch: true,
  viewport: { width: 390, height: 844 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
      .replace(/designLanguage: .*/, `designLanguage: ${designLanguage}`)
      .replace(/colorScheme: .*/, `colorScheme: ${colorScheme}`)
      .replace(/typography: .*/, `typography: ${typography}`)
      .replace(/displayMode: .*/, `displayMode: ${displayMode}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const twoFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

test(
  `on ${TUPLE} at 390 the signature sheet's frame below the opening action's ring is the same while the action has focus`,
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    await page.emulateMedia({
      colorScheme: 'light',
      forcedColors: 'none',
      contrast: 'no-preference',
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    const boundary = page.locator('[data-variant]').first();
    await expect(boundary).toHaveAttribute('data-variant', 'aurora-glass');
    await expect(boundary).toHaveAttribute('data-design-language', designLanguage!);
    await expect(page.locator('.ag-opening')).toHaveAttribute('data-sheet', 'yes');
    await page.evaluate(() => document.fonts.ready);
    const control = page.locator('#top .ag-id__acts > a:nth-child(1)');
    await expect(control).toHaveCount(1);
    await control.scrollIntoViewIfNeeded();
    await page.keyboard.press('Shift');
    await control.focus();
    expect(await control.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
    const { ringOuter, sheetTop, sheetLeft, sheetWidth } = await page.evaluate(() => {
      const action = document.querySelector('#top .ag-id__acts > a:nth-child(1)')!;
      const style = getComputedStyle(action);
      const box = action.getBoundingClientRect();
      const sheet = document.querySelector('.ag-opening .ag-sig')!.getBoundingClientRect();
      return {
        ringOuter: box.bottom + parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth),
        sheetTop: sheet.top,
        sheetLeft: sheet.left,
        sheetWidth: sheet.width,
      };
    });
    // Whole pixel rows between the ring's outer edge and the sheet's top, across the sheet.
    const top = Math.ceil(ringOuter);
    const rows = Math.floor(sheetTop) - top;
    expect(rows, 'rows between the ring and the sheet').toBeGreaterThan(0);
    const clip = { x: Math.ceil(sheetLeft), y: top, width: Math.floor(sheetWidth), height: rows };
    await twoFrames(page);
    const shot = () => page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
    const focused = decodePng(await shot());
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await twoFrames(page);
    const rest = decodePng(await shot());
    let changed = 0;
    for (let i = 0; i < focused.width * focused.height; i++) {
      const [a, b] = [pixel(focused, i), pixel(rest, i)];
      if (Math.max(...[0, 1, 2].map((c) => Math.abs(a[c]! - b[c]!))) > 8) changed++;
    }
    console.log(
      `frame ${TUPLE}: clip ${JSON.stringify(clip)}, ${focused.width * focused.height} pixels, changed ${changed}`,
    );
    expect(changed, 'pixels of the sheet frame that change while the action has focus').toBe(0);
  },
);
