import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Shell's figure colour: the whoami block (its proof figures) and the first folds (their counts), at 1440 and 390,
// in Aurora Meadow light, Pastel Sorbet light, Aurora Meadow dark and Aurora Meadow high contrast, and Aurora
// Meadow in print at 1440. Platform Neutral, Humanist UI.
// Each shot goes to PROOF_LOOK_OUT. One appOptions a file run.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const LANGUAGE = 'platform-neutral';
const TYPOGRAPHY = 'humanist-ui';
const MODE = 'light';

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

/** The union of `selector`'s first `n` boxes, padded, shot from the full page. */
async function shootUnion(page: Page, name: string, selector: string, n: number, pad = 8) {
  const box = await page.evaluate(
    ({ selector, n }) => {
      const boxes = [...document.querySelectorAll(selector)]
        .slice(0, n)
        .map((el) => el.getBoundingClientRect());
      if (boxes.length === 0) return null;
      return {
        left: Math.min(...boxes.map((b) => b.left)),
        top: Math.min(...boxes.map((b) => b.top)) + scrollY,
        right: Math.max(...boxes.map((b) => b.right)),
        bottom: Math.max(...boxes.map((b) => b.bottom)) + scrollY,
      };
    },
    { selector, n },
  );
  expect(box, `${selector} on the page`).not.toBeNull();
  mkdirSync(OUT, { recursive: true });
  const width = page.viewportSize()!.width;
  const x = Math.max(0, box!.left - pad);
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    fullPage: true,
    clip: {
      x,
      y: Math.max(0, box!.top - pad),
      width: Math.min(width, box!.right + pad) - x,
      height: box!.bottom - box!.top + 2 * pad,
    },
    animations: 'disabled',
    caret: 'hide',
  });
}

const SETS = [
  ['aurora-meadow', 'light'],
  ['pastel-sorbet', 'light'],
  ['aurora-meadow', 'dark'],
  ['aurora-meadow', 'high-contrast'],
] as const;
for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  for (const [scheme, mode] of SETS) {
    test(`Shell's figures in ${scheme} ${mode} at ${width}`, async ({ page, app }) => {
      await page.setViewportSize({ width, height });
      await visit(page, app.origin, scheme, mode);
      await shoot(page.locator('.sh-who'), `fig-${scheme}-${mode}-${width}-who`);
      await shootUnion(page, `fig-${scheme}-${mode}-${width}-folds`, '.sh-foldblock', 6);
    });
  }
}
test("Shell's figures in aurora-meadow in print at 1440", async ({ page, app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page, app.origin, 'aurora-meadow', 'light');
  await page.emulateMedia({ media: 'print' });
  await settle(page);
  await shoot(page.locator('.sh-who'), 'fig-aurora-meadow-print-1440-who');
});
