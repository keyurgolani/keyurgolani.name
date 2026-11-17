import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { keyboardFindings, type Finding } from '../quality/lib/a11y/interaction';
import { annotation, openTuple, servingSchematic, type Tuple } from './schematic-tuples';

// A cover note that names the signature work ends on a link to its figure, "Linked to Fig. 1", set
// on the line under the note's title. The quality cells walk a page with Tab from its top and read
// each stop's focus ring centre line at 3:1 against what's beside it (keyboardFindings with its
// focus check, as the [37] sweep runs it). Under Paste-Up at 1440 that walk finds nothing on the
// link, with and without forced colours, which the sweep switches to on the page and loads again.

test.use({ appOptions: servingSchematic() });

const TUPLE: Tuple = 'platform-neutral/warm-parchment/paste-up/system';
const LINK = '.sx-note__ref > a';

/** The walk's findings on the note's link. */
async function onTheLink(page: Page, findings: readonly Finding[]): Promise<Finding[]> {
  const mine: Finding[] = [];
  for (const finding of findings) {
    if (!finding.path) continue;
    const there = await page
      .locator(finding.path)
      .first()
      .evaluate((el, link) => el.matches(link), LINK)
      .catch(() => false);
    if (there) mine.push(finding);
  }
  return mine;
}

for (const forced of [false, true])
  test(
    `under ${TUPLE} at 1440${forced ? ' with forced colours' : ''}, the keyboard walk's focus check finds nothing on a cover note's link to Fig. 1`,
    { annotation, tag: '@interaction' },
    async ({ page, app }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openTuple(page, app.origin, TUPLE);
      if (forced) {
        // As the sweep's forced row comes in (run-cell.ts's emulateRow): on the page, then a load.
        await page.emulateMedia({
          media: null,
          reducedMotion: 'no-preference',
          forcedColors: 'active',
          contrast: 'no-preference',
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
      }
      await expect(page.locator(LINK).first()).toBeVisible();
      const findings = await keyboardFindings(page, { focus: true });
      expect(await onTheLink(page, findings)).toEqual([]);
    },
  );
