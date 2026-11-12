import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';

// Row 107 (#211; rows-evidence 0390804f1, 2026-11-11): Terra Field's case page, its onward "All work"
// link, #tf--case-next > a, the h2.tf-display.tf-casenext__title's link. Focused, the walk reads
// about 63% of its ring's points (584 of 926 at 1440, 527 of 834 at 1024, 361 of 564 at 390) in
// light, dark and system, and in forced colors in all four modes; high contrast passes outside
// forced colors. The link is inline with its words' own underline (from-font, the ink at 0.4, 0.42
// in forced colors) and no padding, so the ring's foot runs over the underline and those points
// don't change when it's focused: row 8's class, the closing address's. Each mode, forced colors off
// and on, at 1440, 1024 and 390: the link rings whole, as the walk reads it.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const CASE = '/work/project-name';
const TARGET = '#tf--case-next > a:nth-child(1)';
const READ_ONLY = { type: 'profile', description: 'read-only' };
const tag = '@interaction';
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'terra-field'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  colorScheme: 'light',
});

/** The case under the release pack in `mode`, by the visitor's cookie, and what rendered. */
async function load(page: Page, origin: string, mode: string): Promise<void> {
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ scheme: 'warm-parchment', mode }).toString(),
      url: origin,
    },
  ]);
  await page.goto(CASE, { waitUntil: 'networkidle' });
  const boundary = page.locator('[data-variant]').first();
  await expect(boundary).toHaveAttribute('data-variant', 'terra-field');
  await expect(boundary).toHaveAttribute('data-design-language', 'platform-neutral');
  await expect(boundary).toHaveAttribute('data-color-scheme', 'warm-parchment');
  await expect(boundary).toHaveAttribute('data-typography', 'humanist-ui');
  await expect(boundary).toHaveAttribute('data-display-mode', mode);
  await page.evaluate(() => document.fonts.ready);
}

/** The link focused as from the keyboard, so it is :focus-visible, read as the walk reads it. */
async function keyboardFocus(page: Page): Promise<Active> {
  const target = page.locator(TARGET);
  await expect(target).toHaveCount(1);
  await target.scrollIntoViewIfNeeded();
  await page.keyboard.press('Shift');
  await target.focus();
  expect(await target.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  const active = await inPage<Active>(page, { kind: 'active' });
  expect(active.path).toBe(TARGET);
  return active;
}

for (const mode of ['light', 'dark', 'system', 'high-contrast'] as const) {
  for (const forcedColors of ['none', 'active'] as const) {
    test(
      `in ${mode}${forcedColors === 'active' ? ' under forced colors' : ''}, the case page's All work link rings whole when focused, at 1440, 1024 and 390 (row 107)`,
      { annotation: [{ type: 'route', description: '/work/[slug]' }, READ_ONLY], tag },
      async ({ page, app }) => {
        await page.emulateMedia({ forcedColors });
        for (const size of WIDTHS) {
          await page.setViewportSize(size);
          await load(page, app.origin, mode);
          // The heading's link, the onward way to All work.
          expect(
            await page.locator(TARGET).evaluate((el) => el.matches('h2.tf-casenext__title > a')),
          ).toBe(true);
          const active = await keyboardFocus(page);
          expect(await focusFindings(page, active), `at ${size.width}`).toEqual([]);
        }
      },
    );
  }
}
