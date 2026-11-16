import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';

// Editorial Evidence's masthead at 390 on Platform Neutral, Warm Parchment, PROOF_LOOK_TYPO,
// system, by default and under forced colours: at rest and with the name link focused from the
// keyboard, with the name's and the ring's boxes against the masthead's, and down the page with
// the chapter bar docked under the masthead, at rest and with its first link focused, and how much
// of that link's ring and text the masthead covers. Optional faces are
// pinned to the designed ones. Each shot and reading goes to PROOF_LOOK_OUT. One appOptions a
// file run.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const TYPO = process.env.PROOF_LOOK_TYPO ?? 'accessible-reading';

test.use({
  viewport: { width: 390, height: 844 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, `typography: ${TYPO}`)
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

const round = (v: number) => Math.round(v * 10) / 10;

for (const forcedColors of ['none', 'active'] as const) {
  const row = forcedColors === 'active' ? 'forced-colors' : 'default';
  test(`the masthead at 390 in ${TYPO}, ${row}, its name focused`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', forcedColors, contrast: 'no-preference' });
    await pinFaces(page, await optionalFaces(page), 'designed');
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    const masthead = page.locator('.ee-masthead');
    const name = page.locator('.ee-masthead__name');
    await expect(name).toHaveCount(1);
    mkdirSync(OUT, { recursive: true });
    const label = `masthead-${TYPO}-${row}`;
    await masthead.screenshot({
      path: path.join(OUT, `${label}-rest.png`),
      animations: 'disabled',
      caret: 'hide',
    });
    await page.keyboard.press('Shift');
    await name.focus();
    await frames(page);
    await masthead.screenshot({
      path: path.join(OUT, `${label}-focused.png`),
      animations: 'disabled',
      caret: 'hide',
    });
    const read = await name.evaluate((link) => {
      const style = getComputedStyle(link);
      const reach =
        Number.parseFloat(style.outlineWidth) + Math.max(0, Number.parseFloat(style.outlineOffset));
      const box = link.getBoundingClientRect();
      const bar = link.closest('.ee-masthead')!;
      const head = bar.getBoundingClientRect();
      const rule = Number.parseFloat(getComputedStyle(bar).borderBlockEndWidth) || 0;
      return {
        masthead: [head.top, head.bottom],
        name: [box.top, box.bottom],
        ring: [box.top - reach, box.bottom + reach],
        ruleTop: head.bottom - rule,
        clearAbove: box.top - reach - head.top,
        clearBelow: head.bottom - rule - (box.bottom + reach),
      };
    });
    // Down the page, the chapter bar docked under the masthead, at rest.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.evaluate(() => window.scrollTo(0, 1500));
    await frames(page);
    await frames(page);
    await page.screenshot({
      path: path.join(OUT, `${label}-docked.png`),
      clip: { x: 0, y: 0, width: 390, height: 120 },
      animations: 'disabled',
      caret: 'hide',
    });
    // And its first link focused from the keyboard there, its ring against the masthead's foot.
    const first = page.locator('.ee-rail__link').first();
    await page.keyboard.press('Shift');
    await first.focus();
    await frames(page);
    await page.screenshot({
      path: path.join(OUT, `${label}-docked-focused.png`),
      clip: { x: 0, y: 0, width: 390, height: 120 },
      animations: 'disabled',
      caret: 'hide',
    });
    const docked = await first.evaluate((link) => {
      const box = (element: Element | null) => {
        const r = element?.getBoundingClientRect();
        return r ? [r.top, r.bottom] : null;
      };
      const style = getComputedStyle(link);
      const reach =
        Number.parseFloat(style.outlineWidth) + Math.max(0, Number.parseFloat(style.outlineOffset));
      const range = document.createRange();
      range.selectNodeContents(link);
      const text = range.getBoundingClientRect();
      const masthead = document.querySelector('.ee-masthead')!.getBoundingClientRect();
      return {
        masthead: box(document.querySelector('.ee-masthead')),
        bar: box(document.querySelector('.ee-rail')),
        link: box(link),
        text: [text.top, text.bottom],
        ringTop: link.getBoundingClientRect().top - reach,
        ringUnder: masthead.bottom - (link.getBoundingClientRect().top - reach),
        textUnder: masthead.bottom - text.top,
        scrollY,
      };
    });
    writeFileSync(
      path.join(OUT, `${label}-docked.json`),
      `${JSON.stringify(Object.fromEntries(Object.entries(docked).map(([k, v]) => [k, Array.isArray(v) ? v.map(round) : typeof v === 'number' ? round(v) : v])))}\n`,
    );
    writeFileSync(
      path.join(OUT, `${label}.json`),
      `${JSON.stringify(Object.fromEntries(Object.entries(read).map(([k, v]) => [k, Array.isArray(v) ? v.map(round) : round(v)])))}\n`,
    );
  });
}
