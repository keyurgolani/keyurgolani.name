import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { ringContrast } from './horizontal-cinema-model';

// Shell's closing call to action, the whiptail buttons < Ok > under the section's description. On a
// phone in Letterpress, whose ring stands 3 px off the button and is 2 px wide, the two buttons
// wrap onto two lines a 3xs step apart, under the ring's 5 px reach, so the secondary button's ring
// fell on the primary's edge: on CI Linux its top read under 3:1 (274 of 438 centre line points) on
// Control Room in Book Serif, dark, with and without more contrast and under forced colours.
// Focused from the keyboard, each button's ring stands clear of the other button (half a pixel or more),
// and passes the focus check.
// Book Serif's faces load optional: they're pinned to the designed faces, as a visit with them
// cached draws them, as the quality cells do. On the complete contract fixture.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const BUTTONS = {
  primary: '#cta .sh-btns > li:nth-child(1) > a',
  secondary: '#cta .sh-btns > li:nth-child(2) > a',
} as const;
const annotation = [{ type: 'route', description: '/' }];
const tag = '@interaction';

test.use({
  viewport: { width: 390, height: 844 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'shell')
      .replace(/designLanguage: .*/, 'designLanguage: letterpress')
      .replace(/colorScheme: .*/, 'colorScheme: control-room')
      .replace(/typography: .*/, 'typography: book-serif')
      .replace(/displayMode: .*/, 'displayMode: dark'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const ROWS = [
  { label: 'dark', contrast: 'no-preference', forcedColors: 'none' },
  { label: 'dark under more contrast', contrast: 'more', forcedColors: 'none' },
  { label: 'dark under forced colours', contrast: 'no-preference', forcedColors: 'active' },
] as const;

for (const row of ROWS) {
  test(
    `in ${row.label} at 390, the call to action's buttons focused from the keyboard ring clear of each other and pass the focus check`,
    { annotation, tag },
    async ({ page }) => {
      await page.emulateMedia({ contrast: row.contrast, forcedColors: row.forcedColors });
      const faces = await optionalFaces(page);
      await pinFaces(page, faces, 'designed');
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator('[data-variant]').first()).toHaveAttribute('data-variant', 'shell');
      const verdicts: Record<string, unknown> = {};
      for (const [name, selector] of Object.entries(BUTTONS)) {
        const button = page.locator(selector);
        await expect(button, name).toHaveCount(1);
        await page.keyboard.press('Shift');
        await button.focus();
        expect(await button.evaluate((el) => el.matches(':focus-visible')), name).toBe(true);
        const active = await inPage<Active>(page, { kind: 'active' });
        const measured = await ringContrast(page, button);
        const findings = await focusFindings(page, active);
        // Where it stands and what's beside it, so a failure names its cause.
        const around = await page.evaluate((selector) => {
          const box = (el: Element | null) => {
            const r = el?.getBoundingClientRect();
            return r
              ? [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10)
              : null;
          };
          const bar = [...document.querySelectorAll('body *')].find(
            (el) =>
              getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().height > 0,
          );
          return {
            button: box(document.querySelector(selector)),
            buttons: [...document.querySelectorAll('#cta .sh-btns > li > a')].map(box),
            fixed: bar ? `${bar.localName}.${[...bar.classList].join('.')} ${box(bar)}` : null,
            viewport: [innerWidth, innerHeight],
          };
        }, selector);
        // The ring's outer box against every other button's box: the gap between them, the
        // larger of the two axes' (negative where they overlap).
        const reach = active.reach;
        const [l, t, r, b] = around.button!;
        const clear = Math.min(
          ...around.buttons
            .filter((other): other is number[] => !!other && other.join() !== around.button!.join())
            .map(([ol, ot, or, ob]) =>
              Math.max(ol! - (r! + reach), l! - reach - or!, ot! - (b! + reach), t! - reach - ob!),
            ),
        );
        verdicts[name] = { sides: measured.sides, around, reach, clear, findings };
        console.log(`[cta ring] ${row.label} ${name}: ${JSON.stringify(verdicts[name])}`);
      }
      expect(
        Object.fromEntries(
          Object.entries(verdicts).map(([name, v]) => {
            const { findings, clear } = v as { findings: unknown[]; clear: number };
            return [name, { findings, ringClearOfTheOtherButton: clear >= 0.5 }];
          }),
        ),
        JSON.stringify(verdicts),
      ).toEqual({
        primary: { findings: [], ringClearOfTheOtherButton: true },
        secondary: { findings: [], ringClearOfTheOtherButton: true },
      });
    },
  );
}
