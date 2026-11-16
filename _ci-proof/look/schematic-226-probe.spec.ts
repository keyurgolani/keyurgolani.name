// Probe for Schematic's words at 200% text (not for commit), run as a look on CI Linux: the widths, in
// rem, of the foot's title block, the cover's and the schedule at 768, 1024 and 1440, at 100% and 200%
// root text; and the words the red's check finds broken, under candidate rules, in its five cases.
// JSON to $PROOF_LOOK_OUT and to stdout ("probe226 "), a PNG of each case's block under each candidate.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { openTuple, servingSchematic, type Tuple } from './schematic-tuples';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
test.use({ appOptions: servingSchematic() });
test.describe.configure({ timeout: 300_000 });

const ACCESSIBLE: Tuple = 'material-3-inspired/control-room/accessible-reading/dark';
const SERIF: Tuple = 'platform-neutral/warm-parchment/field-serif/system';
const V = "[data-variant='schematic']";
const TB = (rem: number, cols: 1 | 2) => `@container (max-width: ${rem}rem) {
  ${V} .sx-foot .sx-tb__cell { grid-column: ${cols === 1 ? '1 / -1' : 'span 2'} !important; }
  ${V} .sx-foot .sx-tb__cell:is([data-span='2'], [data-span='3'], [data-span='4']) { grid-column: 1 / -1 !important; }
}`;
const SCHEDULE = (rem: number) => `${V} .sx-schedule { container-type: inline-size; }
@media (min-width: 48rem) { @container (max-width: ${rem}rem) {
  ${V} .sx-schedule summary.sx-vt { grid-template-columns: max-content minmax(0, 1fr) max-content max-content !important; column-gap: normal !important; }
  ${V} .sx-schedule summary.sx-vt > * { grid-column: auto !important; }
  ${V} .sx-schedule summary.sx-vt > .sx-vt__title { padding-inline-start: 0 !important; }
} }`;
const CANDIDATES: Record<string, string> = {
  none: '',
  'tb1-16': TB(16, 1),
  'tb2-16': TB(16, 2),
  'tb1-19': TB(19, 1),
  's-30': SCHEDULE(30),
  's-36': SCHEDULE(36),
};

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
          if (lines > 1 && width <= room + 0.5) broken.push(`${match[0]} ${lines}`);
        }
      }
    }
    return { read, broken };
  }, selector);

const inject = (page: Page, css: string) =>
  page.evaluate((css) => {
    let style = document.getElementById('probe226');
    if (!style) {
      style = document.createElement('style');
      style.id = 'probe226';
      document.head.append(style);
    }
    style.textContent = css;
  }, css);

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

const rootText = (page: Page, scale: number) =>
  page.evaluate(
    (scale) =>
      document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
    scale,
  );

test('probe226 widths', async ({ page, app }) => {
  const out: Record<string, unknown> = {};
  for (const tuple of [ACCESSIBLE, SERIF])
    for (const width of [768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await openTuple(page, app.origin, tuple);
      for (const scale of [1, 2]) {
        await rootText(page, scale);
        await frames(page);
        out[`${tuple.split('/')[2]} ${width} ${scale * 100}%`] = await page.evaluate(() => {
          const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
          const w = (selector: string) =>
            [...document.querySelectorAll<HTMLElement>(selector)]
              .filter((el) => el.checkVisibility())
              .map((el) => Math.round((el.getBoundingClientRect().width / rem) * 10) / 10);
          return {
            rem,
            footTb: w('.sx-foot .sx-tb'),
            coverTb: w('.sx-tb[data-at="cover"]'),
            sheetTb: w('.sx-tb[data-at="sheet"]').slice(0, 2),
            schedule: w('.sx-schedule').slice(0, 3),
            title: w('.sx-schedule .sx-vt__title').slice(0, 3),
          };
        });
      }
    }
  writeFileSync(path.join(OUT, 'widths.json'), JSON.stringify(out));
  console.log(`probe226 widths ${JSON.stringify(out)}`);
});

const CASES: readonly {
  stem: string;
  tuple: Tuple;
  width: number;
  height: number;
  text?: number;
  zoom?: number;
  block: string;
}[] = [
  {
    stem: 'tb-accessible-1024-200',
    tuple: ACCESSIBLE,
    width: 1024,
    height: 768,
    text: 2,
    block: '.sx-foot .sx-tb',
  },
  {
    stem: 'tb-serif-1024-200',
    tuple: SERIF,
    width: 1024,
    height: 768,
    text: 2,
    block: '.sx-foot .sx-tb',
  },
  {
    stem: 'schedule-accessible-1024-200',
    tuple: ACCESSIBLE,
    width: 1024,
    height: 768,
    text: 2,
    block: '.sx-schedule',
  },
  {
    stem: 'schedule-accessible-320',
    tuple: ACCESSIBLE,
    width: 320,
    height: 568,
    block: '.sx-schedule',
  },
  {
    stem: 'schedule-accessible-zoom-640',
    tuple: ACCESSIBLE,
    width: 640,
    height: 400,
    zoom: 2,
    block: '.sx-schedule',
  },
  {
    stem: 'tb-accessible-1440-200',
    tuple: ACCESSIBLE,
    width: 1440,
    height: 900,
    text: 2,
    block: '.sx-foot .sx-tb',
  },
  {
    stem: 'schedule-accessible-1440-200',
    tuple: ACCESSIBLE,
    width: 1440,
    height: 900,
    text: 2,
    block: '.sx-schedule',
  },
];

for (const c of CASES)
  test(`probe226 ${c.stem}`, async ({ page, app }) => {
    await page.setViewportSize({ width: c.width, height: c.height });
    if (c.zoom) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: c.width,
        height: c.height,
        deviceScaleFactor: c.zoom,
        mobile: false,
      });
    }
    await openTuple(page, app.origin, c.tuple);
    if (c.text) await rootText(page, c.text);
    await frames(page);
    const out: Record<string, unknown> = {};
    for (const [name, css] of Object.entries(CANDIDATES)) {
      await inject(page, css);
      await frames(page);
      out[name] = {
        ...(await brokenWords(page, c.block)),
        scroll: await page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.documentElement.clientWidth,
        ]),
      };
      const el = page.locator(c.block).first();
      if (name === 'none' || name.startsWith(c.block.includes('tb') ? 'tb' : 's-')) {
        await el.scrollIntoViewIfNeeded();
        await el.screenshot({
          path: path.join(OUT, `${c.stem}-${name}.png`),
          animations: 'disabled',
        });
      }
    }
    expect(Object.keys(out).length).toBe(Object.keys(CANDIDATES).length);
    writeFileSync(path.join(OUT, `${c.stem}.json`), JSON.stringify(out));
    console.log(`probe226 ${c.stem} ${JSON.stringify(out)}`);
  });
