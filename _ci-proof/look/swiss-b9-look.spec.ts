// Probe for Swiss Signal's masthead and poster aside with the root text at 200% on a phone (not for
// commit), run as a look on CI Linux at the base and the head: on every contract fixture, home and the
// first routed work page, at 320x568 and 390x844, loaded as the quality reflow read loads a page. For each
// page: the page's scroll width against the window; the masthead (whether the Index sits under the name,
// the space above the name and below the Index, the name's box, its line count and whether its text runs
// past it); the poster line's aside (its text, size against its step, each word's line count and right
// edge against the poster line's). At 320, a shot of the window as loaded (the masthead and what follows)
// and one of the poster line, the masthead set in the flow so it covers nothing. One JSON a page, one TSV
// row a page and the shots to PROOF_LOOK_OUT; it never fails on what it finds.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { readPair } from '../../packages/schema/src/node';
import { resolvePortfolioView, routedSlugs } from '../../packages/schema/src/index';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { FALLBACK_ID, fixtureApp, UNDER_TEST } from '../variants/target';

const OUT = process.env.PROOF_LOOK_OUT ?? path.join('reports', 'swiss-b9-look');
const VIEWPORTS = [
  { id: '320x568', width: 320, height: 568 },
  { id: '390x844', width: 390, height: 844 },
] as const;
const SWISS = UNDER_TEST.find(({ manifest }) => manifest.id === 'swiss-signal')!;

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
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Loads `route` as the quality reflow read does, sets the root text to 200%, and reads it. */
async function readPage(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    document.documentElement.style.setProperty('font-size', '200%', 'important'),
  );
  await frames(page);
  await page.waitForTimeout(250);
  await frames(page);
  return page.evaluate(() => {
    const html = document.documentElement;
    const round = (v: number) => Math.round(v * 100) / 100;
    const tops = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return [
        ...new Set(
          [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
        ),
      ].sort((a, b) => a - b);
    };
    const textRight = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return round(Math.max(-1, ...[...range.getClientRects()].map((r) => r.right)));
    };
    const mast = document.querySelector('.ss-masthead');
    const nameEl = document.querySelector('.ss-masthead__name');
    const buttonEl =
      document.querySelector('.ss[data-ss-live] .ss-index__button') ??
      document.querySelector('.ss-index__link');
    let masthead: Record<string, unknown> | null = null;
    if (mast && nameEl && buttonEl) {
      const box = mast.getBoundingClientRect();
      const rule = box.bottom - parseFloat(getComputedStyle(mast).borderBottomWidth);
      const name = nameEl.getBoundingClientRect();
      const button = buttonEl.getBoundingClientRect();
      const s = getComputedStyle(nameEl);
      masthead = {
        wrapped: button.top >= name.bottom - 0.5,
        aboveName: round(name.top - box.top),
        belowIndex: round(rule - button.bottom),
        aboveButton: round(button.top - box.top),
        height: round(box.height),
        name: {
          text: (nameEl.textContent ?? '').trim().replace(/\s+/g, ' '),
          left: round(name.left),
          right: round(name.right),
          width: round(name.width),
          textRight: textRight(nameEl),
          lines: tops(nameEl).length,
          minWidth: s.minWidth,
          maxWidth: s.maxWidth,
          fontSize: s.fontSize,
        },
        index: { left: round(button.left), right: round(button.right), top: round(button.top) },
      };
    }
    const asideEl = document.querySelector('.ss-poster__line .ss-poster__aside');
    let aside: Record<string, unknown> | null = null;
    if (asideEl) {
      const line = asideEl.closest('.ss-poster__line')!.getBoundingClientRect();
      const probe = document.createElement('span');
      probe.style.fontSize = 'var(--type-step-3)';
      asideEl.parentElement!.appendChild(probe);
      const step = parseFloat(getComputedStyle(probe).fontSize);
      probe.remove();
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(asideEl, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      const full = nodes.map((n) => n.data).join('');
      const at = (offset: number): [Text, number] => {
        let left = offset;
        for (const n of nodes) {
          if (left <= n.data.length) return [n, left];
          left -= n.data.length;
        }
        const last = nodes[nodes.length - 1]!;
        return [last, last.data.length];
      };
      const words = [...full.matchAll(/\S+/g)].map((m) => {
        const range = document.createRange();
        range.setStart(...at(m.index!));
        range.setEnd(...at(m.index! + m[0].length));
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        return {
          word: m[0],
          lines: new Set(rects.map((r) => Math.round(r.top))).size,
          right: round(Math.max(-1, ...rects.map((r) => r.right))),
        };
      });
      const size = parseFloat(getComputedStyle(asideEl).fontSize);
      aside = {
        text: full.trim(),
        size,
        step,
        ofStep: round(size / step),
        fit: getComputedStyle(asideEl).getPropertyValue('--layout-ss-aside-word').trim(),
        lineLeft: round(line.left),
        lineRight: round(line.right),
        past: words.filter((w) => w.right > line.right + 0.5).map((w) => w.word),
        broken: words.filter((w) => w.lines > 1).map((w) => w.word),
        words,
      };
    }
    return { scroll: html.scrollWidth, client: html.clientWidth, masthead, aside };
  });
}

const cell = (value: unknown) => String(value).replace(/[\t\n]/g, ' ');

for (const fixture of CONTRACT_FIXTURES) {
  test(`swiss-b9 on ${fixture.name}, at 320 and 390 with the root text at 200%: the masthead and the poster's aside`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(300_000);
    const id = SWISS.manifest.id;
    const work = firstWork(fixture);
    const pages = [
      { page: 'home', route: '/', renderedBy: id },
      ...(work
        ? [
            {
              page: 'work',
              route: work,
              renderedBy: SWISS.manifest.routes.work === 'bespoke' ? id : FALLBACK_ID,
            },
          ]
        : []),
    ];
    const app = await startApp({
      ...fixtureApp(fixture, SWISS),
      logFile: testInfo.outputPath('server.log'),
    });
    const rows: string[] = [];
    const dir = path.join(OUT, fixture.name);
    mkdirSync(dir, { recursive: true });
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
            const stem = `${fixture.name}-${viewport.id}-${kind}`;
            if (viewport.width === 320) {
              await page.screenshot({ path: path.join(dir, `${stem}-top.png`) });
              const line = page.locator('.ss-poster__line').first();
              if (await line.count()) {
                await page.addStyleTag({
                  content:
                    "[data-variant='swiss-signal'] .ss-masthead { position: static !important; }",
                });
                await frames(page);
                await line.screenshot({ path: path.join(dir, `${stem}-poster.png`) });
              }
            }
            writeFileSync(
              path.join(dir, `${stem}.json`),
              JSON.stringify(
                {
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
            const m = read.masthead as {
              wrapped: boolean;
              aboveName: number;
              belowIndex: number;
              aboveButton: number;
              name: { lines: number; right: number; textRight: number };
            } | null;
            const a = read.aside as {
              size: number;
              step: number;
              ofStep: number;
              fit: string;
              past: string[];
              broken: string[];
              text: string;
            } | null;
            const row = [
              fixture.name,
              viewport.id,
              kind,
              route,
              read.scroll,
              read.client,
              m ? (m.wrapped ? 'wrapped' : 'one-row') : '-',
              m ? `${m.aboveName}/${m.belowIndex}/${m.aboveButton}` : '-',
              m ? `${m.name.lines} lines, box ${m.name.right}, text ${m.name.textRight}` : '-',
              a ? `${a.size}/${a.step} (${a.ofStep}) fit ${a.fit}` : '-',
              a ? `past [${a.past.join(' ')}] broken [${a.broken.join(' ')}]` : '-',
              a ? a.text : '-',
            ]
              .map(cell)
              .join('\t');
            rows.push(row);
            console.log(`swiss-b9\t${renderedBy}\t${row}`);
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await app.stop();
      writeFileSync(
        path.join(dir, `${fixture.name}.tsv`),
        rows.length ? `${rows.join('\n')}\n` : '',
      );
    }
  });
}
