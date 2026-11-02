import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Schematic on paper with more drawings than home shows (re-check item 4):
// the large contract fixture, selecting Schematic, whose drawings section
// holds a hundred works, so "n more drawings" exists to print. Its own file,
// since appOptions is a worker fixture a describe group can't override.

const FIXTURE = contractFixture('large');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'schematic'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  'beforeprint opens every closed disclosure, the further drawings print, and afterprint closes them again',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const closed = () =>
      page.evaluate(() => document.querySelectorAll('.sx details:not([open])').length);
    // There are further drawings to print, behind "n more drawings", and other closed views.
    expect(await page.locator('.sx-more').count()).toBeGreaterThan(0);
    const before = await closed();
    expect(before).toBeGreaterThan(0);
    // emulateMedia never fires beforeprint, so the test fires it, as a print dialog does.
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    expect(await closed()).toBe(0);
    await page.emulateMedia({ media: 'print' });
    const figures = page.locator('.sx-more .sx-fig');
    expect(await figures.count()).toBeGreaterThan(0);
    await expect(figures.first()).toBeVisible();
    await expect(figures.last()).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    expect(await closed()).toBe(before);
  },
);
