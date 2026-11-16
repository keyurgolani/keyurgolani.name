import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// A look, run from tests/e2e at the base and at the head: Aurora Glass's ornament slot with the
// visitor's Appearance control, at rest and with its summary focused from the keyboard, on one
// tuple, PROOF_LOOK_TUPLE (designLanguage/colorScheme/typography/displayMode), light and dark, at
// 1440, 1024 and 390, under reduced motion. Each shot goes to PROOF_LOOK_OUT as
// <tuple>-<scheme>-<width>-{rest,focused}.png. One tuple a file run, since a file takes one appOptions.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const TUPLE = process.env.PROOF_LOOK_TUPLE ?? 'utility-dense/warm-parchment/humanist-ui/system';
const [language, scheme, typography, mode] = TUPLE.split('/');
const TARGET = '#appearance > summary:nth-child(1)';
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
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
      .replace(/designLanguage: .*/, `designLanguage: ${language}`)
      .replace(/colorScheme: .*/, `colorScheme: ${scheme}`)
      .replace(/typography: .*/, `typography: ${typography}`)
      .replace(/displayMode: .*/, `displayMode: ${mode}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  contextOptions: { reducedMotion: 'reduce' },
});

for (const colorScheme of ['light', 'dark'] as const)
  test(`Aurora Glass's Appearance slot at rest and focused on ${TUPLE}, ${colorScheme}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    mkdirSync(OUT, { recursive: true });
    const stem = TUPLE.replaceAll('/', '_');
    for (const viewport of WIDTHS) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      const slot = page.locator('.ag-ornament > [data-visitor-control-slot]');
      await expect(slot).toHaveCount(1);
      const box = (await slot.boundingBox())!;
      const margin = 14;
      const x = Math.max(0, Math.floor(box.x - margin));
      const y = Math.max(0, Math.floor(box.y - margin));
      const clip = {
        x,
        y,
        width: Math.min(viewport.width, Math.ceil(box.x + box.width + margin)) - x,
        height: Math.ceil(box.height + 2 * margin),
      };
      const name = `${stem}-${colorScheme}-${viewport.width}`;
      writeFileSync(
        path.join(OUT, `${name}-rest.png`),
        await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }),
      );
      await page.keyboard.press('Shift');
      await page.locator(TARGET).focus();
      expect(await page.locator(TARGET).evaluate((el) => el.matches(':focus-visible'))).toBe(true);
      await settle(page);
      writeFileSync(
        path.join(OUT, `${name}-focused.png`),
        await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }),
      );
    }
  });
