import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { crowdRail, load, railClashes, read, widenRailYears } from './horizontal-cinema-model';

// Horizontal Cinema right to left: the rtl contract fixture (Hebrew, dir=rtl). The fit check measures
// the rail under the stage in the bar's own inline direction, so a right-to-left rail that holds its
// labels pins the strip as a left-to-right one does, and one that can't still stacks it.

const FIXTURE = contractFixture('rtl');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

test(
  'right to left at 1440 by 900, the strip pins with its rail whole',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect
      .poll(async () => {
        const { layout, pinned, fit } = await read(page);
        return { layout, pinned, fit };
      })
      .toEqual({ layout: 'horizontal', pinned: true, fit: null });
    expect(await railClashes(page)).toEqual([]);
  },
);

test(
  "right to left, a rail that can't hold its labels still stacks the strip top to bottom",
  { annotation },
  async ({ page }) => {
    await crowdRail(page);
    await load(page);
    await expect
      .poll(async () => {
        const { layout, pinned, fit } = await read(page);
        return { layout, pinned, fit };
      })
      .toEqual({ layout: 'vertical', pinned: false, fit: 'over' });
  },
);

test(
  "right to left at 1440 by 900, a rail whose years don't fit shortens them and keeps the strip pinned, its labels clear",
  { annotation },
  async ({ page }) => {
    // This fixture's one dated chapter, Origins ("2015–now", 8 glyphs, 68.6 px), holds 1.5em
    // (235.4 px, so about 111 px an em) and its whole rail still clears the bar's end: its
    // chapters have 126 to 175 px to spare past their labels, and 60 px lie between the rail and
    // .hc-scrub__end. The full rail meets the end once the years grow about 186 to 235 px more,
    // from 3.2 to 3.6em; at 5em it runs at least 154 px into it, and with the years hidden the
    // labels are narrower than the plain rail's, which clears the end by 115 px.
    await widenRailYears(page, '5em');
    await load(page);
    await expect
      .poll(async () => {
        const { layout, pinned, fit } = await read(page);
        const rail = await page.locator('.hc-shell').getAttribute('data-rail');
        return { layout, pinned, fit, rail };
      })
      .toEqual({ layout: 'horizontal', pinned: true, fit: null, rail: 'short' });
    expect(await railClashes(page)).toEqual([]);
  },
);
