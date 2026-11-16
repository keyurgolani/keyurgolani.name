import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';
// Shell's call to action on a phone in Letterpress, Book Serif (designed faces), Control Room dark: at rest and
// each button focused from the keyboard, by default and under more contrast.
// Each shot goes to PROOF_LOOK_OUT. One appOptions a file run.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const LANGUAGE = 'letterpress';
const TYPOGRAPHY = 'book-serif';
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

test.use({ viewport: { width: 390, height: 844 } });
for (const contrast of ['no-preference', 'more'] as const) {
  test(`Shell's call to action at 390, contrast ${contrast}`, async ({ page, app }) => {
    await page.emulateMedia({ contrast });
    await pinFaces(page, await optionalFaces(page), 'designed');
    await visit(page, app.origin, 'control-room', 'dark');
    const tag = contrast === 'more' ? '-more' : '';
    await page.locator('#cta').scrollIntoViewIfNeeded();
    await shootUnion(page, `cta-control-room-dark${tag}-390-rest`, '#cta .sh-btns', 1, 16);
    for (const [name, nth] of [
      ['primary', 1],
      ['secondary', 2],
    ] as const) {
      await page.keyboard.press('Shift');
      await page.locator(`#cta .sh-btns > li:nth-child(${nth}) > a`).focus();
      await shootUnion(page, `cta-control-room-dark${tag}-390-${name}`, '#cta .sh-btns', 1, 16);
    }
  });
}
