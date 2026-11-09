import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Row 115, Swiss Signal: on a phone the contact email's accent band (a 3 px background at the foot of the
// link's padding box) rose into its letters, the padding under them being 0.04em, under a pixel at the
// phone's size, so the quality cells read the letters against the band (2.07:1 at contrast-more; in dark
// and high contrast in every mode). The band sits under the letters, clear of their content box by 2 px.
// High contrast, as row 115's cells: on its own, and under more contrast. One language a file: each is a
// server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'swiss-signal')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: high-contrast'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const contrast of ['no-preference', 'more'] as const)
  test(
    `at 390 in high contrast (${contrast === 'more' ? 'with more contrast' : 'on its own'}), the email's band sits clear under its letters`,
    { annotation: [{ type: 'route', description: '/' }] },
    async ({ page }) => {
      await page.emulateMedia({ contrast });
      await page.goto('/', { waitUntil: 'networkidle' });
      const link = page.locator('.ss-email > a').first();
      await link.scrollIntoViewIfNeeded();
      const read = await link.evaluate((el) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const pad = parseFloat(style.paddingBottom) || 0;
        const border = parseFloat(style.borderBottomWidth) || 0;
        // The band: the background's height at the foot of the padding box (background-size's second value).
        const band = parseFloat(style.backgroundSize.split(' ')[1] ?? '0') || 0;
        const content = box.bottom - border - pad;
        return { band, bandTop: box.bottom - border - band, content, pad, size: style.fontSize };
      });
      expect(read.band, 'the band has a height').toBeGreaterThan(0);
      expect(
        read.bandTop,
        `the band's top (${read.bandTop}) is 2 px or more under the letters' box (${read.content}); padding ${read.pad}, font ${read.size}`,
      ).toBeGreaterThanOrEqual(read.content + 2);
    },
  );
