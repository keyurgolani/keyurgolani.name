import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import {
  annotation,
  openTuple,
  servingObsidianAtelier,
  type Tuple,
} from './obsidian-atelier-tuples';

// Obsidian Atelier's top row on a phone: the name in one corner, the Appearance control and Index in
// the other. Below a 22rem window the row folds, Index over Appearance; above it the three keep one
// line, however wide their faces set them. Under Accessible Reading at 390 the corner ran 7 px over
// the name: in either mode the control's words lay over its last letters, and under more contrast
// the control's plate covered them and the right side of the name's focus ring (the quality cells'
// perimeter, 232 of 302 points at 3:1). Faces set wider than the default ran over it too, from the
// fold to 360. At every phone width from 320 to 430, and at 1440, under more contrast and with no
// preference, the name focused from the keyboard has its ring clear of the corner's controls and
// each of its letters on top; at 390 under more contrast it passes the focus check.

test.use({ appOptions: servingObsidianAtelier() });

const WIDTHS = [320, 353, 360, 375, 390, 400, 414, 430, 1440];

const CASES: readonly { tuple: Tuple; widths: readonly number[] }[] = [
  { tuple: 'platform-neutral/warm-parchment/accessible-reading/system', widths: WIDTHS },
  { tuple: 'platform-neutral/warm-parchment/accessible-reading/dark', widths: WIDTHS },
  { tuple: 'platform-neutral/warm-parchment/book-serif/system', widths: [353, 360] },
  { tuple: 'platform-neutral/warm-parchment/console-mono/system', widths: [353, 360] },
  { tuple: 'platform-neutral/warm-parchment/humanist-ui/system', widths: [353, 360, 390] },
];

/** The name focused from the keyboard: its ring against the corner's controls, and what covers its letters. */
async function readName(page: Page) {
  const name = page.locator('.oa-chrome > a.oa-chrome__mark');
  await page.keyboard.press('Shift');
  await name.focus();
  const active = await inPage<Active>(page, { kind: 'active' });
  const { box, reach } = active;
  const ring = {
    left: box.x - reach,
    top: box.y - reach,
    right: box.x + box.width + reach,
    bottom: box.y + box.height + reach,
  };
  const read = await page.evaluate((ring) => {
    const mark = document.querySelector<HTMLElement>('.oa-chrome > a.oa-chrome__mark')!;
    const controls = [
      ...document.querySelectorAll<HTMLElement>('.oa-chrome__appearance, .oa-chrome__dock'),
    ]
      .map((each) => ({ at: each.className, r: each.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0);
    const under = controls
      .filter(
        ({ r }) =>
          r.left < ring.right - 0.5 &&
          r.right > ring.left + 0.5 &&
          r.top < ring.bottom - 0.5 &&
          r.bottom > ring.top + 0.5,
      )
      .map(({ at, r }) => `${at} ${Math.round(r.left)}-${Math.round(r.right)}`);
    // Each letter's middle hits the name itself, not what stands over it.
    const range = document.createRange();
    const text = mark.firstChild!;
    const covered: string[] = [];
    for (let i = 0; i < (text.textContent ?? '').length; i++) {
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width === 0) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !mark.contains(hit)) covered.push(text.textContent![i]!);
    }
    return { under, covered };
  }, ring);
  return { active, ring, ...read };
}

for (const { tuple, widths } of CASES) {
  const [, , type, mode] = tuple.split('/');
  for (const contrast of ['more', 'no-preference'] as const)
    test(
      `under ${type} in ${mode} with ${contrast === 'more' ? 'more contrast' : 'no contrast preference'}, the name's ring and letters stay clear of the corner at ${widths.join(', ')}`,
      { annotation, tag: '@interaction' },
      async ({ page, app }) => {
        await page.emulateMedia({ contrast });
        for (const width of widths) {
          await page.setViewportSize({ width, height: 844 });
          await openTuple(page, app.origin, tuple);
          const read = await readName(page);
          expect(
            { under: read.under, covered: read.covered },
            `at ${width}: ring ${JSON.stringify(read.ring)}`,
          ).toEqual({ under: [], covered: [] });
          if (
            width === 390 &&
            contrast === 'more' &&
            mode === 'system' &&
            type === 'accessible-reading'
          )
            expect(await focusFindings(page, read.active), 'the focus check at 390').toEqual([]);
        }
      },
    );
}
