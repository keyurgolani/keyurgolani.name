import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { inPage } from '../quality/lib/a11y/probe';
import {
  annotation,
  openTuple,
  rootText,
  servingObsidianAtelier,
  type Tuple,
} from './obsidian-atelier-tuples';

// Obsidian Atelier's catalogue checklists, a table of number, title, where and when on each
// vitrine's mat, with the reader's root text at 200%. On a phone a checklist reads as a stack, but
// only by the window's width, which a reader's text size never moves, so at 1024 it stayed four
// columns: under Accessible Reading the stats checklist ran to 1027 px, past its mat and the window
// (the reflow check's root-text finding), and every checklist in a room ran hundreds of px past its
// own mat. With the root text at 200% at 768, 1024 and 1440 every checklist stays inside its mat,
// and at 1024 the page reflows clean (the reflow check's own read), under Accessible Reading and
// Humanist UI. At 100% nothing moves: a table from 768 up, and a stack at 767.

test.use({ appOptions: servingObsidianAtelier() });

const TUPLES: readonly Tuple[] = [
  'platform-neutral/warm-parchment/accessible-reading/system',
  'platform-neutral/warm-parchment/humanist-ui/system',
];

/** Every shown checklist: how far it runs past its mat's content box, and whether it reads as a stack. */
const checklists = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.oa-vitrine-mat')]
      .filter((mat) => mat.offsetParent !== null && mat.querySelector('table.oa-checktable'))
      .map((mat) => {
        const css = getComputedStyle(mat);
        const table = mat.querySelector('table.oa-checktable')!;
        const head = table.querySelector('thead');
        return {
          in: mat.closest('[id]')?.id ?? '',
          past: Math.round(
            table.getBoundingClientRect().right -
              (mat.getBoundingClientRect().right - Number.parseFloat(css.paddingRight)),
          ),
          stack: head !== null && getComputedStyle(head).position === 'absolute',
        };
      }),
  );

for (const tuple of TUPLES) {
  const type = tuple.split('/')[2];
  test(
    `under ${type}, with the root text at 200% at 768, 1024 and 1440, every checklist reads inside its mat, and at 1024 the page reflows clean`,
    { annotation },
    async ({ page, app }) => {
      for (const width of [768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 768 });
        await openTuple(page, app.origin, tuple);
        await rootText(page, '200%');
        // The quality cells read root-text reflow at 1024.
        if (width === 1024) {
          const reflow = await inPage<{ rule: string; path: string; detail: string }[]>(page, {
            kind: 'reflow',
          });
          expect(reflow, 'the reflow check at 1024 with the root text at 200%').toEqual([]);
        }
        const read = await checklists(page);
        expect(read.length, 'checklists on the home').toBeGreaterThan(1);
        expect(
          read.filter((each) => each.past > 1),
          `checklists past their mats at ${width}: ${JSON.stringify(read)}`,
        ).toEqual([]);
      }
    },
  );

  test(
    `under ${type}, at 100% a checklist is a table from 768 up and a stack at 767`,
    { annotation },
    async ({ page, app }) => {
      for (const [width, stack] of [
        [767, true],
        [768, false],
        [1024, false],
        [1440, false],
      ] as const) {
        await page.setViewportSize({ width, height: 900 });
        await openTuple(page, app.origin, tuple);
        const read = await checklists(page);
        expect(read.length).toBeGreaterThan(1);
        expect(
          read.filter((each) => each.stack !== stack),
          `at ${width}: ${JSON.stringify(read)}`,
        ).toEqual([]);
      }
    },
  );
}
