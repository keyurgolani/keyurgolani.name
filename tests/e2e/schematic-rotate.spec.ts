import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Schematic's phone folds after a phone turns (the P2 code review's blocker): a
// fresh visit at 390 closes the lede's continuation and Fig. 1's depth, and past
// a phone those folds show no control while open. Turned to a wide window, the
// reader gets every closed fold back. On the complete fixture with a lede of
// three paragraphs, in a copy of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const SECOND = 'Lede second paragraph.';
const COPY = path.join(mkdtempSync(path.join(tmpdir(), 'sx-rotate-')), 'portfolio.yml');
writeFileSync(
  COPY,
  readFileSync(FIXTURE.files.portfolio, 'utf8').replace(
    '    body: Lede body.\n',
    `    body: |-\n      Lede body.\n\n      ${SECOND}\n\n      Lede third paragraph.\n`,
  ),
);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  viewport: { width: 390, height: 844 },
  appOptions: {
    portfolio: COPY,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'schematic'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  'a phone turned past 48rem gets back the lede’s paragraphs and Fig. 1’s depth the visit closed',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const lede = page.locator('details[data-sx-fold="lede"]');
    const depth = page.locator('.sx-cover__fig details[data-sx-fold="depth"]');
    // At 390 the visit closed both: the folds sit below the window's top.
    await expect(lede).not.toHaveAttribute('open', '');
    await expect(depth).not.toHaveAttribute('open', '');
    await expect(page.getByText(SECOND)).toBeHidden();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByText(SECOND)).toBeVisible();
    await expect(depth.locator('.sx-depth__box')).toBeVisible();
    // Open past a phone, neither shows a control.
    await expect(lede.locator('summary')).toBeHidden();
    await expect(depth.locator('summary')).toBeHidden();
  },
);

test(
  'printed at A4, every fold prints open and no fold’s control prints (P2 review)',
  { annotation },
  async ({ page }) => {
    // A4's printable width at 96 dpi, under 48rem: the phone folds apply on paper.
    await page.setViewportSize({ width: 718, height: 1040 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect(page.getByText(SECOND)).toBeVisible();
    await expect(page.locator('.sx-cover__fig .sx-depth__box')).toBeVisible();
    for (const control of await page.locator('.sx-run-on__sum, .sx-depth__sum').all()) {
      await expect(control).toBeHidden();
    }
    const chevrons = await page
      .locator('.sx-abstract > summary')
      .evaluateAll(
        (all) => all.filter((el) => getComputedStyle(el, '::after').content !== 'none').length,
      );
    expect(chevrons).toBe(0);
  },
);
