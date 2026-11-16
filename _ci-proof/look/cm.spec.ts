import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// A read for the 160 proof's look (copied in by the CI proof kit, never committed): one Aurora Glass control at rest and focused from the keyboard,
// in the preference row L1_LOOK_ROW (default, forced-colors or contrast-more), at the widths L1_LOOK_WIDTHS names,
// on one tuple, the colour scheme its display mode's (dark for dark, else light). It prints the box,
// the client rects, the computed ring and, at rest, the box of the control's paragraph. Shots go to
// PROOF_LOOK_OUT (or L1_LOOK_OUT/<side>)/<tuple>-<name>-<row>-<width>-{rest,focused}.png; with no env it lists.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const OUT = process.env.PROOF_LOOK_OUT ?? process.env.L1_LOOK_OUT ?? '';
const SIDE = process.env.L1_LOOK_SIDE ?? '';
const NAME = process.env.L1_LOOK_NAME ?? 'control';
const TARGET = process.env.L1_LOOK_SELECTOR ?? '#top .ag-id__acts > a:nth-child(1)';
const WIDTHS = (process.env.L1_LOOK_WIDTHS ?? '390').split(',').map(Number);
const ROW =
  (['forced-colors', 'contrast-more'] as const).find((r) => r === process.env.L1_LOOK_ROW) ??
  'default';
const TUPLE = process.env.L1_LOOK_TUPLE ?? 'letterpress/ocean-abyss/editorial-serif/dark';
const [language, scheme, typography, mode] = TUPLE.split('/');

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
      .replace(/designLanguage: .*/, `designLanguage: ${language}`)
      .replace(/colorScheme: .*/, `colorScheme: ${scheme}`)
      .replace(/typography: .*/, `typography: ${typography}`)
      .replace(/displayMode: .*/, `displayMode: ${mode}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(`look: ${NAME} at rest and focused, ${TUPLE}, ${ROW}`, async ({ page }) => {
  test.setTimeout(240_000);
  expect(OUT, 'PROOF_LOOK_OUT').not.toBe('');
  const dir = path.join(OUT, SIDE);
  mkdirSync(dir, { recursive: true });
  await page.emulateMedia({
    colorScheme: mode === 'dark' ? 'dark' : 'light',
    reducedMotion: 'reduce',
    forcedColors: ROW === 'forced-colors' ? 'active' : 'none',
    contrast: ROW === 'contrast-more' ? 'more' : 'no-preference',
  });
  for (const width of WIDTHS) {
    const size = { width, height: width >= 1024 ? 900 : 844 };
    await page.setViewportSize(size);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches)).toBe(
      ROW === 'contrast-more',
    );
    const control = page.locator(TARGET);
    await expect(control).toHaveCount(1);
    await control.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const box = (await control.boundingBox())!;
    const m = 16;
    const x = Math.max(0, Math.floor(box.x - m));
    const y = Math.max(0, Math.floor(box.y - m));
    const clip = {
      x,
      y,
      width: Math.min(size.width, Math.ceil(box.x + box.width + m)) - x,
      height: Math.min(size.height, Math.ceil(box.y + box.height + m)) - y,
    };
    const name = `${TUPLE.replaceAll('/', '_')}-${NAME}-${ROW}-${width}`;
    const shape = await control.evaluate((el) => ({
      rects: [...el.getClientRects()].map((r) =>
        [r.x, r.y, r.width, r.height].map((v) => +v.toFixed(2)),
      ),
      paragraph: (() => {
        const r = el.parentElement!.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map((v) => +v.toFixed(2));
      })(),
    }));
    writeFileSync(
      path.join(dir, `${name}-rest.png`),
      await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }),
    );
    await page.keyboard.press('Shift');
    await control.focus();
    expect(await control.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    writeFileSync(
      path.join(dir, `${name}-focused.png`),
      await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }),
    );
    const ring = await control.evaluate((el) => {
      const own = getComputedStyle(el);
      return `${own.outlineWidth} ${own.outlineStyle} ${own.outlineColor} offset ${own.outlineOffset}, display ${own.display}, border ${own.borderTopWidth} ${own.borderTopStyle} ${own.borderTopColor}, radius ${own.borderTopLeftRadius}, shadow ${own.boxShadow}, background ${own.backgroundColor}, colour ${own.color}`;
    });
    console.log(
      `l1 look ${SIDE} ${name}: box ${JSON.stringify(box)}, rects ${JSON.stringify(shape.rects)}, paragraph ${JSON.stringify(shape.paragraph)}, ring ${ring}`,
    );
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
});
