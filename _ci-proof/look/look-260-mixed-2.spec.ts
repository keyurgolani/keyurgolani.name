// Look read for one CI run (laid in by the proof kit, never in a head's tree): Editorial Evidence on
// the mixed contract fixture at 390 by 844, mobile and touch, as the variants suite's mobile mode
// takes it. From the first script on: every scroll of the window, with the call that made it when
// script did (scrollTo, scrollBy, scrollIntoView, focus, a scrollTop write), and the time. Then at
// rest: the scroll, the visual viewport, the focused element, the page's width, the boxes past the
// right edge, the address parts and row ends, before and after a whole-page shot. Out:
// $PROOF_LOOK_OUT/scroll.json, scroll-full.png and scroll-top.png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

const FIXTURE = contractFixture('mixed');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

declare global {
  interface Window {
    __scrolls?: { t: number; type: string; y: number; x: number; via: string }[];
  }
}

const INSTRUMENT = () => {
  const log: { t: number; type: string; y: number; x: number; via: string }[] = [];
  window.__scrolls = log;
  let via = '';
  const mark = (name: string) => {
    via = `${name} ${(new Error().stack ?? '').split('\n').slice(2, 6).join(' | ')}`;
    queueMicrotask(() => {
      via = '';
    });
  };
  for (const [owner, key] of [
    [window, 'scrollTo'],
    [window, 'scrollBy'],
    [window, 'scroll'],
    [Element.prototype, 'scrollIntoView'],
    [Element.prototype, 'scrollTo'],
    [Element.prototype, 'scrollBy'],
    [HTMLElement.prototype, 'focus'],
  ] as const) {
    const orig = (owner as unknown as Record<string, (...a: unknown[]) => unknown>)[key]!;
    (owner as unknown as Record<string, (...a: unknown[]) => unknown>)[key] = function (
      this: unknown,
      ...args: unknown[]
    ) {
      mark(`${key}(${JSON.stringify(args).slice(0, 80)})`);
      return orig.apply(this, args);
    };
  }
  const top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
  Object.defineProperty(Element.prototype, 'scrollTop', {
    get: top.get,
    set(this: Element, v: number) {
      mark(`scrollTop=${v} on ${this.localName}`);
      top.set!.call(this, v);
    },
    configurable: true,
  });
  addEventListener(
    'scroll',
    () =>
      log.push({ t: Math.round(performance.now()), type: 'scroll', y: scrollY, x: scrollX, via }),
    { capture: true, passive: true },
  );
  addEventListener('load', () =>
    log.push({ t: Math.round(performance.now()), type: 'load', y: scrollY, x: scrollX, via: '' }),
  );
};

const state = (page: Page) =>
  page.evaluate(() => {
    const html = document.documentElement;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const name = (e: Element) => `${e.localName}${[...e.classList].map((k) => `.${k}`).join('')}`;
    const room = html.clientWidth + 0.5;
    const past = [...document.body.querySelectorAll('*')]
      .filter((e) => e.getClientRects().length > 0)
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const up = e.parentElement;
        return r.right > room && (!up || up.getBoundingClientRect().right <= room);
      })
      .slice(0, 12)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return `${name(e)} [${r1(r.left)}..${r1(r.right)} top ${r1(r.top + scrollY)}]`;
      });
    const parts = [...document.querySelectorAll('.ee-url__part, .ee-row__end')]
      .filter((e) => e.getClientRects().length > 0)
      .slice(0, 20)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return `${name(e)} "${(e.textContent ?? '').trim().slice(0, 24)}" [${r1(r.left)}..${r1(r.right)} top ${r1(r.top + scrollY)} h ${r1(r.height)}] in ${e.parentElement ? name(e.parentElement) : ''}`;
      });
    const vv = window.visualViewport;
    return {
      scrollY,
      scrollX,
      docW: html.scrollWidth,
      clientW: html.clientWidth,
      docH: html.scrollHeight,
      vv: vv
        ? {
            offsetTop: vv.offsetTop,
            pageTop: vv.pageTop,
            scale: vv.scale,
            width: vv.width,
            height: vv.height,
          }
        : null,
      active: document.activeElement ? name(document.activeElement) : null,
      hash: location.hash,
      scrollPadding: getComputedStyle(html).scrollPaddingTop,
      past,
      parts,
      log: window.__scrolls ?? [],
    };
  });

test('look 390 mobile: what scrolls the mixed fixture through Editorial Evidence', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  await page.addInitScript(INSTRUMENT);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(
    () => new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d))),
  );
  const before = await state(page);
  await page.screenshot({ path: path.join(out, 'scroll-full.png'), fullPage: true });
  const after = await state(page);
  await page.screenshot({
    path: path.join(out, 'scroll-top.png'),
    clip: { x: 0, y: 0, width: 390, height: 120 },
  });
  writeFileSync(path.join(out, 'scroll.json'), `${JSON.stringify({ before, after }, null, 2)}\n`);
});
