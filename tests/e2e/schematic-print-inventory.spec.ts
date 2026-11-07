import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { inventoryFindings } from '../quality/lib/a11y/conditions';
import { inPage } from '../quality/lib/a11y/probe';

// Schematic on paper keeps every field the screen shows but its controls (row 24):
// the quality cells' own inventory read, screen against print, on the complete
// contract fixture, home and a work's page, at 1440, 1024 and 390. The phone bar's
// Index link, "Sheet: Cover sheet" on home, and the running marker's, "Index" on a
// work's page, are links to the drawing index, not skip links, so print can't drop
// them; on paper they print in place, unstuck: nothing in Schematic is fixed or
// sticky in print. The inventory's own read names them; a second read, after the
// media flips back and forth, would race the sheet marker's observer, which can
// put the bar's line back to its sheet number for a moment.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const SITE = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'schematic');
const SOURCE_FILES = Object.fromEntries(
  FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
);
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({
  appOptions: { portfolio: FIXTURE.files.portfolio, siteText: SITE, sourceFiles: SOURCE_FILES },
});

const ROUTES = ['/', '/work/project-name'] as const;
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

for (const route of ROUTES) {
  for (const viewport of VIEWPORTS) {
    test(
      `${route} at ${viewport.width}x${viewport.height}: print keeps every field but the controls, and the bar and the markers print unstuck`,
      {
        annotation: [
          { type: 'route', description: route === '/' ? '/' : '/work/[slug]' },
          READ_ONLY,
        ],
      },
      async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(route, { waitUntil: 'networkidle' });
        await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'schematic');
        const baseline = await inPage<string[]>(page, { kind: 'inventory' });
        expect(baseline.length).toBeGreaterThan(0);
        const findings = await inventoryFindings(page, route, baseline, ['print']);
        expect(findings.map((each) => `${each.rule}: ${each.actual}`)).toEqual([]);
        await page.emulateMedia({ media: 'print' });
        // As tests/variants/modes.ts's expectNothingFixed reads it: a rendered element only.
        const stuck = await page.evaluate(() =>
          [...document.querySelectorAll('body *')]
            .filter((el) => el.getClientRects().length > 0)
            .filter((el) => /^(?:fixed|sticky)$/.test(getComputedStyle(el).position))
            .map((el) => `${el.localName}.${[...el.classList].join('.')}`),
        );
        expect(stuck).toEqual([]);
      },
    );
  }
}
