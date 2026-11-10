import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// DIAGNOSTIC (evidence branch only, never landed): row 19 on CI Linux, where the root-text pin at 320 read the
// page 321 px wide on home and 342 px on a case (run 42657304415) while macOS fits. Swiss sets no web fonts, so
// its packs resolve to the system's families, and on Linux a wider one leaves something running past the
// screen. With the root text at 200%, home and a case, at 320 and 390 (the control): fails only when the page
// is wider than the screen, and its message carries the read (what runs past the edge, its box, its styles,
// whether its family is there, and the used family's widths), so the CI log names the offender.

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

const read = () => {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const cw = document.documentElement.clientWidth;
  const pathOf = (el: Element) => {
    const parts: string[] = [];
    for (
      let e: Element | null = el;
      e && e !== document.body && parts.length < 5;
      e = e.parentElement
    ) {
      const c = [...e.classList].slice(0, 2).join('.');
      parts.unshift(`${e.tagName.toLowerCase()}${c ? '.' + c : ''}`);
    }
    return parts.join('>');
  };
  const canvas = document.createElement('canvas').getContext('2d')!;
  const fontOf = (s: CSSStyleDeclaration) =>
    `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  const first = (family: string) => family.split(',')[0]!.trim();
  const styles = (el: Element) => {
    const s = getComputedStyle(el);
    return {
      display: s.display,
      ws: s.whiteSpace,
      wrap: s.overflowWrap,
      minW: s.minWidth,
      fs: s.fontSize,
      family: s.fontFamily.slice(0, 60),
      has: document.fonts.check(`${s.fontSize} ${first(s.fontFamily)}`),
    };
  };
  const boxes = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right <= cw + 0.5) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.position === 'fixed') continue;
    boxes.push({
      path: pathOf(el),
      left: r1(r.left),
      right: r1(r.right),
      w: r1(r.width),
      ...styles(el),
    });
  }
  boxes.sort((a, b) => b.right - a.right);
  const runs = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent ?? '').trim();
    if (!t || !n.parentElement) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const right = Math.max(0, ...[...range.getClientRects()].map((x) => x.right));
    if (right <= cw + 0.5) continue;
    const parent = n.parentElement;
    const s = getComputedStyle(parent);
    if (parent.closest('.ss-hidden') || s.visibility === 'hidden') continue;
    canvas.font = fontOf(s);
    const word = t
      .split(/\s+/)
      .reduce((a, b) => (canvas.measureText(b).width > canvas.measureText(a).width ? b : a));
    runs.push({
      path: pathOf(parent),
      right: r1(right),
      text: t.slice(0, 30),
      widestWord: word.slice(0, 20),
      wordPx: r1(canvas.measureText(word).width),
      boxW: r1(parent.getBoundingClientRect().width),
      ...styles(parent),
    });
  }
  runs.sort((a, b) => b.right - a.right);
  const body = getComputedStyle(document.querySelector('.ss')!);
  canvas.font = `400 32px ${body.fontFamily}`;
  const ref = {
    family: body.fontFamily.slice(0, 80),
    has: document.fonts.check(`32px ${first(body.fontFamily)}`),
    M10: r1(canvas.measureText('MMMMMMMMMM').width),
    a10: r1(canvas.measureText('abcdefghij').width),
  };
  const text = document.querySelector('.ss-poster__line .ss-poster__text');
  const poster = text
    ? (() => {
        const s = getComputedStyle(text);
        canvas.font = fontOf(s);
        const words = (text.textContent ?? '').trim().split(/\s+/);
        const grid = text.closest('.ss-poster__grid')!.getBoundingClientRect();
        return {
          text: (text.textContent ?? '').trim().slice(0, 30),
          fs: s.fontSize,
          widest: r1(
            Math.max(
              ...words.map(
                (w) =>
                  canvas.measureText(s.textTransform === 'uppercase' ? w.toUpperCase() : w).width,
              ),
            ),
          ),
          grid: r1(grid.width),
        };
      })()
    : null;
  const facts = [...document.querySelectorAll('.ss-case__facts .ss-dl > div')]
    .slice(0, 6)
    .map((row) => ({
      cols: getComputedStyle(row).gridTemplateColumns,
      right: r1(
        Math.max(
          ...[...row.querySelectorAll('dt, dd')].map((e) => e.getBoundingClientRect().right),
        ),
      ),
    }));
  return {
    scroll: document.documentElement.scrollWidth,
    client: cw,
    boxes: boxes.slice(0, 12),
    runs: runs.slice(0, 12),
    ref,
    poster,
    facts,
  };
};

for (const [width, height] of [
  [390, 844],
  [320, 568],
] as const)
  test.describe(`at ${width}`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });
    for (const [name, route] of [
      ['home', '/'],
      ['a case', '/work/project-name'],
    ] as const)
      test(
        `DIAGNOSTIC: with the root text at 200% at ${width}, what runs past the edge of ${name}`,
        { annotation: [{ type: 'route', description: route }] },
        async ({ page }, testInfo) => {
          await page.goto(route, { waitUntil: 'networkidle' });
          await expect(page.locator('.ss')).toHaveAttribute('data-ss-live', '');
          await page.evaluate(() =>
            document.documentElement.style.setProperty('font-size', '200%', 'important'),
          );
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          const got = await page.evaluate(read);
          await testInfo.attach('overflow-read.json', {
            body: JSON.stringify(got, null, 1),
            contentType: 'application/json',
          });
          expect(got.scroll, `the page fits: ${JSON.stringify(got)}`).toBeLessThanOrEqual(
            got.client,
          );
        },
      );
  });
