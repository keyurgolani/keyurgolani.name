import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { ringContrast } from './horizontal-cinema-model';
import { annotation, openTuple, servingSchematic, type Tuple } from './schematic-tuples';

// A cover note that names the signature work ends on a link to its figure, "Linked to Fig. 1", set
// on the line under the note's title. The quality cells' focus check reads a focused link's ring
// centre line at 3:1 against what's beside it. Under Paste-Up at 1440, with and without forced
// colours, the link focused from the keyboard passes the focus check.

test.use({ appOptions: servingSchematic() });

const TUPLE: Tuple = 'platform-neutral/warm-parchment/paste-up/system';

for (const forced of [false, true])
  test(
    `under ${TUPLE} at 1440${forced ? ' with forced colours' : ''}, a cover note's link to Fig. 1 focused from the keyboard passes the focus check`,
    { annotation, tag: '@interaction' },
    async ({ page, app }) => {
      if (forced) await page.emulateMedia({ forcedColors: 'active' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openTuple(page, app.origin, TUPLE);
      const link = page.locator('.sx-note__ref > a').first();
      await expect(link).toBeVisible();
      await link.evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
      await page.keyboard.press('Shift');
      await link.focus();
      expect(await link.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
      const active = await inPage<Active>(page, { kind: 'active' });
      const measured = await ringContrast(page, link);
      const why = JSON.stringify({ box: active.box, reach: active.reach, sides: measured.sides });
      expect(await focusFindings(page, active), why).toEqual([]);
    },
  );
