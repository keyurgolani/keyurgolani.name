import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { annotation, openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

// Swiss Signal's part openers break their display word only between words, at any text size:
// a word, between spaces, a slash or an en dash (each a line-break opportunity), holds one line
// unless it is wider than the opener even at body size, as the poster line's floor has it. With
// the root text at 200% on a phone the home page's part words set at their poster step, wider
// than the opener, and broke inside the word ("WO / RK" at 320, "WOR / K" at 390) under every
// typography, as here under Humanist UI and Accessible Reading, though the opener holds each word
// whole at a smaller size.

test.use({ appOptions: servingSwissSignal() });

const TUPLES: readonly Tuple[] = [
  'platform-neutral/warm-parchment/humanist-ui/system',
  'memphis/neon-city/accessible-reading/dark',
];
const VIEWS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

/** Every word of a part's display word broken across lines that its opener holds at body size. */
const brokenWords = (page: Page) =>
  page.evaluate(() => {
    const broken: string[] = [];
    let read = 0;
    for (const title of document.querySelectorAll<HTMLElement>('.ss-part__title')) {
      if (!title.checkVisibility()) continue;
      const open = title.closest<HTMLElement>('.ss-part__open') ?? title;
      const os = getComputedStyle(open);
      const room =
        open.getBoundingClientRect().width -
        parseFloat(os.paddingInlineStart) -
        parseFloat(os.paddingInlineEnd) -
        parseFloat(os.borderInlineStartWidth) -
        parseFloat(os.borderInlineEndWidth);
      // The word's width at body size: as set, scaled from the title's size to the body's.
      const sample = document.createElement('span');
      sample.style.fontSize = 'var(--type-body-font-size)';
      title.append(sample);
      const scale =
        parseFloat(getComputedStyle(sample).fontSize) /
        parseFloat(getComputedStyle(title).fontSize);
      sample.remove();
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node.textContent ?? '').matchAll(/[^\s/\u2013]+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index!);
          range.setEnd(node, match.index! + match[0].length);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          if (rects.length === 0) continue;
          read++;
          const lines = new Set(rects.map((r) => Math.round(r.top))).size;
          const width = rects.reduce((sum, r) => sum + r.width, 0);
          const atBody = width * scale;
          if (lines > 1 && atBody <= room + 0.5)
            broken.push(
              `"${match[0]}" on ${lines} lines (${atBody.toFixed(1)} of ${room.toFixed(1)} px at body size)`,
            );
        }
      }
    }
    return { read, broken };
  });

for (const tuple of TUPLES)
  for (const { width, height } of VIEWS)
    test(
      `under ${tuple} at ${width} with 200% root text, every part's word breaks only between words`,
      { annotation },
      async ({ page, app }) => {
        await page.setViewportSize({ width, height });
        await openTuple(page, app.origin, tuple);
        await page.evaluate(() =>
          document.documentElement.style.setProperty('font-size', '200%', 'important'),
        );
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        const { read, broken } = await brokenWords(page);
        expect(read, 'the home page has its parts').toBeGreaterThan(3);
        expect(broken).toEqual([]);
      },
    );
