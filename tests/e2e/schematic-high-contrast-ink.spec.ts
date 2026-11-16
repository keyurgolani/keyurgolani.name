import { expect, test } from '../harness/fixtures';
import { annotation, openTuple, servingSchematic, type Tuple } from './schematic-tuples';
import { inkOver } from './worst-pixel';

// In the high-contrast display mode every text reads 7:1 against the worst pixel under its glyphs
// (the quality cells' high-contrast text check). Schematic letters its numbers and marks in the
// accent text: the drawing index's and the sheets' view numbers, the fold balloons' numbers, the
// revision delta and the approval stamp. Each holds 7:1 there, where the drafting grid runs
// under the lettering.

test.use({ appOptions: servingSchematic() });
// Every lettered number is shot three times: the page has over a hundred of them.
test.describe.configure({ timeout: 240_000 });

const LETTERING = [
  '.sx-stamp',
  '.sx-delta',
  '.sx-bubble > span',
  ".sx-sheet__views [data-type-role='numeric']",
  '.sx-index__no',
].join(', ');

const CASES: readonly { tuple: Tuple; width: number; height: number }[] = [
  {
    tuple: 'neobrutalist/poster-primaries/geometric-display/high-contrast',
    width: 1024,
    height: 768,
  },
  {
    tuple: 'platform-neutral/iridescent-pearl/humanist-ui/high-contrast',
    width: 1440,
    height: 900,
  },
];

for (const { tuple, width, height } of CASES)
  test(
    `under ${tuple} at ${width}, the accent lettering reads 7:1 against its worst background pixel`,
    { annotation },
    async ({ page, app }) => {
      await page.setViewportSize({ width, height });
      await openTuple(page, app.origin, tuple);
      const lettering = page.locator(LETTERING);
      const count = await lettering.count();
      const read = [];
      for (let i = 0; i < count; i++) {
        const each = lettering.nth(i);
        if (!(await each.isVisible())) continue;
        const ink = await inkOver(page, each);
        if (ink.ratio !== null) read.push(ink);
      }
      expect(read.length, 'the page letters numbers and marks in the accent').toBeGreaterThan(10);
      const weak = read.filter(({ ratio }) => ratio! < 7);
      expect(weak, `${weak.length} of ${read.length} under 7:1`).toEqual([]);
    },
  );
