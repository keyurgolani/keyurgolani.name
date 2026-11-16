// Probe 2 for the foot's title block at 100% text (not for commit), run as a look on CI Linux: under
// every typography, two design languages and seven widths from 1024 to 1920, the words broken in its
// four columns as they are and with each column at least its longest word (minmax(min-content, 1fr)):
// whether the block then overflows, and whether its cells sit exactly where they did. JSON to
// $PROOF_LOOK_OUT and stdout ("tbprobe2 ").
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { openTuple, servingSchematic, type Tuple } from './schematic-tuples';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
test.use({ appOptions: servingSchematic() });
test.describe.configure({ timeout: 600_000 });

const FACES = [
  'accessible-reading',
  'book-serif',
  'console-mono',
  'drafting-grotesk',
  'editorial-serif',
  'field-serif',
  'geometric-display',
  'humanist-ui',
  'multilingual-system',
  'neutral-ui',
  'paste-up',
  'screen-grotesque',
  'shell-mono',
  'swiss-grotesque',
  'technical-sans-mono',
];
const WIDTHS = [1024, 1152, 1280, 1366, 1440, 1600, 1920];
const V = "[data-variant='schematic']";
const CANDIDATES: Record<string, string> = {
  four: '',
  fit: `@media (min-width: 48rem) { ${V} .sx-foot .sx-tb { grid-template-columns: repeat(4, minmax(min-content, 1fr)) !important; } }`,
};

const read = (page: Page) =>
  page.evaluate(() => {
    const block = document.querySelector<HTMLElement>('.sx-foot .sx-tb');
    if (!block) return null;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const bs = getComputedStyle(block);
    const room =
      block.getBoundingClientRect().width -
      parseFloat(bs.paddingInlineStart) -
      parseFloat(bs.paddingInlineEnd) -
      parseFloat(bs.borderInlineStartWidth) -
      parseFloat(bs.borderInlineEndWidth);
    const broken: string[] = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
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
        const lines = new Set(rects.map((r) => Math.round(r.top))).size;
        const width = rects.reduce((sum, r) => sum + r.width, 0);
        if (lines > 1 && width <= room + 0.5) broken.push(match[0]);
      }
    }
    const outer = block.getBoundingClientRect();
    const cells = [...block.querySelectorAll<HTMLElement>(':scope > *')]
      .filter((cell) => cell.checkVisibility())
      .map((cell) => {
        const r = cell.getBoundingClientRect();
        return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 2) / 2).join(',');
      });
    const over = Math.max(
      0,
      ...[...block.querySelectorAll('*')].map(
        (el) => el.getBoundingClientRect().right - outer.right,
      ),
    );
    return {
      rem: Math.round((outer.width / rem) * 10) / 10,
      broken,
      over: Math.round(over * 10) / 10,
      cells: cells.join(' '),
    };
  });

for (const language of ['platform-neutral', 'material-3-inspired'])
  test(`tbprobe2 ${language}`, async ({ page, app }) => {
    const out: Record<string, unknown> = {};
    for (const face of FACES)
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await openTuple(page, app.origin, `${language}/warm-parchment/${face}/system` as Tuple);
        const row: Record<string, unknown> = {};
        for (const [name, css] of Object.entries(CANDIDATES)) {
          await page.evaluate((css) => {
            let style = document.getElementById('tbprobe2');
            if (!style) {
              style = document.createElement('style');
              style.id = 'tbprobe2';
              document.head.append(style);
            }
            style.textContent = css;
          }, css);
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          row[name] = await read(page);
        }
        out[`${face} ${width}`] = row;
      }
    expect(Object.keys(out).length).toBe(FACES.length * WIDTHS.length);
    writeFileSync(path.join(OUT, `${language}.json`), JSON.stringify(out));
    console.log(`tbprobe2 ${language} ${JSON.stringify(out)}`);
  });
