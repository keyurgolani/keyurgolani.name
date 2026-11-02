// What Singular's panel 3 checks measure in the page, shared by its two specs (the fixture copy's
// long unit and the sample). It runs in the page through locator.evaluate, so it reaches nothing
// outside itself.

/** One figure row: the words that sit on two lines, and the statement's share of the row. */
export interface FigureRowFit {
  statement: string;
  /** Words of the statement, its description or the unit whose glyphs start a second line. */
  split: string[];
  /** The statement's inline size over the row's. */
  share: number;
  /** How far the row's content runs past the row, in px. */
  overflow: number;
  /** Whether the figure sits beside the statement, on its last line, and not on a line of its own. */
  beside: boolean;
}

/**
 * Run in the page on panel 3's ledger (`.sg-nums__list`): each row's fit. A word is a run
 * between spaces; it is split when its glyph boxes sit at more than one top.
 */
export function figureRowFits(list: Element): FigureRowFit[] {
  const splitWords = (element: Element | null) => {
    const out: string[] = [];
    if (!element) return out;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        const tops = new Set(
          [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
        );
        if (tops.size > 1) out.push(match[0]);
      }
    }
    return out;
  };
  return [...list.querySelectorAll<HTMLElement>('.sg-nums__row')].map((row) => {
    const dt = row.querySelector('dt')!;
    const dd = row.querySelector('dd')!;
    const box = row.getBoundingClientRect();
    const right = Math.max(
      dt.getBoundingClientRect().right,
      dd.getBoundingClientRect().right,
      ...[...dd.children].map((child) => child.getBoundingClientRect().right),
    );
    return {
      statement: (dt.textContent ?? '').trim(),
      split: [...splitWords(dt), ...splitWords(dd.querySelector('.sg-nums__unit'))],
      share: dt.getBoundingClientRect().width / box.width,
      overflow: Math.max(0, right - box.right, row.scrollWidth - row.clientWidth),
      beside: dd.getBoundingClientRect().top < dt.getBoundingClientRect().bottom - 1,
    };
  });
}
