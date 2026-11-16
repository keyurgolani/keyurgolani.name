import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Shell's whoami key and value lines under Geometric Display (a 17 px line): Atelier Luxury on Low-Stimulus Warm,
// dark, at 1440, 1024 and 390.
// Each shot goes to PROOF_LOOK_OUT. One appOptions a file run.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const LANGUAGE = 'atelier-luxury';
const TYPOGRAPHY = 'geometric-display';
const MODE = 'dark';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'shell')
      .replace(/designLanguage: .*/, `designLanguage: ${LANGUAGE}`)
      .replace(/typography: .*/, `typography: ${TYPOGRAPHY}`)
      .replace(/displayMode: .*/, `displayMode: ${MODE}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

async function visit(page: Page, origin: string, scheme: string, mode: string) {
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ scheme, mode }).toString(),
      url: origin,
    },
  ]);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-display-mode]').first()).toHaveAttribute(
    'data-display-mode',
    mode,
  );
  await settle(page);
}

async function shoot(target: Locator, name: string) {
  mkdirSync(OUT, { recursive: true });
  await target.screenshot({
    path: path.join(OUT, `${name}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
}

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [390, 844],
] as const) {
  test(`Shell's whoami block in Geometric Display at ${width}`, async ({ page, app }) => {
    await page.setViewportSize({ width, height });
    await visit(page, app.origin, 'low-stimulus-warm', 'dark');
    await shoot(page.locator('.sh-who'), `who-geometric-display-dark-${width}`);
  });
}
