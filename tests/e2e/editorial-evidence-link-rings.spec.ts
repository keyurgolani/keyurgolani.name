import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';

// Rows 97 and 98's reach, Editorial Evidence (lead A): the pin of bd4b31e47's own regression. Its 24 px targets made
// each back matter link an inline block 24 px tall, and the Links list's two, flush, block on block, put each
// focused ring over its neighbour's box: the focus check's perimeter failed the second in every one of EE targets'
// 36 cells and the first in 8, about 60 % of the ring's points left (EE targets T1). At 390, 1024 and 1440, each
// link of the case's back matter, focused by the keyboard, has a ring the focus check passes on its perimeter, as at
// 2aa929c81, and the targets stay 24 px on their own (editorial-evidence-link-targets.spec.ts).

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [{ type: 'route', description: '/work/project-name' }];

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
  [390, 844],
  [1024, 768],
  [1440, 900],
] as const)
  test(
    `at ${width}, each back matter link focused by the keyboard has a ring the focus check passes on its perimeter`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/work/project-name', { waitUntil: 'networkidle' });
      const links = page.locator('.ee-case__matter li > a');
      const count = await links.count();
      expect(count, 'the back matter has links').toBeGreaterThanOrEqual(2);
      const failing: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const link = links.nth(i);
        // The keyboard's focus: onto the link, back a stop and forward again, so :focus-visible holds.
        await link.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(link).toBeFocused();
        const active = await inPage<Active>(page, { kind: 'active' });
        const text = ((await link.textContent()) ?? '').trim();
        for (const finding of await focusFindings(page, active))
          if (finding.rule === 'perimeter') failing.push(`"${text}": ${finding.actual ?? ''}`);
      }
      expect(failing, `at ${width}, the rings the perimeter fails`).toEqual([]);
    },
  );
