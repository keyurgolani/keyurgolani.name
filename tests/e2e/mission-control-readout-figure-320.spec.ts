import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Mission Control on a phone at 320, the home page's square readouts: each figure and its unit
// stay inside their square, with the root text at its own size and at 200%, as a reader's own
// text size sets it. The readouts clip at the panel's edge, so a figure wider than its square is
// cut, not scrolled to. On the complete contract fixture, in the default design language, colour
// scheme and typography.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 320, height: 568 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const size of [null, '200%']) {
  test(
    `at 320 with the root text ${size ? `at ${size}` : 'at its own size'}, each readout's figure stays inside its square`,
    { annotation: [{ type: 'route', description: '/' }] },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      if (size)
        await page.evaluate(
          (to) => document.documentElement.style.setProperty('font-size', to, 'important'),
          size,
        );
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const squares = await page.evaluate(() =>
        [...document.querySelectorAll('.mc-readout')].map((square) => {
          const box = square.getBoundingClientRect();
          const parts = [...square.querySelectorAll('.mc-readout__figure > *')].map((part) => {
            const r = part.getBoundingClientRect();
            return {
              text: (part.textContent ?? '').trim(),
              left: Math.round(r.left * 10) / 10,
              right: Math.round(r.right * 10) / 10,
              fontSize: getComputedStyle(part).fontSize,
            };
          });
          return {
            left: Math.round(box.left * 10) / 10,
            right: Math.round(box.right * 10) / 10,
            parts,
          };
        }),
      );
      console.log(`readouts 320 ${size ?? '100%'}: ${JSON.stringify(squares)}`);
      expect(squares.length, 'the home page shows its readouts').toBeGreaterThan(0);
      const out = squares.flatMap((square) =>
        square.parts
          .filter((part) => part.left < square.left - 0.5 || part.right > square.right + 0.5)
          .map((part) => ({ ...part, square: [square.left, square.right] })),
      );
      expect(out, 'no figure or unit runs past its square').toEqual([]);
    },
  );
}
