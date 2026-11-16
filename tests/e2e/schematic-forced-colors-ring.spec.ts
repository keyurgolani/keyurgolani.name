import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { ringContrast } from './horizontal-cinema-model';
import { annotation, openTuple, servingSchematic, type Tuple } from './schematic-tuples';

// Under forced colours a focused link's ring is the system's, and the quality cells' focus check
// reads its centre line at 3:1 against what's beside it. Schematic draws its rules in the system's
// text colour there, so a ring laid on a rule doesn't show. The cover's Fig. 1 title link and a
// sign-off's author link, focused from the keyboard, pass the focus check at 390, 1024 and 1440
// under forced colours.

test.use({ appOptions: servingSchematic() });

const LINKS = {
  'the cover figure title': '.sx-fig[data-cover] .sx-fig__title > a',
  "the first sign-off's author": '.sx-signoff figcaption b > a',
} as const;

const CASES: readonly { tuple: Tuple; width: number; height: number }[] = [
  { tuple: 'fluent-2-inspired/neon-city/drafting-grotesk/dark', width: 390, height: 844 },
  { tuple: 'platform-neutral/warm-parchment/multilingual-system/system', width: 1024, height: 768 },
  { tuple: 'letterpress/blue-orange-color-safe/field-serif/dark', width: 1440, height: 900 },
];

for (const { tuple, width, height } of CASES)
  for (const [name, selector] of Object.entries(LINKS))
    test(
      `under ${tuple} at ${width} with forced colours, ${name} focused from the keyboard passes the focus check`,
      { annotation, tag: '@interaction' },
      async ({ page, app }) => {
        await page.emulateMedia({ forcedColors: 'active' });
        await page.setViewportSize({ width, height });
        await openTuple(page, app.origin, tuple);
        const link = page.locator(selector).first();
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
