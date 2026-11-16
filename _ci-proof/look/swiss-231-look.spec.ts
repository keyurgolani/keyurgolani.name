// Look for Swiss Signal's ruled tables (not for commit), run as a look on CI Linux at the base and at
// the head: the episodes' and the writing tables, each whole, at 390, 768, 900, 1024, 1280, 1440 and
// 1920 at 100% and 200% root text under Accessible Reading and Humanist UI, and under forced colours
// in two drafting tuples at 390 and 1024 at 100% and at 1440 at 200%. The records' folds open, the
// page's sticky and fixed boxes hidden for the shot, so a table shows whole from its first row. A
// PNG per table and state in $PROOF_LOOK_OUT, with a JSON of each table's box.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
test.use({ appOptions: servingSwissSignal() });
test.describe.configure({ timeout: 300_000 });

const TABLES = { episodes: '#episodes .ss-table', writings: '#writings .ss-table' } as const;
const WIDTHS = [390, 768, 900, 1024, 1280, 1440, 1920];
const TYPES: Record<string, Tuple> = {
  accessible: 'memphis/neon-city/accessible-reading/dark',
  humanist: 'platform-neutral/warm-parchment/humanist-ui/system',
};
const FORCED: Record<string, Tuple> = {
  'forced-drafting-blue': 'carbon-inspired/drafting-blue/drafting-grotesk/dark',
  'forced-warm-parchment': 'platform-neutral/warm-parchment/drafting-grotesk/system',
};
const FORCED_STATES = [
  [390, 1],
  [1024, 1],
  [1440, 2],
] as const;
const HIDE = '[data-look-hide] { visibility: hidden !important; }';

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Opens the folds and sets the root text, then marks the page's sticky and fixed boxes to hide. */
async function prepare(page: Page, scale: number) {
  await page.evaluate((scale) => {
    for (const details of document.querySelectorAll('details')) details.open = true;
    document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important');
    for (const x of document.querySelectorAll<HTMLElement>('body *')) {
      const p = getComputedStyle(x).position;
      if (p === 'sticky' || p === 'fixed') x.setAttribute('data-look-hide', '');
    }
  }, scale);
  await settle(page);
}

/** Shoots each table whole, or records that it isn't shown. */
async function shootTables(page: Page, stem: string) {
  for (const [name, selector] of Object.entries(TABLES)) {
    const el = page.locator(selector).first();
    const file = `${stem}-${name}`;
    if ((await el.count()) === 0 || !(await el.isVisible())) {
      writeFileSync(path.join(OUT, `${file}.json`), JSON.stringify({ selector, shown: false }));
      continue;
    }
    await el.scrollIntoViewIfNeeded();
    await settle(page);
    const box = await el.boundingBox();
    await el.screenshot({
      path: path.join(OUT, `${file}.png`),
      animations: 'disabled',
      style: HIDE,
    });
    writeFileSync(path.join(OUT, `${file}.json`), JSON.stringify({ selector, box }));
  }
}

for (const [type, tuple] of Object.entries(TYPES))
  for (const width of WIDTHS)
    test(`look ${type} ${width}`, async ({ page, app }) => {
      await page.setViewportSize({ width, height: 900 });
      await openTuple(page, app.origin, tuple);
      for (const scale of [1, 2]) {
        await prepare(page, scale);
        await shootTables(page, `${type}-${width}-${scale * 100}`);
      }
      expect(true).toBe(true);
    });

for (const [name, tuple] of Object.entries(FORCED))
  test(`look ${name}`, async ({ page, app }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    for (const [width, scale] of FORCED_STATES) {
      await page.setViewportSize({ width, height: 900 });
      await openTuple(page, app.origin, tuple);
      await prepare(page, scale);
      await shootTables(page, `${name}-${width}-${scale * 100}`);
    }
    expect(
      await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
      'forced colours are on',
    ).toBe(true);
  });
