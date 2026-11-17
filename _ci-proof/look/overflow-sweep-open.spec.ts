// The read with every fold open: the overflow sweep's read, after every <details> in the document
// is opened (a grouped one first loses its name, so opening one doesn't close the others) and two
// frames pass. Each row adds how many folds were opened and how many [aria-expanded=false]
// controls of a region stay closed, which this read leaves as they are.
// The read: every public composition on each contract fixture, at 320x568 and 390x844 on a phone
// with the root text at 200%, on its home and its first routed work page. For each page: its
// scroll width against the window, its direction, its scroll position and how far it scrolls each
// way, and everything past either edge of the window: whose right edge runs past the right edge,
// and whose left edge starts left of the left edge, as a right-to-left page overflows. Each one
// with its chain, box, the styles that set its width, its parent's layout, its text, and whether a
// fixed layer or a scroller of an ancestor holds it. Then what spills past the right edge from a
// box that stays inside: text runs, and the deepest box whose content reaches past it. One JSON a
// page and one TSV row a page go to PROOF_LOOK_OUT. It reads and never fails on what it finds.
// Each test starts the composition's own server on its fixture, as the variants specs' projects
// do, so one file holds every composition. OVERFLOW_SWEEP_SHARD=k/m reads every m-th composition
// from the k-th (all of them when it's unset); OVERFLOW_SWEEP_COMPOSITIONS and
// OVERFLOW_SWEEP_FIXTURES, comma lists, narrow it (all when unset). The base side of a look run
// skips: the sweep reads the head.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { readPair } from '../../packages/schema/src/node';
import { resolvePortfolioView, routedSlugs } from '../../packages/schema/src/index';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { FALLBACK_ID, fixtureApp, UNDER_TEST } from '../variants/target';

const OUT = process.env.PROOF_LOOK_OUT ?? path.join('reports', 'overflow-sweep-open');
const BASE_SIDE = process.env.PROOF_LOOK_SIDE === 'base';
const [K, M] = (process.env.OVERFLOW_SWEEP_SHARD ?? '1/1').split('/').map(Number) as [
  number,
  number,
];
const only = (name: string) => process.env[name]?.split(',').filter(Boolean);
const ONLY_COMPOSITIONS = only('OVERFLOW_SWEEP_COMPOSITIONS');
const ONLY_FIXTURES = only('OVERFLOW_SWEEP_FIXTURES');
const VIEWPORTS = [
  { id: '320x568', width: 320, height: 568 },
  { id: '390x844', width: 390, height: 844 },
] as const;
const COMPOSITIONS = UNDER_TEST.filter(({ manifest }) => manifest.id !== FALLBACK_ID)
  .slice()
  .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
  .filter((_, i) => i % M === K - 1)
  .filter(({ manifest }) => !ONLY_COMPOSITIONS || ONLY_COMPOSITIONS.includes(manifest.id));
const FIXTURES = CONTRACT_FIXTURES.filter(
  ({ name }) => !ONLY_FIXTURES || ONLY_FIXTURES.includes(name),
);

/** The fixture's first routed work page, or null when it routes none. */
function firstWork(fixture: (typeof CONTRACT_FIXTURES)[number]): string | null {
  const read = readPair(fixture.files);
  if (!read.ok) return null;
  const routed = [
    ...routedSlugs(resolvePortfolioView(read.pair, {}, { mediaBase: '/media' })),
  ].sort();
  return routed.length ? `/work/${routed[0]}` : null;
}

interface Offender {
  chain: string;
  depth: number;
  held: string;
  box: number[];
  css: string;
  parent: string;
  text: string;
}

/** Loads `route` as the quality reflow read does, sets the root text to 200%, opens every fold, and reads it. */
async function readPage(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    document.documentElement.style.setProperty('font-size', '200%', 'important'),
  );
  const frames = () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  await frames();
  await page.waitForTimeout(250);
  await frames();
  const folds = await page.evaluate(() => {
    const all = [...document.querySelectorAll('details')];
    // A grouped fold (name) closes its group's others as it opens: ungroup them first.
    let named = 0;
    for (const fold of all) {
      if (fold.hasAttribute('name')) {
        fold.removeAttribute('name');
        named += 1;
      }
    }
    const closed = all.filter((fold) => !fold.open).length;
    for (const fold of all) fold.open = true;
    return { details: all.length, opened: closed, named };
  });
  await frames();
  const read = await page.evaluate(() => {
    const html = document.documentElement;
    const edge = html.clientWidth;
    const round = (v: number) => Math.round(v * 10) / 10;
    const name = (el: Element | null) =>
      el
        ? `${el.localName}${el.id ? `#${el.id}` : ''}${[...el.classList]
            .slice(0, 3)
            .map((c) => `.${c}`)
            .join('')}`
        : '';
    const chain = (el: Element) => {
      const parts: string[] = [];
      for (let n: Element | null = el; n && n !== html && parts.length < 7; n = n.parentElement)
        parts.unshift(name(n));
      return parts.join(' > ');
    };
    const depth = (el: Element) => {
      let d = 0;
      for (let n: Element | null = el; n && n !== html; n = n.parentElement) d += 1;
      return d;
    };
    /** What holds `el` in: a fixed layer, or an ancestor that clips or scrolls along x. */
    const heldBy = (el: Element) => {
      for (let n: Element | null = el; n && n !== html; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.position === 'fixed') return `fixed ${name(n)}`;
        if (n !== el && s.overflowX !== 'visible') {
          const b = n.getBoundingClientRect();
          return `${s.overflowX} ${name(n)} left ${round(b.left)} right ${round(b.right)}`;
        }
      }
      return '';
    };
    const describe = (el: Element, r: DOMRect) => {
      const s = getComputedStyle(el);
      const ps = el.parentElement ? getComputedStyle(el.parentElement) : null;
      return {
        chain: chain(el),
        depth: depth(el),
        held: heldBy(el),
        box: [r.left, r.right, r.width, r.top, r.height].map(round),
        css: `${s.display} pos ${s.position} dir ${s.direction} w ${s.width} minw ${s.minWidth} maxw ${s.maxWidth} ws ${s.whiteSpace} ow ${s.overflowWrap} wb ${s.wordBreak} flex ${s.flex} m ${s.marginLeft}/${s.marginRight} pad ${s.paddingLeft}/${s.paddingRight} tf ${s.transform}`,
        parent: ps
          ? `${name(el.parentElement)} ${ps.display} w ${ps.width} gtc ${ps.gridTemplateColumns.slice(0, 60)} gap ${ps.columnGap} pad ${ps.paddingLeft}/${ps.paddingRight} ov ${ps.overflowX} jc ${ps.justifyContent}`
          : '',
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
      };
    };
    const right: ReturnType<typeof describe>[] = [];
    const left: ReturnType<typeof describe>[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > edge + 0.5) right.push(describe(el, r));
      if (r.left < -0.5) left.push(describe(el, r));
    }
    // Widest first; among the ones that reach as far, the outermost first.
    right.sort((a, b) => (b.box[1] ?? 0) - (a.box[1] ?? 0) || a.depth - b.depth);
    left.sort((a, b) => (a.box[0] ?? 0) - (b.box[0] ?? 0) || a.depth - b.depth);
    const clips = (el: Element) =>
      getComputedStyle(el).overflowX !== 'visible' || heldBy(el) !== '';
    const spill: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim() || clips(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const reach = Math.max(...[...range.getClientRects()].map((r) => r.right), -1);
      if (reach > edge + 0.5 && parent.getBoundingClientRect().right <= edge + 0.5)
        spill.push(
          `text "${node.textContent.trim().slice(0, 30)}" to ${round(reach)} in ${chain(parent)} [${getComputedStyle(parent).display} ws ${getComputedStyle(parent).whiteSpace}]`,
        );
    }
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right > edge + 0.5 || clips(el)) continue;
      const reach = r.left + el.scrollWidth;
      if (reach <= edge + 0.5) continue;
      if (
        [...el.children].some(
          (child) =>
            child.getBoundingClientRect().left + (child as HTMLElement).scrollWidth > edge + 0.5,
        )
      )
        continue;
      spill.push(
        `content of ${chain(el)} reach ${round(reach)} [${getComputedStyle(el).display}] before ${getComputedStyle(el, '::before').content.slice(0, 12)} after ${getComputedStyle(el, '::after').content.slice(0, 12)}`,
      );
    }
    const body = document.body.getBoundingClientRect();
    // How far the page scrolls each way: a right-to-left page's overflow is at negative scrollLeft.
    const scroller = document.scrollingElement ?? html;
    const at = scroller.scrollLeft;
    scroller.scrollLeft = -1e7;
    const least = scroller.scrollLeft;
    scroller.scrollLeft = 1e7;
    const most = scroller.scrollLeft;
    scroller.scrollLeft = at;
    const unheld = right.filter((each) => !each.held);
    const leftUnheld = left.filter((each) => !each.held);
    return {
      scroll: html.scrollWidth,
      client: edge,
      dir: getComputedStyle(html).direction,
      bodyDir: getComputedStyle(document.body).direction,
      scrollX: round(window.scrollX),
      scrollLeft: { at: round(at), least: round(least), most: round(most) },
      body: [body.left, body.right, body.width].map(round),
      past: right.length,
      unheld: unheld.length,
      offenders: [...unheld.slice(0, 40), ...right.filter((each) => each.held).slice(0, 20)],
      leftPast: left.length,
      leftUnheld: leftUnheld.length,
      leftOffenders: [...leftUnheld.slice(0, 40), ...left.filter((each) => each.held).slice(0, 20)],
      spill: spill.slice(0, 30),
      // Script disclosures this read leaves closed: a control of a region not yet expanded.
      ariaClosed: document.querySelectorAll('[aria-expanded="false"][aria-controls]').length,
    };
  });
  return { ...read, folds };
}

const cell = (value: string) => value.replace(/[\t\n]/g, ' ');
const brief = (top: Offender | undefined, side: 'left' | 'right') =>
  top
    ? cell(
        `${top.chain} ${side} ${side === 'left' ? top.box[0] : top.box[1]} w ${top.box[2]} "${top.text}"`,
      )
    : '-';

for (const variant of COMPOSITIONS) {
  const id = variant.manifest.id;
  const workBy = variant.manifest.routes.work === 'bespoke' ? id : FALLBACK_ID;
  for (const fixture of FIXTURES) {
    test(`${id} on ${fixture.name}, at 320 and 390 with the root text at 200% and every fold open: what runs past the window`, async ({
      browser,
    }, testInfo) => {
      test.skip(BASE_SIDE, 'the sweep reads the head');
      test.setTimeout(300_000);
      const work = firstWork(fixture);
      const pages = [
        { page: 'home', route: '/', renderedBy: id },
        ...(work ? [{ page: 'work', route: work, renderedBy: workBy }] : []),
      ];
      const app = await startApp({
        ...fixtureApp(fixture, variant),
        logFile: testInfo.outputPath('server.log'),
      });
      const rows: string[] = [];
      mkdirSync(path.join(OUT, id), { recursive: true });
      try {
        for (const viewport of VIEWPORTS) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            isMobile: true,
            hasTouch: true,
            baseURL: app.origin,
          });
          try {
            const page = await context.newPage();
            for (const { page: kind, route, renderedBy } of pages) {
              const read = await readPage(page, route);
              writeFileSync(
                path.join(OUT, id, `${fixture.name}-${viewport.id}-${kind}.json`),
                JSON.stringify(
                  {
                    composition: id,
                    fixture: fixture.name,
                    viewport: viewport.id,
                    page: kind,
                    route,
                    renderedBy,
                    ...read,
                  },
                  null,
                  1,
                ),
              );
              // The first eleven columns are the first sweep's and the next five the second's, so
              // their readers still read them; the last two count the folds opened and the
              // script disclosures left closed.
              const row = [
                id,
                fixture.name,
                viewport.id,
                kind,
                route,
                renderedBy,
                String(read.scroll),
                String(read.client),
                String(read.unheld),
                String(read.past),
                brief(
                  read.offenders.find((each) => !each.held),
                  'right',
                ),
                read.dir,
                String(read.scrollLeft.least),
                String(read.leftUnheld),
                brief(
                  read.leftOffenders.find((each) => !each.held),
                  'left',
                ),
                String(read.spill.length),
                String(read.folds.opened),
                String(read.ariaClosed),
              ].join('\t');
              rows.push(row);
              console.log(`overflow-sweep-open\t${row}`);
            }
          } finally {
            await context.close();
          }
        }
      } finally {
        await app.stop();
        writeFileSync(
          path.join(OUT, id, `${fixture.name}.tsv`),
          rows.length ? `${rows.join('\n')}\n` : '',
        );
      }
    });
  }
}
