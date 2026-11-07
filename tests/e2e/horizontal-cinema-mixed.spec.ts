import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { load, railClashes, read } from './horizontal-cinema-model';

// Horizontal Cinema right to left: the mixed contract fixture (Arabic, dir=rtl). The fit check measures
// the rail under the stage in the bar's own inline direction, so a right-to-left rail that holds its
// labels pins the strip as a left-to-right one does. A crowded right-to-left rail is the rtl spec's.

const FIXTURE = contractFixture('mixed');
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
