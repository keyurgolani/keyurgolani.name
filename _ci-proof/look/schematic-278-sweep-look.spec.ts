// Probe for Schematic with the root text at 200% on a phone (not for commit), run as a look on CI
// Linux at the base and the head: the overflow sweep's read (the overflow-sweep look's, as the
// earlier sweep ran it) on Schematic alone, on every contract fixture, at 320x568 and
// 390x844, home and the first routed work page. For each page: its scroll width against the window,
// every element past the window's right edge (chain, box, width styles, parent's layout, text,
// whether a fixed layer or a scroller holds it), and what spills past it from a box that stays
// inside: text runs, and the deepest box whose content reaches past it; and, for a right-to-left page,
// what starts left of the page's own left edge, with the scroll position and direction. One JSON a page and one TSV
// row a page to PROOF_LOOK_OUT; it never fails on what it finds.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { readPair } from '../../packages/schema/src/node';
import { resolvePortfolioView, routedSlugs } from '../../packages/schema/src/index';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { FALLBACK_ID, fixtureApp, UNDER_TEST } from '../variants/target';

const OUT = process.env.PROOF_LOOK_OUT ?? path.join('reports', 'schematic-278-sweep');
const [K, M] = (process.env.OVERFLOW_SWEEP_SHARD ?? '1/1').split('/').map(Number) as [
  number,
  number,
];
const VIEWPORTS = [
  { id: '320x568', width: 320, height: 568 },
  { id: '390x844', width: 390, height: 844 },
] as const;
const COMPOSITIONS = UNDER_TEST.filter(({ manifest }) => manifest.id === 'schematic')
  .slice()
  .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
  .filter((_, i) => i % M === K - 1);

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

/** Loads `route` as the quality reflow read does, sets the root text to 200%, and reads it. */
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
  return page.evaluate(() => {
    const html = document.documentElement;
    const edge = html.clientWidth;
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
    const round = (v: number) => Math.round(v * 10) / 10;
    const out: {
      chain: string;
      depth: number;
      held: string;
      box: number[];
      css: string;
      parent: string;
      text: string;
    }[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= edge + 0.5) continue;
      let held = '';
      for (let n: Element | null = el; n && n !== html; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.position === 'fixed') {
          held = `fixed ${name(n)}`;
          break;
        }
        if (n !== el && s.overflowX !== 'visible') {
          held = `${s.overflowX} ${name(n)} right ${round(n.getBoundingClientRect().right)}`;
          break;
        }
      }
      const s = getComputedStyle(el);
      const ps = el.parentElement ? getComputedStyle(el.parentElement) : null;
      out.push({
        chain: chain(el),
        depth: depth(el),
        held,
        box: [r.left, r.right, r.width, r.top, r.height].map(round),
        css: `${s.display} pos ${s.position} w ${s.width} minw ${s.minWidth} maxw ${s.maxWidth} ws ${s.whiteSpace} ow ${s.overflowWrap} wb ${s.wordBreak} flex ${s.flex} m ${s.marginLeft}/${s.marginRight} pad ${s.paddingLeft}/${s.paddingRight} tf ${s.transform}`,
        parent: ps
          ? `${name(el.parentElement)} ${ps.display} w ${ps.width} gtc ${ps.gridTemplateColumns.slice(0, 60)} gap ${ps.columnGap} pad ${ps.paddingLeft}/${ps.paddingRight} ov ${ps.overflowX}`
          : '',
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
      });
    }
    // Widest first; among the ones that reach as far, the outermost first.
    out.sort((a, b) => (b.box[1] ?? 0) - (a.box[1] ?? 0) || a.depth - b.depth);
    const clips = (el: Element) => {
      for (let n: Element | null = el; n && n !== html; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.position === 'fixed' || s.overflowX !== 'visible') return true;
      }
      return false;
    };
    const spill: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim() || clips(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const right = Math.max(...[...range.getClientRects()].map((r) => r.right), -1);
      if (right > edge + 0.5 && parent.getBoundingClientRect().right <= edge + 0.5)
        spill.push(
          `text "${node.textContent.trim().slice(0, 30)}" to ${round(right)} in ${chain(parent)} [${getComputedStyle(parent).display} ws ${getComputedStyle(parent).whiteSpace}]`,
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
      const after = getComputedStyle(el, '::after');
      const before = getComputedStyle(el, '::before');
      spill.push(
        `content of ${chain(el)} reach ${round(reach)} [${getComputedStyle(el).display}] before ${before.content.slice(0, 12)} after ${after.content.slice(0, 12)}`,
      );
    }
    // A right-to-left page overflows to its left: what starts left of the body's own left edge.
    const start = document.body.getBoundingClientRect().left;
    const leftward = [...document.querySelectorAll('body *')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.left < start - 0.5)
      .sort((a, b) => a.r.left - b.r.left)
      .slice(0, 20)
      .map(({ el, r }) => {
        const s = getComputedStyle(el);
        return `${chain(el)} left ${round(r.left)} right ${round(r.right)} w ${round(r.width)} [${s.display} ws ${s.whiteSpace} ow ${s.overflowWrap} dir ${s.direction}] "${(el.textContent ?? '').trim().slice(0, 30)}"`;
      });
    const unheld = out.filter((each) => !each.held);
    return {
      scroll: html.scrollWidth,
      client: edge,
      past: out.length,
      unheld: unheld.length,
      offenders: [...unheld.slice(0, 40), ...out.filter((each) => each.held).slice(0, 20)],
      spill: spill.slice(0, 30),
      leftward,
      start: round(start),
      scrollX: round(scrollX),
      dir: getComputedStyle(html).direction,
    };
  });
}

const cell = (value: string) => value.replace(/[\t\n]/g, ' ');

for (const variant of COMPOSITIONS) {
  const id = variant.manifest.id;
  const workBy = variant.manifest.routes.work === 'bespoke' ? id : FALLBACK_ID;
  for (const fixture of CONTRACT_FIXTURES) {
    test(`${id} on ${fixture.name}, at 320 and 390 with the root text at 200%: what runs past the window`, async ({
      browser,
    }, testInfo) => {
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
              const top: Offender | undefined = read.offenders.find((each) => !each.held);
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
                top ? cell(`${top.chain} right ${top.box[1]} w ${top.box[2]} "${top.text}"`) : '-',
              ].join('\t');
              rows.push(row);
              console.log(`schematic-278-sweep\t${row}`);
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
