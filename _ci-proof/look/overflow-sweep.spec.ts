// The read: every public composition on each contract fixture, at 320x568 and 390x844 on a phone
// with the root text at 200%, on its home and its first routed work page. For each page: its
// scroll width against the window, and everything whose right edge runs past the window, each
// with its chain, box, the styles that set its width, its parent's layout, its text, and whether a
// fixed layer or a scroller of an ancestor holds it. One JSON a page and one TSV row a page go to
// PROOF_LOOK_OUT. It reads and never fails on what it finds.
// Each test starts the composition's own server on its fixture, as the variants specs' projects
// do, so one file holds every composition. OVERFLOW_SWEEP_SHARD=k/m reads every m-th composition
// from the k-th (all of them when it's unset). The base side of a look run skips: head and base
// are the same commit here, so the head's read is the read.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { readPair } from '../../packages/schema/src/node';
import { resolvePortfolioView, routedSlugs } from '../../packages/schema/src/index';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { FALLBACK_ID, fixtureApp, UNDER_TEST } from '../variants/target';

const OUT = process.env.PROOF_LOOK_OUT ?? path.join('reports', 'overflow-sweep');
const BASE_SIDE = process.env.PROOF_LOOK_SIDE === 'base';
const [K, M] = (process.env.OVERFLOW_SWEEP_SHARD ?? '1/1').split('/').map(Number) as [
  number,
  number,
];
const VIEWPORTS = [
  { id: '320x568', width: 320, height: 568 },
  { id: '390x844', width: 390, height: 844 },
] as const;
const COMPOSITIONS = UNDER_TEST.filter(({ manifest }) => manifest.id !== FALLBACK_ID)
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
    const unheld = out.filter((each) => !each.held);
    return {
      scroll: html.scrollWidth,
      client: edge,
      past: out.length,
      unheld: unheld.length,
      offenders: [...unheld.slice(0, 40), ...out.filter((each) => each.held).slice(0, 20)],
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
      test.skip(BASE_SIDE, 'the head and the base are one commit: the head reads');
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
              console.log(`overflow-sweep\t${row}`);
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
