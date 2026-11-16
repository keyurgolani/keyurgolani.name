// Probe for Swiss Signal at 320 and 390 with the root text at 200% (not for commit), run as a look on
// CI Linux: what runs past the page's right edge on home and a case, the platform font each poster
// part paints with, each poster word's width per letter at its size, and the same reads under
// candidate fits. JSON to $PROOF_LOOK_OUT and to stdout ("probe224 "), a PNG of the poster line.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'swiss-signal')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});
test.describe.configure({ timeout: 180_000 });

const ASIDE = (k: number) => `@container (max-width: 14rem) {
  [data-variant='swiss-signal'] .ss-poster__line .ss-poster__aside {
    font-size: max(var(--type-body-font-size), min(var(--type-step-3), calc(100cqi / (var(--layout-ss-aside-word, 8) * ${k})))) !important;
  }
}`;
const DISPLAY = (k: number) => `@container (max-width: 14rem) {
  [data-variant='swiss-signal'] .ss-poster__line:not([data-length='long']) .ss-poster__text {
    font-size: max(var(--type-body-font-size), min(var(--type-step-7), calc(100cqi / (var(--layout-ss-word, 8) * ${k})))) !important;
  }
  [data-variant='swiss-signal'] :is(.ss-poster__line[data-length='medium'], .ss-poster__line[data-word='long']) .ss-poster__text {
    font-size: max(var(--type-body-font-size), min(var(--type-step-6), calc(100cqi / (var(--layout-ss-word, 8) * ${k})))) !important;
  }
}`;
const ANYWHERE = `[data-variant='swiss-signal'] .ss-poster__line :is(.ss-poster__text, .ss-poster__aside) { overflow-wrap: anywhere !important; }`;
const CANDIDATES: Record<string, string> = {
  none: '',
  'aside-0.56': ASIDE(0.56),
  'aside-0.6': ASIDE(0.6),
  'display-0.9': DISPLAY(0.9),
  'aside-0.6+display-0.9': ASIDE(0.6) + DISPLAY(0.9),
  anywhere: ANYWHERE,
};

/** Everything past the page's right edge, the poster's words, and the root's scroll width. */
const readPage = () => {
  const client = document.documentElement.clientWidth;
  const past = [...document.querySelectorAll<HTMLElement>('body *')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => r.width > 0 && r.right > client + 0.01 && el.checkVisibility())
    .sort((a, b) => b.r.right - a.r.right)
    .slice(0, 12)
    .map(({ el, r }) => ({
      el: `${el.localName}${[...el.classList].map((c) => `.${c}`).join('')}`,
      right: Math.round(r.right * 100) / 100,
      width: Math.round(r.width * 100) / 100,
      font: getComputedStyle(el).fontSize,
      text: (el.textContent ?? '').trim().slice(0, 40),
    }));
  const line = document.querySelector('.ss-poster__line');
  const lineBox = line?.getBoundingClientRect();
  const words: object[] = [];
  for (const part of line
    ? [...line.querySelectorAll<HTMLElement>('.ss-poster__text, .ss-poster__aside')]
    : []) {
    const size = parseFloat(getComputedStyle(part).fontSize);
    const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      for (const m of n.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(n, m.index!);
        range.setEnd(n, m.index! + m[0].length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        const width = rects.reduce((sum, r) => sum + r.width, 0);
        words.push({
          part: part.classList.contains('ss-poster__aside') ? 'aside' : 'text',
          word: m[0],
          size,
          lines: new Set(rects.map((r) => Math.round(r.top))).size,
          right: Math.round(Math.max(...rects.map((r) => r.right)) * 100) / 100,
          emPerLetter: Math.round((width / (m[0].length * size)) * 1000) / 1000,
        });
      }
    }
  }
  return {
    client,
    scroll: document.documentElement.scrollWidth,
    line: lineBox ? { left: lineBox.left, right: lineBox.right, width: lineBox.width } : null,
    vars: line ? (line as HTMLElement).getAttribute('style') : null,
    words,
    past,
  };
};

async function fonts(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  await cdp.send('CSS.enable');
  const out: Record<string, unknown> = {};
  for (const selector of [
    '.ss-poster__line .ss-poster__text',
    '.ss-poster__line .ss-poster__aside',
  ]) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) continue;
    out[selector] = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
  }
  await cdp.detach();
  return out;
}

for (const width of [320, 390] as const)
  for (const [name, route] of [
    ['home', '/'],
    ['case', '/work/project-name'],
  ] as const)
    test(`probe224 ${name} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.locator('.ss-poster__line')).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() =>
        document.documentElement.style.setProperty('font-size', '200%', 'important'),
      );
      const frames = () =>
        page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
      await frames();
      const result: Record<string, unknown> = { fonts: await fonts(page) };
      for (const [candidate, css] of Object.entries(CANDIDATES)) {
        await page.evaluate((css) => {
          let style = document.getElementById('probe224');
          if (!style) {
            style = document.createElement('style');
            style.id = 'probe224';
            document.head.append(style);
          }
          style.textContent = css;
        }, css);
        await frames();
        result[candidate] = await page.evaluate(readPage);
        if (candidate === 'none')
          await page
            .locator('.ss-poster__line')
            .screenshot({ path: path.join(OUT, `${name}-${width}.png`), animations: 'disabled' });
      }
      const json = JSON.stringify(result);
      writeFileSync(path.join(OUT, `${name}-${width}.json`), json);
      console.log(`probe224 ${name} ${width} ${json}`);
    });
