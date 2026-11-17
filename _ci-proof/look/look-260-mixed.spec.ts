// Look read for one CI run (laid in by the proof kit, never in a head's tree): Editorial Evidence on
// the mixed contract fixture at 390 by 844, mobile and touch, as the variants suite's mobile mode
// takes it. Before and after a whole-page shot: the masthead's box, tracks and gaps, every
// descendant's box with its borders and font, the elements above it, and the fonts in use. Out:
// $PROOF_LOOK_OUT/mixed.json, mixed-full.png (the whole page) and mixed-top.png (the top 120 px).
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

const read = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-variant]')!;
    const m = document.querySelector<HTMLElement>('.ee-masthead')!;
    const s = getComputedStyle(m);
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return [r1(r.left), r1(r.top), r1(r.width), r1(r.height)];
    };
    const name = (e: Element) => `${e.localName}${[...e.classList].map((k) => `.${k}`).join('')}`;
    const all = [...m.querySelectorAll('*')]
      .filter((c) => c.getClientRects().length > 0)
      .slice(0, 60)
      .map((c) => {
        const cs = getComputedStyle(c);
        return {
          el: name(c),
          box: box(c),
          display: cs.display,
          bt: cs.borderTopWidth,
          bb: cs.borderBottomWidth,
          ff: cs.fontFamily.slice(0, 60),
          fs: cs.fontSize,
          lh: cs.lineHeight,
          gap: cs.columnGap,
          rowGap: cs.rowGap,
          text: c.children.length === 0 ? (c.textContent ?? '').trim().slice(0, 30) : '',
        };
      });
    const fonts = [...document.fonts]
      .filter((f) => f.status === 'loaded')
      .map((f) => `${f.family} ${f.weight} ${f.style}`);
    return {
      vw: innerWidth,
      bar: root.style.getPropertyValue('--layout-ee-bar'),
      gutter: getComputedStyle(root).getPropertyValue('--layout-grid-gutter'),
      margin: getComputedStyle(root).getPropertyValue('--layout-grid-margin'),
      masthead: {
        box: box(m),
        cols: s.gridTemplateColumns,
        rows: s.gridTemplateRows,
        gap: s.columnGap,
        rowGap: s.rowGap,
        minH: s.minBlockSize,
      },
      all,
      fonts,
    };
  });

test('look 390 mobile: the mixed fixture masthead through Editorial Evidence', async ({ page }) => {
  test.setTimeout(120_000);
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(
    () => new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d))),
  );
  const before = await read(page);
  await page.screenshot({ path: path.join(out, 'mixed-full.png'), fullPage: true });
  const after = await read(page);
  await page.screenshot({
    path: path.join(out, 'mixed-top.png'),
    clip: { x: 0, y: 0, width: 390, height: 120 },
  });
  writeFileSync(path.join(out, 'mixed.json'), `${JSON.stringify({ before, after }, null, 2)}\n`);
});
