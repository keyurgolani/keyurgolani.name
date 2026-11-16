import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { annotation, openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

// Swiss Signal's ruled tables break their words only between words, at any text size: a word,
// between spaces, a slash or an en dash (each a line-break opportunity), holds one line unless it
// alone is wider than the table. Under 200% root text at 1024 the episodes' and the awards' narrow
// columns set a word a letter or two a line ("42 / mi / n", "Li / st / en", "organizatio / n")
// under Accessible Reading, where the table holds every word whole. With the records' folds open,
// as a reader opens them.

test.use({ appOptions: servingSwissSignal() });

const TUPLE: Tuple = 'memphis/neon-city/accessible-reading/dark';
const TABLES = ['#episodes .ss-table', '#awards .ss-table'] as const;

/** Every word in the table broken across lines that the table holds whole. */
const brokenWords = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    const table = document.querySelector<HTMLElement>(selector);
    if (!table) return null;
    const room = table.getBoundingClientRect().width;
    const broken: string[] = [];
    let read = 0;
    const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const host = node.parentElement;
      if (!host?.checkVisibility()) continue;
      if (getComputedStyle(host).hyphens === 'auto') continue;
      for (const match of (node.textContent ?? '').matchAll(/[^\s/\u2013]+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        if (rects.length === 0) continue;
        read++;
        const lines = new Set(rects.map((r) => Math.round(r.top))).size;
        const width = rects.reduce((sum, r) => sum + r.width, 0);
        if (lines > 1 && width <= room + 0.5)
          broken.push(
            `"${match[0]}" on ${lines} lines (${width.toFixed(1)} of ${room.toFixed(1)} px)`,
          );
      }
    }
    return { read, broken };
  }, selector);

for (const selector of TABLES)
  test(
    `under ${TUPLE} at 1024 with 200% root text, ${selector} breaks only between words`,
    { annotation },
    async ({ page, app }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await openTuple(page, app.origin, TUPLE);
      await page.evaluate(() => {
        for (const details of document.querySelectorAll('details')) details.open = true;
        document.documentElement.style.setProperty('font-size', '200%', 'important');
      });
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const read = await brokenWords(page, selector);
      expect(read, `${selector} is on the page`).not.toBeNull();
      expect(read!.read, `${selector} has words to read`).toBeGreaterThan(3);
      expect(read!.broken).toEqual([]);
    },
  );
