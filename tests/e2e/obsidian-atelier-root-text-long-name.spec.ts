import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { home, SUMMARY } from './obsidian-atelier-appearance';

// Obsidian Atelier's chrome lay over a band of fixed height at the entrance's top: with the root
// text at 200% on a phone, a name that wraps to more lines than the band holds ran past it and over
// the entrance's plaque. At 390 on phone emulation with the root text at 200%, on the long-text
// contract fixture's home, whose words run long (a name of hyphenated surnames, an address, a
// compound term), the page lays out inside the window and every line of its text stands inside
// it, every line of the chrome's name and the Appearance summary stand above the entrance's first
// part, and every line box of the name clears Index's plate and the Appearance summary. On the
// essay's title page, whose padding at 200% left its title a column a few letters wide, every
// word stays whole on one line, unless it alone is wider than the wall the page hangs on.
// In Warm Parchment, light.

const FIXTURE = contractFixture('long-text');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(
      readFileSync(FIXTURE.files.site, 'utf8'),
      'obsidian-atelier',
    ).replace(/colorScheme: .*/, 'colorScheme: warm-parchment'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test(
  'at 390 with the root text at 200%, the long-name home lays out inside the window, every line of the name above the entrance and clear of Index and the summary',
  { annotation },
  async ({ page, app }) => {
    await home(page, app.origin, { mode: 'light', rootText: '200%' });
    const read = await page.evaluate((summary) => {
      const r = (n: number) => Math.round(n * 10) / 10;
      const box = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return [r(b.left), r(b.top), r(b.right), r(b.bottom)];
      };
      return {
        pageWide: document.scrollingElement!.scrollWidth,
        // Each line box of text that runs past the window's edges, as its element and its extent.
        cut: [...document.body.querySelectorAll('*')]
          .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))
          .flatMap((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return [...range.getClientRects()]
              .filter((b) => b.width > 0 && (b.left < -0.5 || b.right > 390.5))
              .map(
                (b) =>
                  `${el.localName}.${typeof el.className === 'string' ? el.className.split(/\s+/)[0] : ''} ${r(b.left)}..${r(b.right)}`,
              );
          })
          .slice(0, 8),
        // What runs past the window, widest first.
        past: [...document.body.querySelectorAll('*')]
          .map((el) => ({ el, b: el.getBoundingClientRect() }))
          .filter(({ b }) => b.width > 0 && b.right > 390.5)
          .sort((a, b) => b.b.right - a.b.right)
          .slice(0, 6)
          .map(
            ({ el, b }) =>
              `${el.localName}.${typeof el.className === 'string' ? el.className.split(/\s+/)[0] : ''} to ${r(b.right)}`,
          ),
        chrome: box('.oa-chrome'),
        mark: box('.oa-chrome__mark'),
        summary: box(summary),
        index: box('.oa-chrome__pin'),
        // Each line box of the name's text.
        lines: (() => {
          const mark = document.querySelector('.oa-chrome__mark');
          if (!mark) return [];
          const range = document.createRange();
          range.selectNodeContents(mark);
          return [...range.getClientRects()]
            .filter((b) => b.width > 0 && b.height > 0)
            .map((b) => [r(b.left), r(b.top), r(b.right), r(b.bottom)]);
        })(),
        // The entrance's first part: the top of the highest of its children.
        entrance: (() => {
          const tops = [...document.querySelectorAll('.oa-entrance > *')]
            .map((el) => el.getBoundingClientRect())
            .filter((b) => b.width > 0 && b.height > 0)
            .map((b) => b.top);
          return tops.length > 0 ? r(Math.min(...tops)) : null;
        })(),
      };
    }, SUMMARY);
    const { mark, summary, index, lines, entrance } = read;
    const meets = (a: number[], b: number[] | null) =>
      b !== null && a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!;
    expect(
      {
        found: mark !== null && summary !== null && entrance !== null,
        insideTheWindow: read.pageWide <= 390,
        everyLineInsideTheWindow: read.cut.length === 0,
        nameAboveTheEntrance: mark !== null && entrance !== null && mark[3]! <= entrance + 0.5,
        summaryAboveTheEntrance:
          summary !== null && entrance !== null && summary[3]! <= entrance + 0.5,
        everyLineClearsIndexAndTheSummary:
          lines.length > 0 &&
          index !== null &&
          summary !== null &&
          lines.every((line) => !meets(line, index) && !meets(line, summary)),
      },
      JSON.stringify(read),
    ).toEqual({
      found: true,
      insideTheWindow: true,
      everyLineInsideTheWindow: true,
      nameAboveTheEntrance: true,
      summaryAboveTheEntrance: true,
      everyLineClearsIndexAndTheSummary: true,
    });
  },
);

test(
  "at 390 with the root text at 200%, every word of the essay's title page stays whole on one line",
  { annotation },
  async ({ page, app }) => {
    await home(page, app.origin, { mode: 'light', rootText: '200%' });
    const read = await page.evaluate(() => {
      const r = (n: number) => Math.round(n * 10) / 10;
      const pages = [...document.querySelectorAll<HTMLElement>('.oa-vitrine .oa-folio')];
      const split: string[] = [];
      let words = 0;
      for (const folio of pages) {
        // The room a word may take: the wall's own content box, which no inset of the title
        // page can narrow. A word broken inside a page squeezed narrower than its wall counts.
        const wall = folio.closest<HTMLElement>('.oa-vitrine')!;
        const ws = getComputedStyle(wall);
        const room =
          wall.clientWidth - Number.parseFloat(ws.paddingLeft) - Number.parseFloat(ws.paddingRight);
        const nodes: Text[] = [];
        const walker = document.createTreeWalker(folio, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
        for (const node of nodes) {
          for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
            words += 1;
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
            const lines = new Set(rects.map((rect) => Math.round(rect.top))).size;
            if (lines < 2) continue;
            // The word's own width on one line, in its own font, measured off the page's flow.
            const probe = document.createElement('span');
            probe.textContent = match[0];
            probe.style.cssText = 'position: absolute; visibility: hidden; white-space: nowrap;';
            node.parentElement!.append(probe);
            const unbroken = probe.getBoundingClientRect().width;
            probe.remove();
            // Only a word wider than the wall's whole room may break; any other stays on one line.
            if (unbroken <= room + 0.5)
              split.push(
                `"${match[0]}" on ${lines} lines, ${r(unbroken)} wide unbroken, in a wall of ${r(room)}`,
              );
          }
        }
      }
      return { pages: pages.length, words, split: split.slice(0, 12) };
    });
    expect(
      { found: read.pages > 0 && read.words > 0, split: read.split },
      JSON.stringify(read),
    ).toEqual({ found: true, split: [] });
  },
);
