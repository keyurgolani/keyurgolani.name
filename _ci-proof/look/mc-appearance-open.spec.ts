// A look-only read: Mission Control on each contract fixture, its home and its first routed work
// page, at 320x568 and 390x844 on a phone and at 1440x900, with the root text at 200% and at its
// own size, with only the status line's Appearance disclosure opened. Each page is read under
// each candidate rule for the line's end box, laid in as a style element: none, the box may shrink
// below 64rem, the same with no minimum, and the box takes the whole line while a fold in it is
// open below 64rem. For each: the end box closed and the line's box, then with the disclosure
// open the page's scroll width against the window, how far it scrolls each way, the end box and
// the panel, and the widest boxes past either edge outside a fixed layer or a scroller. One JSON
// a page and one TSV row a rule go to PROOF_LOOK_OUT. It reads and never fails on what it finds.
// The base side of a look run skips: the read is of the head.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { readPair } from '../../packages/schema/src/node';
import { resolvePortfolioView, routedSlugs } from '../../packages/schema/src/index';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { fixtureApp, UNDER_TEST } from '../variants/target';

const OUT = process.env.PROOF_LOOK_OUT ?? path.join('reports', 'mc-appearance-open');
const BASE_SIDE = process.env.PROOF_LOOK_SIDE === 'base';
const ID = 'mission-control';
const VIEWPORTS = [
  { id: '320x568', width: 320, height: 568, isMobile: true },
  { id: '390x844', width: 390, height: 844, isMobile: true },
  { id: '1440x900', width: 1440, height: 900, isMobile: false },
] as const;
const SIZES = ['200%', '100%'] as const;
const END = "[data-variant='mission-control'] .mc-status__end";
const RULES: Record<string, string> = {
  none: '',
  shrink: `@media (width < 64rem) { ${END} { flex-shrink: 1 } }`,
  shrink0: `@media (width < 64rem) { ${END} { flex-shrink: 1; min-inline-size: 0 } }`,
  full: `@media (width < 64rem) { ${END}:has([open]) { flex-basis: 100% } }`,
};
const VARIANT = UNDER_TEST.find(({ manifest }) => manifest.id === ID);

/** The fixture's first routed work page, or null when it routes none. */
function firstWork(fixture: (typeof CONTRACT_FIXTURES)[number]): string | null {
  const read = readPair(fixture.files);
  if (!read.ok) return null;
  const routed = [
    ...routedSlugs(resolvePortfolioView(read.pair, {}, { mediaBase: '/media' })),
  ].sort();
  return routed.length ? `/work/${routed[0]}` : null;
}

const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 150))),
      ),
  );

const box = (page: Page, selector: string) =>
  page.evaluate((q) => {
    const r = document.querySelector(q)?.getBoundingClientRect();
    return r
      ? [r.left, r.right, r.width, r.top, r.height].map((v) => Math.round(v * 10) / 10)
      : null;
  }, selector);

const setOpen = (page: Page, open: boolean) =>
  page.evaluate((o) => {
    const all = [...document.querySelectorAll('.mc-status__end details')];
    for (const fold of all) (fold as HTMLDetailsElement).open = o;
    return all.length;
  }, open);

/** With the disclosure open: the page's width, how far it scrolls, and the widest boxes past either edge. */
const readOpen = (page: Page) =>
  page.evaluate(() => {
    const html = document.documentElement;
    const edge = html.clientWidth;
    const round = (v: number) => Math.round(v * 10) / 10;
    const name = (el: Element) =>
      `${el.localName}${el.id ? `#${el.id}` : ''}${[...el.classList]
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join('')}`;
    const chain = (el: Element) => {
      const parts: string[] = [];
      for (let n: Element | null = el; n && n !== html && parts.length < 5; n = n.parentElement)
        parts.unshift(name(n));
      return parts.join(' > ');
    };
    const held = (el: Element) => {
      for (let n: Element | null = el; n && n !== html; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.position === 'fixed') return true;
        if (n !== el && s.overflowX !== 'visible') {
          const b = n.getBoundingClientRect();
          return b.right <= edge + 0.5 && b.left >= -0.5;
        }
      }
      return false;
    };
    const past: { chain: string; left: number; right: number; width: number; text: string }[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || (r.right <= edge + 0.5 && r.left >= -0.5) || held(el)) continue;
      past.push({
        chain: chain(el),
        left: round(r.left),
        right: round(r.right),
        width: round(r.width),
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30),
      });
    }
    past.sort((a, b) => b.width - a.width);
    const scroller = document.scrollingElement ?? html;
    const at = scroller.scrollLeft;
    scroller.scrollLeft = -1e7;
    const least = scroller.scrollLeft;
    scroller.scrollLeft = 1e7;
    const most = scroller.scrollLeft;
    scroller.scrollLeft = at;
    return {
      scroll: html.scrollWidth,
      client: edge,
      dir: getComputedStyle(document.body).direction,
      least: round(least),
      most: round(most),
      past: past.length,
      top: past.slice(0, 3),
    };
  });

for (const fixture of CONTRACT_FIXTURES) {
  test(`${ID} on ${fixture.name}, at 320, 390 and 1440 with the root text at 200% and 100% and the Appearance disclosure open, under each candidate rule`, async ({
    browser,
  }, testInfo) => {
    test.skip(BASE_SIDE, 'the read is of the head');
    test.setTimeout(400_000);
    if (!VARIANT) throw new Error(`${ID} is not under test`);
    const work = firstWork(fixture);
    const pages = [{ kind: 'home', route: '/' }, ...(work ? [{ kind: 'work', route: work }] : [])];
    const app = await startApp({
      ...fixtureApp(fixture, VARIANT),
      logFile: testInfo.outputPath('server.log'),
    });
    const rows: string[] = [];
    mkdirSync(path.join(OUT, ID), { recursive: true });
    try {
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.isMobile,
          hasTouch: viewport.isMobile,
          baseURL: app.origin,
        });
        try {
          const page = await context.newPage();
          for (const { kind, route } of pages)
            for (const size of SIZES) {
              await page.goto(route, { waitUntil: 'load' });
              await page
                .waitForLoadState('networkidle', { timeout: 10_000 })
                .catch(() => undefined);
              await page.evaluate(() => document.fonts.ready);
              await page.evaluate(
                (s) => document.documentElement.style.setProperty('font-size', s, 'important'),
                size,
              );
              const reads: Record<string, unknown> = {};
              for (const [rule, css] of Object.entries(RULES)) {
                await page.evaluate((c) => {
                  let style = document.getElementById('look-rule');
                  if (!style) {
                    style = document.createElement('style');
                    style.id = 'look-rule';
                    document.head.append(style);
                  }
                  style.textContent = c;
                }, css);
                const folds = await setOpen(page, false);
                await frames(page);
                const closed = {
                  end: await box(page, '.mc-status__end'),
                  status: await box(page, '.mc-status'),
                  scroll: await page.evaluate(() => document.documentElement.scrollWidth),
                };
                await setOpen(page, true);
                await frames(page);
                const open = {
                  ...(await readOpen(page)),
                  end: await box(page, '.mc-status__end'),
                  panel: await box(page, ".mc-status__end [data-ui-slot='disclosure.content']"),
                  status: await box(page, '.mc-status'),
                };
                reads[rule] = { folds, closed, open };
                const first = open.top[0];
                const row = [
                  ID,
                  fixture.name,
                  viewport.id,
                  size,
                  kind,
                  rule,
                  String(folds),
                  String(open.scroll),
                  String(open.client),
                  open.dir,
                  String(open.least),
                  String(open.past),
                  JSON.stringify(closed.end),
                  JSON.stringify(closed.status),
                  JSON.stringify(open.end),
                  JSON.stringify(open.panel),
                  first
                    ? `${first.chain} [${first.left}, ${first.right}] w ${first.width} "${first.text}"`
                    : '-',
                ]
                  .map((v) => v.replace(/[\t\n]/g, ' '))
                  .join('\t');
                rows.push(row);
                console.log(`mc-appearance-open\t${row}`);
              }
              writeFileSync(
                path.join(
                  OUT,
                  ID,
                  `${fixture.name}-${viewport.id}-${size.replace('%', '')}-${kind}.json`,
                ),
                JSON.stringify(
                  { fixture: fixture.name, viewport: viewport.id, size, page: kind, route, reads },
                  null,
                  1,
                ),
              );
            }
        } finally {
          await context.close();
        }
      }
    } finally {
      await app.stop();
      writeFileSync(
        path.join(OUT, ID, `${fixture.name}.tsv`),
        rows.length ? `${rows.join('\n')}\n` : '',
      );
    }
  });
}
