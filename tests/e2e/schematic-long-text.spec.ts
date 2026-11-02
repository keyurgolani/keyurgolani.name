import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Schematic on the long-text contract fixture (long and unbroken text,
// non-Latin and duplicate titles): no width it's drawn at scrolls sideways,
// with every disclosure open, and a failure names the elements that stick out.

const FIXTURE = contractFixture('long-text');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'schematic'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const [width, height] of [
  [320, 640],
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const) {
  test(
    `no sideways scroll at ${width}, every disclosure open`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        for (const details of document.querySelectorAll('details')) details.open = true;
      });
      const wide = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth + 1;
        return [...document.querySelectorAll('body *')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            // The outermost offenders only: an element whose parent sticks out is its parent's.
            const parent = el.parentElement?.getBoundingClientRect();
            return r.right > limit && !(parent && parent.right > limit);
          })
          .slice(0, 8)
          .map(
            (el) =>
              `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right ${Math.round(el.getBoundingClientRect().right)} in ${el.closest('[data-section-id]')?.getAttribute('data-section-id') ?? '-'}`,
          );
      });
      expect(wide, 'elements wider than the window').toEqual([]);
    },
  );
}
