import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { ringContrast } from './horizontal-cinema-model';

// Obsidian Atelier's name in the chrome at 390, on the missing-media contract fixture: on a phone the
// chrome's corners are the name and Index, over the entrance, whose plaque, the owner's name in the
// large label type, stands in the wall's corner under the chrome's name. The name's ring ran over the
// plaque's first line: its foot lay on the line's glyphs, light ink that a light ring changes under
// 3:1, and the quality cells read its focus perimeter short under more contrast, dark and high
// contrast. Focused from the keyboard, the name's ring lies clear of the plaque's first line, an
// outline at 3:1 on every side of its centre line, and passes the focus check, in light, dark and high
// contrast under more contrast, on the quality cells' own packs (Warm Parchment, the fixture's default
// language and typography), the mode set in the site's config. Each mode is a site document and so a
// server of its own: obsidian-atelier-mark-ring-{light,dark,high-contrast}.spec.ts call this, one mode a file.

const FIXTURE = contractFixture('missing-media');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

const NAME = '.oa-chrome > a.oa-chrome__mark';
const LINE = '.oa-plaque .oa-plaque__line';

/** The chrome's name's ring at 390 under more contrast, in one display mode (each its own server). */
export function defineMarkRing(mode: 'light' | 'dark' | 'high-contrast') {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test.use({
    appOptions: {
      portfolio: FIXTURE.files.portfolio,
      siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'obsidian-atelier')
        .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
        .replace(/displayMode: .*/, `displayMode: ${mode}`),
      sourceFiles: Object.fromEntries(
        FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
      ),
    },
  });
  test(
    `in ${mode} under more contrast at 390, the chrome's name focused from the keyboard rings clear of the plaque at 3:1 on every side and passes the focus check`,
    { annotation, tag },
    async ({ page }) => {
      await page.emulateMedia({ contrast: 'more' });
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator('[data-variant]').first()).toHaveAttribute(
        'data-variant',
        'obsidian-atelier',
      );
      // The mode asked is the one shown: the boundary carries it, and dark its own color-scheme.
      const boundary = page.locator('[data-display-mode]').first();
      await expect(boundary).toHaveAttribute('data-display-mode', mode);
      if (mode === 'dark')
        expect(await boundary.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
      const name = page.locator(NAME);
      await expect(name).toHaveCount(1);
      await page.keyboard.press('Shift');
      await name.focus();
      expect(await name.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
      const active = await inPage<Active>(page, { kind: 'active' });
      expect(active.rounding?.width ?? 0, 'its ring is an outline').toBeGreaterThan(0);
      // Where the ring's foot is, and the plaque's first line's glyph box (the font's ascent and
      // descent round its text), with the chrome's own boxes, for the message.
      const geometry = await page.evaluate((selector) => {
        const r1 = (n: number) => Math.round(n * 10) / 10;
        const box = (r: DOMRect) => [r.left, r.top, r.right, r.bottom].map(r1);
        const line = document.querySelector(selector);
        const range = document.createRange();
        if (line) range.selectNodeContents(line);
        const glyphs = line ? [...range.getClientRects()].filter((r) => r.width > 0) : [];
        return {
          line: glyphs.map(box),
          chrome: [...document.querySelectorAll('.oa-chrome, .oa-chrome > *')].map(
            (e) => `${e.className} ${JSON.stringify(box(e.getBoundingClientRect()))}`,
          ),
        };
      }, LINE);
      const { box, reach } = active;
      const foot = box.y + box.height + reach;
      const first = geometry.line[0];
      const measured = await ringContrast(page, name);
      const read = {
        clearOfPlaque: first === undefined || foot <= first[1]! + 0.5,
        sides: (['top', 'right', 'bottom', 'left'] as const).map((side) => {
          const { points, strong } = measured.sides[side];
          return { side, inView: points > 0, atThreeToOne: strong === points };
        }),
      };
      const why = JSON.stringify({ box, reach, foot, geometry, measured });
      expect(read, `its ring ${why}`).toEqual({
        clearOfPlaque: true,
        sides: read.sides.map(({ side }) => ({ side, inView: true, atThreeToOne: true })),
      });
      expect(await focusFindings(page, active), `the focus check ${why}`).toEqual([]);
    },
  );
}
