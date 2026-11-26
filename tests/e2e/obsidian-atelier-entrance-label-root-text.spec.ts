import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { inPage } from '../quality/lib/a11y/probe';
import { openTuple, rootText, servingObsidianAtelier, type Tuple } from './obsidian-atelier-tuples';

// Obsidian Atelier: v1.0.1-rc.2's release cell obsidian-atelier complete /
// paper-tactile/neutral-slate/shell-mono/dark recorded reflow/root-text at 1024x768 (#296 had seen
// the same at -26 px under Accessible Reading): with the root text at 200%, the entrance's wall
// label, the sample work's, ran from -13 px. From 64rem the entrance pins its label beside the work,
// in the hang's first column, a track that shrinks below the label's longest word, and sets it at
// the track's end, so what doesn't fit runs out past the window's start, where the wall's clip
// cuts it. A media query's rem is the browser's default, so the reader's text never moves that
// breakpoint. The work's own page hangs its installation the same way, and ran from -112 px. The
// label settles in last of the entrance, held transparent until then, and the reflow probe reads no
// transparent text, so the cells saw it only when their read came late (#296's run again passed):
// here each read waits for the label's entrance to end. With the root text at 200% at 1024, set as
// the root-text condition sets it (conditions.ts: once the page and its fonts are in), the label
// hangs under the work, as below 64rem, reads inside the window, and the reflow probe finds
// nothing; at 1x, at 1024 and 1440, it keeps its place, beside the work at its bottom-left.

test.use({ appOptions: servingObsidianAtelier() });

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const ROUTES = ['/', '/work/project-name'] as const;

// rc.2's tuple, #296's, and the widest face under the default language.
const TUPLES: readonly Tuple[] = [
  'paper-tactile/neutral-slate/shell-mono/dark',
  'platform-neutral/warm-parchment/accessible-reading/system',
  'platform-neutral/warm-parchment/shell-mono/system',
];

const LABEL = '#oa--label-project-name';

/** The page's fonts in, and the label's entrance ended, so it reads as it rests. */
async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page
    .locator(LABEL)
    .evaluate((label) =>
      Promise.all(label.getAnimations({ subtree: true }).map((each) => each.finished)),
    );
}

/** The sample work's label, its spans' text, the work it labels, and its wall, in viewport px. */
const readLabel = (page: Page) =>
  page.locator(LABEL).evaluate((label) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const spans = [...label.querySelectorAll(':scope > span')].map((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      return {
        text: (span.textContent ?? '').trim().slice(0, 30),
        left: Math.min(...rects.map((r) => r.left)),
        right: Math.max(...rects.map((r) => r.right)),
      };
    });
    return {
      root: getComputedStyle(document.documentElement).fontSize,
      window: document.documentElement.clientWidth,
      label: box(label),
      work: box(label.closest('.oa-hang')!.querySelector('.oa-hang__work')!),
      wall: box(label.closest('.oa-wall')!),
      spans,
    };
  });

for (const tuple of TUPLES) {
  const [language, , type] = tuple.split('/');
  test(
    `under ${language} and ${type}, at 1024 with the root text at 200%, the entrance's and the installation's labels hang under the work, inside the window`,
    { annotation },
    async ({ page, app }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      for (const route of ROUTES) {
        await openTuple(page, app.origin, tuple, route);
        await settled(page);
        await rootText(page, '200%');
        const reflow = await inPage<{ rule: string; path: string; detail: string }[]>(page, {
          kind: 'reflow',
        });
        expect(
          reflow.filter((each) => each.path.startsWith(LABEL)),
          `the reflow check on ${route}'s label at 1024 with the root text at 200%`,
        ).toEqual([]);
        const read = await readLabel(page);
        expect(read.root, 'the root text is at 200%').toBe('32px');
        expect(read.spans.length, `${route}'s label has its lines`).toBeGreaterThan(1);
        expect(read.label.top, `${route}'s label hangs under the work`).toBeGreaterThanOrEqual(
          read.work.bottom - 0.5,
        );
        for (const span of read.spans) {
          const where = `"${span.text}" on ${route}`;
          expect(
            span.left,
            `${where} starts inside its wall and the window`,
          ).toBeGreaterThanOrEqual(Math.max(read.wall.left, 0) - 0.5);
          expect(span.right, `${where} ends inside its wall and the window`).toBeLessThanOrEqual(
            Math.min(read.wall.right, read.window) + 0.5,
          );
        }
      }
    },
  );
}

// At the reader's own text size the label keeps its place, so the fix for large text leaves 1x
// where it was: beside the work, before it, its foot on the work's.
for (const width of [1024, 1440]) {
  test(
    `at ${width} at 1x, the entrance's and the installation's labels hang beside the work, at its bottom-left`,
    { annotation },
    async ({ page, app }) => {
      await page.setViewportSize({ width, height: 768 });
      for (const route of ROUTES) {
        await openTuple(page, app.origin, TUPLES[0]!, route);
        await settled(page);
        const read = await readLabel(page);
        expect(read.root, 'the reader text is the default').toBe('16px');
        expect(read.label.right, `${route}'s label ends before the work`).toBeLessThanOrEqual(
          read.work.left + 0.5,
        );
        expect(read.label.top, `${route}'s label is beside the work`).toBeLessThan(
          read.work.bottom,
        );
        expect(
          Math.abs(read.label.bottom - read.work.bottom),
          `${route}'s label stands on the work's foot`,
        ).toBeLessThanOrEqual(0.5);
      }
    },
  );
}
