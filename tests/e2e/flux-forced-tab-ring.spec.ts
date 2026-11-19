import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';
import { expect, test } from '../harness/fixtures';
import { focusFindings, type Finding } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';

// Under forced colours Flux marks the place being read with its tab's outline, since the drop
// goes. A tab next to it, focused, draws its ring in the gap between the two, at the language's
// focus offset and width, so the mark must leave that gap to the ring: on Letterpress (a 3px
// offset and a 2px ring, so a 5px gap) with Forest Moss's dark focus colour, the ring drawn over
// the mark changed too little for the focus check. Every tab in the bar, focused by the keyboard,
// passes the cells' own focus check, at the top of the page (the name marked) and with Work
// marked, at 1024 and 1440, by mouse.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'flux')
      .replace(/designLanguage: .*/, 'designLanguage: letterpress')
      .replace(/colorScheme: .*/, 'colorScheme: forest-moss')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: dark'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

/**
 * The focus check's findings on `tab`, focused by the keyboard: onto it, forward a stop and back
 * again, inside the bar, so :focus-visible holds and the page doesn't move.
 */
async function ringFindingsOf(page: Page, tab: Locator): Promise<Finding[]> {
  await tab.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  if (!(await tab.evaluate((el) => el === document.activeElement)))
    return [{ gate: 'focus', rule: 'visible', actual: 'the keyboard did not come back to it' }];
  return focusFindings(page, await inPage<Active>(page, { kind: 'active' }));
}

for (const [width, height] of [
  [1024, 768],
  [1440, 900],
] as const)
  for (const marked of ['top', 'work'] as const)
    test(
      `at ${width} under forced colours, with ${marked === 'top' ? 'the name' : 'Work'} marked, every tab in the bar rings whole when it's focused`,
      { annotation },
      async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({
          media: null,
          reducedMotion: 'no-preference',
          forcedColors: 'active',
          contrast: 'no-preference',
        });
        await pinFaces(page, await optionalFaces(page), 'designed');
        await page.goto('/', { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready.then(() => true));
        await expect(page.locator('.fx[data-fx-live]')).toHaveCount(1);
        if (marked === 'work')
          await page.evaluate(() => {
            const sheet = document.querySelector<HTMLElement>('.fx-sheet[data-sheet="work"]')!;
            window.scrollTo({
              top: sheet.getBoundingClientRect().top + scrollY,
              behavior: 'instant',
            });
          });
        const tabs = page.locator('.fx-tabs a[data-fx-tab]:visible');
        await expect(page.locator(`.fx-tabs a[data-fx-tab="${marked}"]`)).toHaveAttribute(
          'aria-current',
          'location',
        );
        const failing: string[] = [];
        for (const tab of await tabs.all()) {
          const name = (await tab.getAttribute('data-fx-tab')) ?? '?';
          for (const finding of await ringFindingsOf(page, tab))
            failing.push(`${name} ${finding.rule}: ${finding.actual ?? ''}`);
        }
        await expect(page.locator(`.fx-tabs a[data-fx-tab="${marked}"]`)).toHaveAttribute(
          'aria-current',
          'location',
        );
        console.log(
          `flux forced tab ring ${width} ${marked}: ${(await tabs.count()).toString()} tabs, ${failing.length.toString()} findings${failing.length ? `: ${failing.join('; ')}` : ''}`,
        );
        expect(failing, 'the focus check on each tab in the bar').toEqual([]);
      },
    );
