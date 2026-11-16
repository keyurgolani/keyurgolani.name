import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Editorial Evidence on retro-web, sunset-ember, technical-sans-mono and dark, at 390: the plate
// links Pl. 1 and Pl. 2 measured 30.7 by 17 px, under the 24 by 24 px target that axe's target-size
// rule asks of a link that isn't inline in a sentence. Each plate link's box is at least 24 by 24 px
// in the default, contrast-more and forced-colors rows, and axe's target-size passes the rows' end
// slots. The test prints each one's box and padding.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const ROWS = {
  default: { forcedColors: 'none', contrast: 'no-preference' },
  'contrast-more': { forcedColors: 'none', contrast: 'more' },
  'forced-colors': { forcedColors: 'active', contrast: 'no-preference' },
} as const;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: retro-web')
      .replace(/colorScheme: .*/, 'colorScheme: sunset-ember')
      .replace(/typography: .*/, 'typography: technical-sans-mono')
      .replace(/displayMode: .*/, 'displayMode: dark'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 390, height: 844 },
});

for (const [row, media] of Object.entries(ROWS))
  test(
    `on retro-web at 390${row === 'default' ? '' : `, ${row}`}, the plate links Pl. 1 and Pl. 2 are at least 24 by 24 px`,
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark', ...media });
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator('[data-variant]').first()).toHaveAttribute(
        'data-variant',
        'editorial-evidence',
      );
      await page.evaluate(() => document.fonts.ready);
      const boxes: Record<string, string> = {};
      const sizes: Record<string, boolean> = {};
      for (const name of ['Pl. 1', 'Pl. 2']) {
        const link = page.getByRole('link', { name, exact: true });
        await expect(link).toHaveCount(1);
        const read = await link.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const own = getComputedStyle(element);
          return {
            width: box.width,
            height: box.height,
            line: `${element.className} ${own.display} padding ${own.padding} font ${own.fontSize}/${own.lineHeight}`,
          };
        });
        boxes[name] = `${read.width.toFixed(1)}x${read.height.toFixed(1)} ${read.line}`;
        sizes[name] = read.width >= 24 && read.height >= 24;
      }
      console.log(`ee plate target ${row}: ${JSON.stringify(boxes)}`);
      expect(sizes, 'each plate link at least 24 by 24 px').toEqual({
        'Pl. 1': true,
        'Pl. 2': true,
      });
      const results = await new AxeBuilder({ page })
        .withRules(['target-size'])
        .include('.ee-row__end')
        .analyze();
      expect(
        results.violations.flatMap((rule) =>
          rule.nodes.map((node) => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`),
        ),
        "axe's target-size on the rows' end slots",
      ).toEqual([]);
    },
  );
