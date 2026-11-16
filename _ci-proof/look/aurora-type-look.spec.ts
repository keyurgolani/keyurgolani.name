import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// A look, run from tests/e2e at the base and at the head: Aurora Glass on the complete fixture in
// one type pack, PROOF_LOOK_PACK (platform-neutral, warm-parchment, the system display mode, so the
// emulated scheme picks light or dark), under reduced motion, at 1440 and 390, once the page's
// fonts are ready. Each shot goes to PROOF_LOOK_OUT as <pack>-<scheme>-<width>.png. One pack a
// file run, since a file takes one appOptions.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const PACK = process.env.PROOF_LOOK_PACK ?? 'field-serif';
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, `typography: ${PACK}`)
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  contextOptions: { reducedMotion: 'reduce' },
});

for (const colorScheme of ['light', 'dark'] as const)
  test(`Aurora Glass's home page in ${PACK}, ${colorScheme}, at 1440 and 390`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    mkdirSync(OUT, { recursive: true });
    for (const viewport of WIDTHS) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      expect(
        await page.evaluate(
          () => getComputedStyle(document.querySelector('[data-variant]')!).colorScheme,
        ),
        'the boundary renders the emulated scheme',
      ).toBe(colorScheme);
      writeFileSync(
        path.join(OUT, `${PACK}-${colorScheme}-${viewport.width}.png`),
        await page.screenshot({ animations: 'disabled', caret: 'hide' }),
      );
    }
  });
