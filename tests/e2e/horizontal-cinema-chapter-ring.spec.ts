import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { load, ringContrast } from './horizontal-cinema-model';

// Horizontal Cinema's chapter control at 390: on a phone the scenes run top to bottom under a bar
// that holds the Chapters button and sticks to the top edge. The button was as tall as the bar, so
// its ring, set out past its edges, ran past the bar's: under the top line's band while the page sat
// at its top, where under more contrast in light the ring and the band are both near black, and off
// the screen's top edge once the bar stuck. The quality cells read the button's focus perimeter there
// under 3:1. Focused from the keyboard, the button's ring lies inside its bar and the viewport, an
// outline at 3:1 on every side of its centre line, and passes the focus check, at the page's top and
// with the bar stuck, in light and dark, with and without more contrast.
// On the complete contract fixture at 390 by 844, the scheme and mode by the visitor's cookie.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 390, height: 844 },
});

const BUTTON = '.hc-shell > .hc-jump > button.hc-jump__button';

for (const mode of ['light', 'dark'] as const) {
  for (const contrast of ['no-preference', 'more'] as const) {
    for (const place of ['at the top', 'stuck'] as const) {
      const label = `${mode}${contrast === 'more' ? ' under more contrast' : ''}, ${place}`;
      test(
        `in ${label} at 390, the Chapters button focused from the keyboard rings inside its bar at 3:1 on every side and passes the focus check`,
        { annotation, tag },
        async ({ page, app }) => {
          await page.emulateMedia({ contrast });
          await page.context().addCookies([
            {
              name: 'portfolio_appearance',
              value: new URLSearchParams({ scheme: 'warm-parchment', mode }).toString(),
              url: app.origin,
            },
          ]);
          await load(page);
          // The mode asked is the one shown: the boundary carries it, and dark its own color-scheme.
          const boundary = page.locator('[data-display-mode]').first();
          await expect(boundary).toHaveAttribute('data-display-mode', mode);
          if (mode === 'dark')
            expect(await boundary.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
          const button = page.locator(BUTTON);
          await expect(button).toBeVisible();
          if (place === 'stuck') {
            await page.evaluate(() => window.scrollBy(0, 1200));
            await expect
              .poll(() =>
                button.evaluate((el) => el.closest('.hc-jump')!.getBoundingClientRect().top),
              )
              .toBe(0);
          }
          await page.keyboard.press('Shift');
          await button.focus();
          expect(await button.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
          const active = await inPage<Active>(page, { kind: 'active' });
          expect(active.rounding?.width ?? 0, 'its ring is an outline').toBeGreaterThan(0);
          const bar = await button.evaluate((el) => {
            const r = el.closest('.hc-jump')!.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          });
          const { box, reach } = active;
          const ring = {
            top: box.y - reach,
            bottom: box.y + box.height + reach,
            left: box.x - reach,
            right: box.x + box.width + reach,
          };
          const viewport = page.viewportSize()!;
          // The ring's outer edge inside the bar and the viewport, and every point of its centre
          // line, on every side, at 3:1.
          const measured = await ringContrast(page, button);
          const read = {
            insideBar:
              ring.top >= bar.top - 0.5 &&
              ring.bottom <= bar.bottom + 0.5 &&
              ring.left >= bar.left - 0.5 &&
              ring.right <= bar.right + 0.5,
            inView: ring.top >= -0.5 && ring.bottom <= viewport.height + 0.5,
            sides: (['top', 'right', 'bottom', 'left'] as const).map((side) => {
              const { points, strong } = measured.sides[side];
              return { side, inView: points > 0, atThreeToOne: strong === points };
            }),
          };
          expect(read, `its ring ${JSON.stringify({ ring, bar, measured })}`).toEqual({
            insideBar: true,
            inView: true,
            sides: read.sides.map(({ side }) => ({ side, inView: true, atThreeToOne: true })),
          });
          expect(
            await focusFindings(page, active),
            `the focus check, its ring ${JSON.stringify({ ring, bar, measured })}`,
          ).toEqual([]);
        },
      );
    }
  }
}
