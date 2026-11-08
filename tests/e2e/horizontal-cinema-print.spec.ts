import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { frames, load, printedRail } from './horizontal-cinema-model';

// Horizontal Cinema on paper (RC1 6(a)), on the complete contract fixture at 1440 by 900: the rail prints as
// the five chapters in reading order, Strip and List print, and none of the scrubber's buttons does.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

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
  'on paper the rail prints its five chapters in reading order, Strip and List print, and no scrubber button does (complete)',
  { annotation },
  async ({ page }) => {
    await load(page);
    await page.emulateMedia({ media: 'print' });
    await frames(page);
    await frames(page);
    const printed = await printedRail(page);
    expect(printed.rail, 'the rail on paper').toEqual(
      printed.rail.map(({ href }) => ({ href, shown: true })),
    );
    expect(printed.rail.length, 'the rail on paper: five chapters').toBe(5);
    expect(
      printed.views.filter(({ shown }) => shown).map(({ href }) => href),
      'Strip and List on paper',
    ).toEqual(['/', '/list']);
    expect(printed.buttons, "the scrubber's buttons on paper").toBe(0);
  },
);
