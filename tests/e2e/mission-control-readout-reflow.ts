import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Mission Control's square readouts on the Overview, under 200% root text at 1024 (WCAG 1.4.4 and
// 1.4.10). Each square holds a metric's label over its figure and unit. The figure and its unit were
// set on one unbreakable line, and the square's link is a grid whose one column took that line's
// width, so in a wide face the first square's label and unit ran to 1042 px in the 1024 px window
// and the page scrolled sideways. Here the page is no wider than the window, and every square's
// label, figure and unit end inside the square. The root text is set as the quality runner's
// root-text condition sets it, once the fonts are in. A spec file a type pack: each is a server of
// its own. On the complete contract fixture.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [{ type: 'route', description: '/' }];

export function readoutReflow(tuple: {
  readonly language: string;
  readonly scheme: string;
  readonly typography: string;
  readonly mode: string;
}) {
  test.use({
    viewport: { width: 1024, height: 768 },
    appOptions: {
      portfolio: FIXTURE.files.portfolio,
      siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control')
        .replace(/designLanguage: .*/, `designLanguage: ${tuple.language}`)
        .replace(/colorScheme: .*/, `colorScheme: ${tuple.scheme}`)
        .replace(/typography: .*/, `typography: ${tuple.typography}`)
        .replace(/displayMode: .*/, `displayMode: ${tuple.mode}`),
      sourceFiles: Object.fromEntries(
        FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
      ),
    },
  });

  for (const scale of [1, 2]) {
    test(
      `in ${tuple.typography} at 1024 with ${scale * 100}% root text, the page is no wider than the window and each readout square holds its label, figure and unit`,
      { annotation },
      async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        await expect(page.locator('[data-variant]').first()).toHaveAttribute(
          'data-variant',
          'mission-control',
        );
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await page.evaluate(
          (scale) =>
            document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
          scale,
        );
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        const read = await page.evaluate(() => {
          const round = (v: number) => Math.round(v * 10) / 10;
          const squares = [...document.querySelectorAll('.mc-readout')].map((square) => {
            const box = square.getBoundingClientRect();
            const parts = [
              ...square.querySelectorAll(
                '.mc-readout__label, .mc-readout__figure, .mc-readout__unit',
              ),
            ].map((part) => {
              const r = part.getBoundingClientRect();
              return {
                part: part.className,
                text: (part.textContent ?? '').trim().slice(0, 40),
                left: round(r.left),
                right: round(r.right),
                inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5,
              };
            });
            return { square: [round(box.left), round(box.right)], parts };
          });
          return {
            width: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            squares,
          };
        });
        expect(read.squares.length, 'the Overview has readout squares').toBeGreaterThan(0);
        const why = JSON.stringify(read);
        expect(
          read.scrollWidth,
          `the page's width against the window's ${why}`,
        ).toBeLessThanOrEqual(read.width);
        expect(
          read.squares.flatMap(({ parts }) => parts.filter(({ inside }) => !inside)),
          `parts that end outside their square ${why}`,
        ).toEqual([]);
      },
    );
  }
}
