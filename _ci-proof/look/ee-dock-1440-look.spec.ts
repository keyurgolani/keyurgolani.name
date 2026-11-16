import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';

// Editorial Evidence at 1440 on Platform Neutral, Warm Parchment, Accessible Reading, system, by
// default and under forced colours: down the page, what docks under the masthead (the hanging
// head and the chapter index), at rest and with the index's first link focused from the
// keyboard, with their boxes and the reading line against the masthead's foot. Optional faces
// are pinned to the designed ones. Each shot and reading goes to PROOF_LOOK_OUT. One appOptions
// a file run.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: accessible-reading')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 300))),
      ),
  );

const round = (v: number) => Math.round(v * 10) / 10;

for (const forcedColors of ['none', 'active'] as const) {
  const row = forcedColors === 'active' ? 'forced-colors' : 'default';
  test(`what docks under the masthead at 1440, ${row}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', forcedColors, contrast: 'no-preference' });
    await pinFaces(page, await optionalFaces(page), 'designed');
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await settle(page);
    mkdirSync(OUT, { recursive: true });
    const clip = { x: 0, y: 0, width: 1440, height: 260 };
    await page.screenshot({
      path: path.join(OUT, `dock-1440-${row}.png`),
      clip,
      animations: 'disabled',
      caret: 'hide',
    });
    const first = page.locator('.ee-rail__link').first();
    await page.keyboard.press('Shift');
    await first.focus();
    await settle(page);
    await page.screenshot({
      path: path.join(OUT, `dock-1440-${row}-focused.png`),
      clip,
      animations: 'disabled',
      caret: 'hide',
    });
    const read = await page.evaluate(() => {
      const box = (element: Element | null) => {
        const r = element?.getBoundingClientRect();
        return r ? [r.top, r.bottom] : null;
      };
      const heads = [...document.querySelectorAll('.ee-head')]
        .map((head) => head.getBoundingClientRect())
        .filter((r) => r.bottom > 0 && r.top < 260)
        .map((r) => [r.top, r.bottom]);
      const spy = document.querySelector<HTMLElement>('.ee-spy')!;
      return {
        masthead: box(document.querySelector('.ee-masthead')),
        token: getComputedStyle(document.querySelector('[data-variant]')!).getPropertyValue(
          '--layout-ee-bar',
        ),
        heads,
        rail: box(document.querySelector('.ee-rail')),
        line: Math.ceil(Number.parseFloat(getComputedStyle(spy).paddingBlockStart) || 0) + 1,
        scrollY,
      };
    });
    const r = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(r) : typeof v === 'number' ? round(v) : v;
    writeFileSync(
      path.join(OUT, `dock-1440-${row}.json`),
      `${JSON.stringify(Object.fromEntries(Object.entries(read).map(([k, v]) => [k, r(v)])))}\n`,
    );
  });
}
