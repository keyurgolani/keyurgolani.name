import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// The foot's title block where the page shows no visitor control (the P2 design
// review: the demo drew an empty band under LOCATION and SHEETS, and an empty
// right cell at 1440). On the complete fixture with every visitor control locked,
// so the host's control renders nothing: the control's row goes, and every row of
// the block still reaches its edge.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'schematic').replace(
      /: selectable$/gm,
      ': locked',
    ),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  'with no visitor control the foot’s title block draws no empty band, and its rows reach its edge, at 1440 and 390',
  { annotation },
  async ({ page }, testInfo) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      const block = page.locator('.sx-foot .sx-tb');
      await expect(block.locator('[data-visitor-control-slot]')).toBeEmpty();
      await expect(block.locator('.sx-tb__control')).toBeHidden();
      const short = await block.evaluate((tb) => {
        const edge =
          tb.getBoundingClientRect().right -
          Number.parseFloat(getComputedStyle(tb).borderRightWidth);
        const rows = new Map<number, number>();
        for (const cell of tb.querySelectorAll<HTMLElement>(':scope > .sx-tb__cell')) {
          const box = cell.getBoundingClientRect();
          if (box.width === 0) continue;
          const top = Math.round(box.top);
          rows.set(top, Math.max(rows.get(top) ?? 0, box.right));
        }
        return [...rows.values()].filter((right) => right < edge - 1).length;
      });
      expect(short, `${viewport.width}: rows short of the block's edge`).toBe(0);
      await block.scrollIntoViewIfNeeded();
      await block.screenshot({
        path: testInfo.outputPath(`foot-no-control-${viewport.width}.png`),
      });
    }
  },
);
