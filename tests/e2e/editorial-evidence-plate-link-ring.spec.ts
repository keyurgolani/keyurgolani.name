import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { keyboardFocus } from './focus-perimeter';

// A works row's plate link, Pl. 2, on a touch phone at 390 with more contrast and in forced colours,
// on the tuple whose release cells read it. On a phone a row's end goes under its title, and the
// title is a link: its underline is a rule in those modes, as dark as the ring. Focused, Pl. 2's ring
// keeps its top side clear of the title's text and underline, and the focus check passes it.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  isMobile: true,
  hasTouch: true,
  viewport: { width: 390, height: 844 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: accessible-reading')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const ROWS = {
  'more contrast': { forcedColors: 'none', contrast: 'more' },
  'forced colours': { forcedColors: 'active', contrast: 'no-preference' },
} as const;

for (const [row, media] of Object.entries(ROWS)) {
  test(`at 390 on a touch phone with ${row}, the focused Pl. 2 rings clear of the title above it`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light', ...media });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const link = page.locator('#writing-title .ee-row__end > a');
    await expect(link).toHaveText('Pl. 2');
    const active = await keyboardFocus(page, link);
    const room = await link.evaluate((a) => {
      const s = getComputedStyle(a);
      const reach = parseFloat(s.outlineOffset) + parseFloat(s.outlineWidth);
      const title = a.closest('.ee-row')!.querySelector('.ee-row__title a')!;
      const text = [...title.getClientRects()].at(-1)!;
      return {
        reach,
        ringTop: Math.round((a.getBoundingClientRect().top - reach) * 100) / 100,
        titleBottom: Math.round(text.bottom * 100) / 100,
      };
    });
    const findings = await focusFindings(page, active);
    console.log(`Pl. 2 at 390, ${row}: ${JSON.stringify({ room, findings })}`);
    expect(
      room.ringTop,
      `the ring's top side clears the title's text: ${JSON.stringify(room)}`,
    ).toBeGreaterThanOrEqual(room.titleBottom - 0.01);
    expect(findings, 'the focus check').toEqual([]);
  });
}
