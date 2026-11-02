import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Singular at volume (variants-10 brief §5.7, step 9; dossier X1): on the
// large fixture, a hundred works and a hundred photos, the page is never
// wider than the window, at a laptop or a phone. A failure names the
// innermost elements that stick out, so it points at the culprit and not
// its ancestors. The app's options are per worker, so each fixture has its
// own file (singular-width-long-text.spec.ts is the other).

const FIXTURE = contractFixture('large');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/** The innermost elements past the window's right edge, each with its width and right edge. */
function sticksOut() {
  const edge = document.documentElement.clientWidth + 1;
  const out = (el: Element) => el.getBoundingClientRect().right > edge;
  return [...document.querySelectorAll('body *')]
    .filter((el) => out(el) && ![...el.children].some(out))
    .slice(0, 8)
    .map((el) => {
      const box = el.getBoundingClientRect();
      const name = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`;
      return `${name} w${Math.round(box.width)} r${Math.round(box.right)}`;
    });
}

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`the large fixture never scrolls sideways at ${width}`, { annotation }, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.sg[data-sg-live]')).toHaveCount(1);
    const wide = await page.evaluate(sticksOut);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `wider than the window: ${wide.join('; ')}`,
    ).toBeLessThanOrEqual(width);
  });
}
