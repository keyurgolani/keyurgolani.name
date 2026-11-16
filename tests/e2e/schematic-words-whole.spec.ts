import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { annotation, openTuple, servingSchematic, type Tuple } from './schematic-tuples';

// Schematic's lettering breaks only between words, at any text size: a word, between spaces, a slash
// or an en dash (each a line-break opportunity), holds one line unless it alone is wider than the
// block it sits in. Under 200% root text at 1024 the foot's title block set its field names and
// values about a letter a line ("DRAWN BY", "Rowan Vale") in four columns a few letters wide, and a
// view's title in the schedule broke inside its word ("Servic/es"), under Accessible Reading and
// Field Serif, though the block and the row hold each word whole; and under Accessible Reading at 1024
// at 100% text too, where the block's four columns, about 5rem each, set "DRA/WN" and "Septe/mber".
// The schedule is read at the folds' widths too: at 320, and at 200% zoom at 640.

test.use({ appOptions: servingSchematic() });

const ACCESSIBLE: Tuple = 'material-3-inspired/control-room/accessible-reading/dark';
const SERIF: Tuple = 'platform-neutral/warm-parchment/field-serif/system';

const CASES: readonly {
  name: string;
  tuple: Tuple;
  width: number;
  height: number;
  text?: number;
  zoom?: number;
  block: string;
}[] = [
  {
    name: "the foot's title block",
    tuple: ACCESSIBLE,
    width: 1024,
    height: 768,
    block: '.sx-foot .sx-tb',
  },
  {
    name: "the foot's title block",
    tuple: ACCESSIBLE,
    width: 1024,
    height: 768,
    text: 2,
    block: '.sx-foot .sx-tb',
  },
  {
    name: "the foot's title block",
    tuple: SERIF,
    width: 1024,
    height: 768,
    text: 2,
    block: '.sx-foot .sx-tb',
  },
  {
    name: 'the schedule',
    tuple: ACCESSIBLE,
    width: 1024,
    height: 768,
    text: 2,
    block: '.sx-schedule',
  },
  { name: 'the schedule', tuple: ACCESSIBLE, width: 320, height: 568, block: '.sx-schedule' },
  {
    name: 'the schedule',
    tuple: ACCESSIBLE,
    width: 640,
    height: 400,
    zoom: 2,
    block: '.sx-schedule',
  },
];

/** Every word in `selector`'s blocks broken across lines that its block holds whole. */
const brokenWords = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    const broken: string[] = [];
    let read = 0;
    for (const block of document.querySelectorAll<HTMLElement>(selector)) {
      if (!block.checkVisibility()) continue;
      const bs = getComputedStyle(block);
      const room =
        block.getBoundingClientRect().width -
        parseFloat(bs.paddingInlineStart) -
        parseFloat(bs.paddingInlineEnd) -
        parseFloat(bs.borderInlineStartWidth) -
        parseFloat(bs.borderInlineEndWidth);
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const host = node.parentElement;
        if (!host?.checkVisibility()) continue;
        // A language's own hyphenation is a break between syllables, not a defect.
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
    }
    return { read, broken };
  }, selector);

for (const { name, tuple, width, height, text, zoom, block } of CASES) {
  const condition = text ? `${text * 100}% root text` : zoom ? `${zoom * 100}% zoom` : '100% text';
  test(
    `under ${tuple} at ${width} with ${condition}, ${name} breaks only between words`,
    { annotation },
    async ({ page, app }) => {
      await page.setViewportSize({ width, height });
      if (zoom) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: zoom,
          mobile: false,
        });
      }
      await openTuple(page, app.origin, tuple);
      if (text)
        await page.evaluate(
          (scale) =>
            document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
          text,
        );
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const { read, broken } = await brokenWords(page, block);
      expect(read, `${name} has words to read`).toBeGreaterThan(3);
      expect(broken).toEqual([]);
    },
  );
}
