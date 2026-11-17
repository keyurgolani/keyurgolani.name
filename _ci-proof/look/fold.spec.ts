import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// The 160 proof's look spec (copied in by the CI proof kit, never committed): a fold's summary on Aurora Glass at rest, focused from the
// keyboard, and open (its details opened, blurred), in the preference row L1_LOOK_ROW (default or
// forced-colors), at the widths L1_LOOK_WIDTHS names, on one tuple, the colour scheme its display
// mode's. It prints the summary's and its fold's boxes at rest and open, and the computed ring. Shots
// go to L1_LOOK_OUT/<side>/<tuple>-<name>-<row>-<width>-{rest,focused,open}.png; with no env it lists.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const OUT = process.env.PROOF_LOOK_OUT ?? process.env.L1_LOOK_OUT ?? '';
const SIDE = process.env.L1_LOOK_SIDE ?? '';
const NAME = process.env.L1_LOOK_NAME ?? 'control';
const TARGET =
  process.env.L1_LOOK_SELECTOR ??
  '#ag--band-record > div:nth-child(1) > details:nth-child(15) > summary:nth-child(1)';
const WIDTHS = (process.env.L1_LOOK_WIDTHS ?? '390').split(',').map(Number);
const ROW = process.env.L1_LOOK_ROW === 'forced-colors' ? 'forced-colors' : 'default';
const TUPLE = process.env.L1_LOOK_TUPLE ?? 'glassmorphism/warm-parchment/humanist-ui/system';
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

test(`look: ${NAME} at rest, focused and open, ${TUPLE}, ${ROW}`, async ({ page }) => {
  test.setTimeout(240_000);
  expect(OUT, 'PROOF_LOOK_OUT').not.toBe('');
  const dir = path.join(OUT, SIDE);
  mkdirSync(dir, { recursive: true });
  await page.emulateMedia({
    colorScheme: mode === 'dark' ? 'dark' : 'light',
    reducedMotion: 'reduce',
    forcedColors: ROW === 'forced-colors' ? 'active' : 'none',
  });
  for (const width of WIDTHS) {
    const size = { width, height: width >= 1024 ? 900 : 844 };
    await page.setViewportSize(size);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
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
    const boxes = () =>
      control.evaluate((el) => {
        const r = (x: DOMRect) => [x.x, x.y, x.width, x.height].map((v) => +v.toFixed(2));
        return {
          summary: r(el.getBoundingClientRect()),
          fold: r(el.parentElement!.getBoundingClientRect()),
        };
      });
    const shape = await boxes();
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
      return `${own.outlineWidth} ${own.outlineStyle} ${own.outlineColor} offset ${own.outlineOffset}, display ${own.display}, border ${own.borderTopWidth} ${own.borderTopStyle} ${own.borderTopColor}`;
    });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await control.evaluate((el) => {
      (el.parentElement as HTMLDetailsElement).open = true;
    });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const opened = await boxes();
    writeFileSync(
      path.join(dir, `${name}-open.png`),
      await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }),
    );
    console.log(
      `l1 look ${SIDE} ${name}: box ${JSON.stringify(box)}, rest ${JSON.stringify(shape)}, open ${JSON.stringify(opened)}, ring ${ring}`,
    );
  }
});
