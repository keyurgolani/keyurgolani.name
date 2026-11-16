// Probe for Swiss Signal's ruled tables' columns (not for commit), run as a look on CI Linux. For
// every visible ruled table on home, under two typographies, at widths from 768 to 1920 and root
// text from 100% to 200%: the frame's width, the gutter, and per column its content width and the
// widest word its cells hold (each in rem), with the words it breaks. Then two candidates at the
// same points: A, the phone's table rules for a table whose last column is a twelfth, under a 44rem
// frame; B, table-layout auto with the columns' own widths. For B at 100% text, each column's
// start and width against the fixed layout's. JSON to $PROOF_LOOK_OUT and stdout ("endprobe "), and
// a PNG of the episodes' table at 1440 and 200% under each candidate.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
test.use({ appOptions: servingSwissSignal() });
test.describe.configure({ timeout: 600_000 });

const TUPLES: Record<string, Tuple> = {
  accessible: 'memphis/neon-city/accessible-reading/dark',
  humanist: 'platform-neutral/warm-parchment/humanist-ui/system',
};
const WIDTHS = [768, 1024, 1280, 1366, 1440, 1536, 1600, 1920];
const SCALES = [1, 1.25, 1.5, 1.75, 2];
const V = "[data-variant='swiss-signal']";
const T = `${V} .ss-table:has(> colgroup > col.ss-c1:last-child)`;
const CANDIDATES: Record<string, string> = {
  none: '',
  A: `@container (max-width: 44rem) {
  ${T} { inline-size: 100% !important; margin-inline-end: 0 !important; table-layout: auto !important; }
  ${T} :is(th, td):last-child { padding-inline-end: 0 !important; background-size: 100% var(--layout-rule-row-size) !important; }
  ${T} thead th:last-child { background-size: 100% var(--layout-rule-section-size) !important; }
  ${T} col { inline-size: auto !important; }
  ${T} .ss-wide { display: none !important; }
  ${T} .ss-narrow { display: block !important; margin-block-start: var(--space-3xs); }
}`,
  B: `${V} .ss-table { table-layout: auto !important; }`,
};

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
const setup = (page: Page, scale: number, css: string) =>
  page.evaluate(
    ([scale, css]) => {
      for (const details of document.querySelectorAll('details')) details.open = true;
      document.documentElement.style.setProperty(
        'font-size',
        `${Number(scale) * 100}%`,
        'important',
      );
      let style = document.getElementById('endprobe');
      if (!style) {
        style = document.createElement('style');
        style.id = 'endprobe';
        document.head.append(style);
      }
      style.textContent = String(css);
    },
    [String(scale), css] as const,
  );

/** Each visible ruled table: its frame and gutter, and per column its room, widest word, breaks, and box. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const r = (px: number) => Math.round((px / rem) * 100) / 100;
    return [...document.querySelectorAll<HTMLTableElement>('.ss-table')]
      .filter((t) => t.checkVisibility())
      .map((table) => {
        const frame = table.parentElement!;
        const cols = [...table.querySelectorAll('col')].map((col) => col.className);
        const heads = [...table.querySelectorAll<HTMLElement>('thead th')];
        const gutter = parseFloat(getComputedStyle(heads[0] ?? table).paddingInlineEnd) || 0;
        const room = table.getBoundingClientRect().width;
        const columns = heads.map((th, index) => {
          let widest = 0;
          const broken: string[] = [];
          for (const cell of table.querySelectorAll<HTMLTableCellElement>(
            `thead th:nth-child(${index + 1}), tbody tr:not(.ss-group-row) > :nth-child(${index + 1})`,
          )) {
            if (!cell.checkVisibility()) continue;
            const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (!node.parentElement?.checkVisibility()) continue;
              for (const match of (node.textContent ?? '').matchAll(/[^\s/\u2013]+/g)) {
                const range = document.createRange();
                range.setStart(node, match.index!);
                range.setEnd(node, match.index! + match[0].length);
                const rects = [...range.getClientRects()].filter((x) => x.width > 0);
                if (rects.length === 0) continue;
                const width = rects.reduce((sum, x) => sum + x.width, 0);
                widest = Math.max(widest, width);
                const lines = new Set(rects.map((x) => Math.round(x.top))).size;
                if (lines > 1 && width <= room + 0.5) broken.push(match[0]);
              }
            }
          }
          const box = th.getBoundingClientRect();
          const s = getComputedStyle(th);
          const inner =
            box.width - parseFloat(s.paddingInlineStart) - parseFloat(s.paddingInlineEnd);
          return {
            label: th.textContent?.trim(),
            col: cols[index],
            shown: th.checkVisibility(),
            room: r(inner),
            widest: r(widest),
            broken,
            x: Math.round(box.left * 10) / 10,
            w: Math.round(box.width * 10) / 10,
          };
        });
        return {
          id: table.closest('section[id]')?.id ?? '?',
          frame: r(frame.getBoundingClientRect().width),
          gutter: r(gutter),
          layout: getComputedStyle(table).tableLayout,
          columns,
        };
      });
  });

for (const [name, tuple] of Object.entries(TUPLES))
  test(`endprobe ${name}`, async ({ page, app }) => {
    const out: Record<string, unknown> = {};
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await openTuple(page, app.origin, tuple);
      for (const scale of SCALES)
        for (const [candidate, css] of Object.entries(CANDIDATES)) {
          await setup(page, scale, css);
          await frames(page);
          out[`${width} ${scale * 100}% ${candidate}`] = await measure(page);
          if (width === 1440 && scale === 2) {
            const episodes = page.locator('#episodes .ss-table').first();
            await episodes.scrollIntoViewIfNeeded();
            await episodes.screenshot({
              path: path.join(OUT, `${name}-1440-200-${candidate}-episodes.png`),
              animations: 'disabled',
            });
          }
        }
    }
    expect(Object.keys(out).length).toBe(WIDTHS.length * SCALES.length * 3);
    writeFileSync(path.join(OUT, `endprobe-${name}.json`), JSON.stringify(out));
    console.log(`endprobe ${name} ${JSON.stringify(out)}`);
  });
