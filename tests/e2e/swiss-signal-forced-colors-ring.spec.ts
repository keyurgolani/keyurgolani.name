import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { ringContrast } from './horizontal-cinema-model';
import { annotation, openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

// Under forced colours a focused link's ring is the system's, and the quality cells' focus check
// reads its centre line at 3:1 against what's beside it. A work row's title link, focused from the
// keyboard, passes the focus check at 1440 under forced colours, where the rows' rules take the
// system's text colour.

test.use({ appOptions: servingSwissSignal() });

const LINK = '.ss-row .ss-row__title > a';

const CASES: readonly Tuple[] = [
  'carbon-inspired/drafting-blue/drafting-grotesk/dark',
  'platform-neutral/warm-parchment/drafting-grotesk/system',
  'platform-neutral/warm-parchment/shell-mono/system',
];

for (const tuple of CASES)
  test(
    `under ${tuple} at 1440 with forced colours, a work's title link focused from the keyboard passes the focus check`,
    { annotation, tag: '@interaction' },
    async ({ page, app }) => {
      await page.emulateMedia({ forcedColors: 'active' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openTuple(page, app.origin, tuple);
      const link = page.locator(LINK).first();
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
