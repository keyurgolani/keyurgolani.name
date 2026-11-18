// The read with each script disclosure clicked open: the overflow sweep's read, on the compositions
// whose pages carry [aria-expanded=false][aria-controls] controls (Editorial Evidence, Flux,
// Schematic and Swiss Signal), at 320x568 and 390x844 on a phone with the root text at 200%, on
// each contract fixture's home and first routed work page. Each page is read once with nothing
// opened, then once for each such control in turn: clicked, two frames, read, with the control's
// accessible name, whether it expanded, any dialog it opened, the scroll lock on the root and body,
// and any move of the page's scroll position; then closed again (Escape, else a second click) and
// checked back at aria-expanded=false before the next one. A control that won't close, or a page
// the click navigated away, is reloaded before the next control. One JSON a read and one TSV row a
// read go to PROOF_LOOK_OUT. It reads and never fails on what it finds.
// OVERFLOW_SWEEP_COMPOSITIONS (a comma list, default the four), OVERFLOW_SWEEP_FIXTURES and
// OVERFLOW_SWEEP_SHARD=k/m narrow it as in the sweep. The base side of a look run skips.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { readPair } from '../../packages/schema/src/node';
import { resolvePortfolioView, routedSlugs } from '../../packages/schema/src/index';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { FALLBACK_ID, fixtureApp, UNDER_TEST } from '../variants/target';

const OUT = process.env.PROOF_LOOK_OUT ?? path.join('reports', 'overflow-sweep-clicked');
const BASE_SIDE = process.env.PROOF_LOOK_SIDE === 'base';
const [K, M] = (process.env.OVERFLOW_SWEEP_SHARD ?? '1/1').split('/').map(Number) as [
  number,
  number,
];
const only = (name: string) => process.env[name]?.split(',').filter(Boolean);
const DISCLOSING = ['editorial-evidence', 'flux', 'schematic', 'swiss-signal'];
const ONLY_COMPOSITIONS = only('OVERFLOW_SWEEP_COMPOSITIONS') ?? DISCLOSING;
const ONLY_FIXTURES = only('OVERFLOW_SWEEP_FIXTURES');
const VIEWPORTS = [
  { id: '320x568', width: 320, height: 568 },
  { id: '390x844', width: 390, height: 844 },
] as const;
const COMPOSITIONS = UNDER_TEST.filter(({ manifest }) => manifest.id !== FALLBACK_ID)
  .filter(({ manifest }) => ONLY_COMPOSITIONS.includes(manifest.id))
  .slice()
  .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
  .filter((_, i) => i % M === K - 1);
const FIXTURES = CONTRACT_FIXTURES.filter(
  ({ name }) => !ONLY_FIXTURES || ONLY_FIXTURES.includes(name),
);
const CONTROL = '[aria-expanded="false"][aria-controls]';

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

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Loads `route` as the quality reflow read does, sets the root text to 200%, and settles. */
async function prepare(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    document.documentElement.style.setProperty('font-size', '200%', 'important'),
  );
  await frames(page);
  await page.waitForTimeout(250);
  await frames(page);
  // Each closed control gets an index, so it can be found again after the others open and close.
  return page.evaluate((selector) => {
    const all = [...document.querySelectorAll(selector)];
    all.forEach((el, i) => el.setAttribute('data-sweep-control', String(i)));
    return all.length;
  }, CONTROL);
}

/** Where the page sits and what holds it: its scroll position, the scroll lock, any dialog open. */
function stateOf(page: Page) {
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const dialogs = [
      ...document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]'),
    ].filter(shown);
    const modal = dialogs.some(
      (d) =>
        d.getAttribute('aria-modal') === 'true' ||
        (d instanceof HTMLDialogElement && d.matches(':modal')),
    );
    const html = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return {
      x: Math.round(window.scrollX * 10) / 10,
      y: Math.round(window.scrollY),
      dialog: dialogs.length ? (modal ? 'modal' : 'dialog') : '-',
      lock: `html ${html.overflowX}/${html.overflowY} body ${body.overflowX}/${body.overflowY}`,
      url: location.pathname,
    };
  });
}

/** The sweep's read of the page as it stands. */
function measure(page: Page) {
  return page.evaluate(() => {
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
    };
  });
}

/** The control's accessible name, as near as its attributes and text give it. */
function nameOf(page: Page, index: number) {
  return page.evaluate((i) => {
    const el = document.querySelector(`[data-sweep-control="${i}"]`);
    if (!el) return '(gone)';
    const by = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    return (el.getAttribute('aria-label') || by || el.textContent || el.getAttribute('title') || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 60);
  }, index);
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
    test(`${id} on ${fixture.name}, at 320 and 390 with the root text at 200% and each disclosure clicked open: what runs past the window`, async ({
      browser,
    }, testInfo) => {
      test.skip(BASE_SIDE, 'the sweep reads the head');
      test.setTimeout(600_000);
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
              const count = await prepare(page, route);
              const snapshot = async () => ({
                read: await measure(page),
                after: await stateOf(page),
              });
              const record = (
                control: string,
                label: string,
                opened: string,
                before: Awaited<ReturnType<typeof stateOf>>,
                { read, after }: Awaited<ReturnType<typeof snapshot>>,
                closed: string,
              ) => {
                const moved =
                  before.x !== after.x || before.y !== after.y
                    ? `x ${before.x} to ${after.x}, y ${before.y} to ${after.y}`
                    : '-';
                writeFileSync(
                  path.join(OUT, id, `${fixture.name}-${viewport.id}-${kind}-${control}.json`),
                  JSON.stringify(
                    {
                      composition: id,
                      fixture: fixture.name,
                      viewport: viewport.id,
                      page: kind,
                      route,
                      renderedBy,
                      control,
                      label,
                      opened,
                      before,
                      after,
                      closed,
                      ...read,
                    },
                    null,
                    1,
                  ),
                );
                // The first sixteen columns are the second sweep's, so its readers still read them.
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
                  control,
                  cell(label),
                  opened,
                  after.dialog,
                  cell(after.lock),
                  moved,
                  closed,
                ].join('\t');
                rows.push(row);
                console.log(`overflow-sweep-clicked\t${row}`);
              };
              // The page as it loads, nothing opened.
              const loaded = await stateOf(page);
              record('-', '-', '-', loaded, await snapshot(), '-');
              for (let i = 0; i < count; i += 1) {
                const control = page.locator(`[data-sweep-control="${i}"]`);
                const label = await nameOf(page, i);
                const before = await stateOf(page);
                if (!(await control.count()) || !(await control.isVisible())) {
                  record(String(i), label, 'not shown', before, await snapshot(), '-');
                  continue;
                }
                const clicked = await control
                  .click({ timeout: 5_000 })
                  .then(() => '')
                  .catch((error: Error) => `click failed: ${error.message.split('\n')[0]}`);
                await frames(page);
                const opened =
                  clicked ||
                  `aria-expanded ${(await control.getAttribute('aria-expanded')) ?? '-'}`;
                // The read with it open.
                const open = await snapshot();
                // Then closed again: Escape, else a second click; a page the click navigated away,
                // or a control that won't close, is reloaded before the next one.
                let closed = 'navigated';
                if (open.after.url === before.url) {
                  await page.keyboard.press('Escape');
                  await frames(page);
                  closed = 'escape';
                  if ((await control.getAttribute('aria-expanded')) !== 'false') {
                    await control.click({ timeout: 5_000 }).catch(() => undefined);
                    await frames(page);
                    closed =
                      (await control.getAttribute('aria-expanded')) === 'false'
                        ? 'click'
                        : 'no, reloaded';
                  }
                }
                record(String(i), label, opened, before, open, closed);
                if (closed === 'navigated' || closed === 'no, reloaded') await prepare(page, route);
              }
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
