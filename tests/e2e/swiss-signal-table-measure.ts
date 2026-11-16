import type { Page } from '@playwright/test';

// What Swiss Signal's ruled tables break that they could hold whole, read from every cell of every
// visible ruled table on the page:
// - a word, or a part of a compound between its hyphens or en dashes, broken across lines: a line
//   may end after a space, a slash, a hyphen or an en dash, each a break between words, so
//   "multi-region" set over two lines at its hyphen holds both its words whole;
// - in an end column, a value and its unit ("14 min") split across lines.
// Each is set whole on one line in its own font, in a hidden probe in its own element, and is
// excused only when that is wider than its table's content box, which no split of the columns can
// widen. One only wider than its column is never excused: the column being too narrow is the fault.

/** The tables read, the words read, and each break named with its whole width and its column's room. */
export const tableBreaks = (page: Page) =>
  page.evaluate(() => {
    const words: string[] = [];
    const units: string[] = [];
    let read = 0;
    let tables = 0;
    const lineCount = (range: Range) => {
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      return rects.length === 0 ? 0 : new Set(rects.map((r) => Math.round(r.top))).size;
    };
    const wholeWidth = (host: Element, text: string) => {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
      probe.textContent = text;
      host.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    };
    for (const table of document.querySelectorAll<HTMLTableElement>('.ss-table')) {
      if (!table.checkVisibility()) continue;
      tables++;
      const room = table.clientWidth;
      const where = table.closest('section[id]')?.id ?? 'a table';
      const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
      for (const cell of table.querySelectorAll<HTMLTableCellElement>('th, td')) {
        if (!cell.checkVisibility()) continue;
        const style = getComputedStyle(cell);
        const inner =
          cell.clientWidth -
          parseFloat(style.paddingInlineStart) -
          parseFloat(style.paddingInlineEnd);
        const column = cell.colSpan === 1 ? (heads[cell.cellIndex] ?? '') : 'a spanning cell';
        const name = (text: string, lines: number, whole: number) =>
          `#${where} ${column}: "${text}" on ${lines} lines, ${whole.toFixed(1)} px whole in ${inner.toFixed(1)} px of column (table ${room.toFixed(1)} px)`;
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const host = node.parentElement;
          if (!host?.checkVisibility()) continue;
          const text = node.textContent ?? '';
          const patterns: [RegExp, string[]][] = [];
          if (getComputedStyle(host).hyphens !== 'auto')
            patterns.push([/[^\s/\u2010\u2013-]+/g, words]);
          if (cell.classList.contains('ss-end'))
            patterns.push([/\d[\d.,:]*[ \u00a0]+\p{L}+/gu, units]);
          for (const [pattern, into] of patterns)
            for (const match of text.matchAll(pattern)) {
              const range = document.createRange();
              range.setStart(node, match.index!);
              range.setEnd(node, match.index! + match[0].length);
              const lines = lineCount(range);
              if (lines === 0) continue;
              if (into === words) read++;
              if (lines === 1) continue;
              const whole = wholeWidth(host, match[0]);
              if (whole <= room + 0.5) into.push(name(match[0], lines, whole));
            }
        }
      }
    }
    return { tables, read, words, units };
  });
