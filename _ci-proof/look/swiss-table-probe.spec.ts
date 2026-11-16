// Probe for Swiss Signal's ruled tables at 200% text (not for commit), run as a look on CI Linux: each
// table's holder width in rem at 768, 1024 and 1440 at 100% and 200% root text, on home and a case,
// and the words the red's check finds broken in the episodes' and the awards' tables with the
// phone's table rules applied under candidate holder widths. JSON to $PROOF_LOOK_OUT and stdout
// ("tableprobe "), a PNG of each table under each candidate at 1024 and 1440 at 200%.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
test.use({ appOptions: servingSwissSignal() });
test.describe.configure({ timeout: 300_000 });

const ACCESSIBLE: Tuple = 'memphis/neon-city/accessible-reading/dark';
const HUMANIST: Tuple = 'platform-neutral/warm-parchment/humanist-ui/system';
const V = "[data-variant='swiss-signal']";
/** The phone's table rules (styles.css, max-width 48rem), under a holder narrower than `rem`. */
const NARROW = (rem: number) => `${V} :has(> .ss-table) { container-type: inline-size; }
@container (max-width: ${rem}rem) {
  ${V} .ss-table { inline-size: 100% !important; margin-inline-end: 0 !important; table-layout: auto !important; }
  ${V} .ss-table :is(th, td):last-child { padding-inline-end: 0 !important; background-size: 100% var(--layout-rule-row-size) !important; }
  ${V} .ss-table thead th:last-child { background-size: 100% var(--layout-rule-section-size) !important; }
  ${V} .ss-table col { inline-size: auto !important; }
  ${V} .ss-table .ss-wide { display: none !important; }
  ${V} .ss-table .ss-narrow { display: block !important; margin-block-start: var(--space-3xs); }
}`;
const CANDIDATES: Record<string, string> = {
  none: '',
  'narrow-36': NARROW(36),
  'narrow-40': NARROW(40),
  'narrow-44': NARROW(44),
};

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
const setup = (page: Page, scale: number) =>
  page.evaluate((scale) => {
    for (const details of document.querySelectorAll('details')) details.open = true;
    document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important');
  }, scale);
const inject = (page: Page, css: string) =>
  page.evaluate((css) => {
    let style = document.getElementById('tableprobe');
    if (!style) {
      style = document.createElement('style');
      style.id = 'tableprobe';
      document.head.append(style);
    }
    style.textContent = css;
  }, css);

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
    return { read, broken, layout: getComputedStyle(table).tableLayout };
  }, selector);

test('tableprobe widths', async ({ page, app }) => {
  const out: Record<string, unknown> = {};
  for (const [route, at] of [
    ['home', '/'],
    ['case', '/work/project-name'],
  ] as const)
    for (const tuple of [ACCESSIBLE, HUMANIST])
      for (const width of [768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await openTuple(page, app.origin, tuple, at);
        for (const scale of [1, 2]) {
          await setup(page, scale);
          await frames(page);
          out[`${route} ${tuple.split('/')[2]} ${width} ${scale * 100}%`] = await page.evaluate(
            () => {
              const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
              return [...document.querySelectorAll<HTMLElement>('.ss-table')]
                .filter((t) => t.checkVisibility())
                .map((t) => {
                  const holder = t.parentElement!;
                  const s = getComputedStyle(holder);
                  const content =
                    holder.getBoundingClientRect().width -
                    parseFloat(s.paddingInlineStart) -
                    parseFloat(s.paddingInlineEnd);
                  return `${t.closest('[id]')?.id ?? '?'} ${Math.round((content / rem) * 10) / 10}`;
                });
            },
          );
        }
      }
  writeFileSync(path.join(OUT, 'widths.json'), JSON.stringify(out));
  console.log(`tableprobe widths ${JSON.stringify(out)}`);
});

for (const width of [1024, 1440] as const)
  test(`tableprobe candidates ${width}`, async ({ page, app }) => {
    await page.setViewportSize({ width, height: 900 });
    await openTuple(page, app.origin, ACCESSIBLE);
    await setup(page, 2);
    await frames(page);
    const out: Record<string, unknown> = {};
    for (const [name, css] of Object.entries(CANDIDATES)) {
      await inject(page, css);
      await frames(page);
      for (const selector of ['#episodes .ss-table', '#awards .ss-table']) {
        out[`${name} ${selector}`] = await brokenWords(page, selector);
        const el = page.locator(selector).first();
        await el.scrollIntoViewIfNeeded();
        await el.screenshot({
          path: path.join(OUT, `${width}-${name}-${selector.slice(1, selector.indexOf(' '))}.png`),
          animations: 'disabled',
        });
      }
    }
    expect(Object.keys(out).length).toBe(8);
    writeFileSync(path.join(OUT, `candidates-${width}.json`), JSON.stringify(out));
    console.log(`tableprobe candidates ${width} ${JSON.stringify(out)}`);
  });
