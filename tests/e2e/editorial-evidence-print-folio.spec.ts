import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { inPage } from '../quality/lib/a11y/probe';

// The quality cells editorial-evidence sparse and missing-media / x platform-neutral at 1024 and 1440 print
// (and 1440 default's print condition) recorded "1 field(s) missing, here text: 1 Work" with no target
// (rc-preflight on 04dc5e378). The field is the masthead's running head: on screen at the top it names the
// first chapter, "1 Work"; print's reflow brings the first band onto the reading line, and the scroll spy
// wrote that band's title into the head, so the screen's words were gone from the printed page. On paper
// the running head keeps what the screen showed, and back on screen it follows the reading again. EE's
// head reads no pointer media (its one hover/pointer query colours rows), so no coarse-pointer run. One
// fixture a file: each is a server of its own.

const FIXTURE = contractFixture('sparse');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
] as const)
  test(
    `at ${width}, the running head the screen shows is on the printed page too`,
    { annotation: [{ type: 'route', description: '/' }] },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      const folio = page.locator('[data-ee-folio]');
      await expect(folio).toHaveText(/^\s*1\s+Work\s*$/);
      const screen = await inPage<string[]>(page, { kind: 'inventory' });
      expect(screen).toContain('text: 1 Work');
      await page.emulateMedia({ media: 'print' });
      // Long enough for the spy's observer to have run on the printed layout.
      await page.waitForTimeout(500);
      const printed = await inPage<string[]>(page, { kind: 'inventory' });
      expect(printed).toContain('text: 1 Work');
      await expect(folio).toHaveText(/^\s*1\s+Work\s*$/);
      // Back on screen the spy reads the page again: scrolled to the second band, the head names it.
      await page.emulateMedia({ media: 'screen' });
      const band = page.locator('.ee-band[data-section-id]').nth(1);
      const title = (await band.locator('.ee-head-title').first().textContent())?.trim() ?? '';
      expect(title).not.toBe('');
      await band.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await expect(folio.locator('[data-ee-folio-section]')).toHaveText(title);
    },
  );
