import { expect, test } from '../harness/fixtures';
import { annotation, openTuple, servingSchematic, type Tuple } from './schematic-tuples';
import { inkOver } from './worst-pixel';

// Schematic's large figures, the cover's metric note (its value, set as a headline) and the
// chain dimension's and a certificate's values, are large text: each reads 3:1 against the worst
// pixel under its glyphs (WCAG 1.4.3, the quality cells' large-text contrast), under schemes
// whose data colours sit near the canvas: Poster Primaries and Sepia Film, light.

test.use({ appOptions: servingSchematic() });

const FIGURES = [
  ".sx-note__value[data-type-role='headline']",
  '.sx-chain__value',
  '.sx-cert__year',
].join(', ');

const CASES: readonly { tuple: Tuple; width: number; height: number }[] = [
  { tuple: 'platform-neutral/poster-primaries/humanist-ui/light', width: 1024, height: 768 },
  { tuple: 'platform-neutral/sepia-film/humanist-ui/light', width: 1440, height: 900 },
];

for (const { tuple, width, height } of CASES)
  test(
    `under ${tuple} at ${width}, every large figure reads 3:1 against its worst background pixel`,
    { annotation },
    async ({ page, app }) => {
      await page.setViewportSize({ width, height });
      await openTuple(page, app.origin, tuple);
      const figures = page.locator(FIGURES);
      const count = await figures.count();
      expect(count, 'the cover shows its metric').toBeGreaterThan(0);
      const read = [];
      for (let i = 0; i < count; i++) {
        const figure = figures.nth(i);
        if (!(await figure.isVisible())) continue;
        read.push(await inkOver(page, figure));
      }
      expect(read.length).toBeGreaterThan(0);
      const weak = read.filter(({ ratio }) => ratio === null || ratio < 3);
      expect(weak, JSON.stringify(read)).toEqual([]);
    },
  );
