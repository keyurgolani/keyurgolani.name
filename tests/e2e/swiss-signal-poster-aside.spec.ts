import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { rootAt200 } from './swiss-signal-poster';

// Row 127, Swiss Signal: the poster line's aside, the italic parenthetical after the display type ("(software,
// 2022-2023)" on a case, "(Identity tagline)" on home), keeps its rem step when the reader's text is large. At 320
// with the root text at 200% (D's T2 look packet on 49d5a3854) the case's aside shows "(softwar" at its column's
// edge, under a whole title: its first word is wider than the column at that step. As the display type does, the
// aside fits its column: every word of it on one line, inside the poster line, and nothing that clips cuts it.
// Set as the quality cells' root-text condition sets it (the root's font-size at 200%, important). One language a
// file: each is a server of its own.

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

/** The aside's words (across its text nodes), each word's line count and right edge, and what clips it. */
const readAside = () => {
  const aside = document.querySelector('.ss-poster__line .ss-poster__aside')!;
  const line = aside.closest('.ss-poster__line')!.getBoundingClientRect();
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(aside, NodeFilter.SHOW_TEXT);
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
      right: Math.max(...rects.map((r) => r.right)),
    };
  });
  const box = aside.getBoundingClientRect();
  const clips: string[] = [];
  for (let a = aside.parentElement; a; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX === 'visible' && s.overflowY === 'visible' && s.clipPath === 'none') continue;
    const b = a.getBoundingClientRect();
    const cut = box.left < b.left - 0.5 || box.right > b.right + 0.5;
    if (cut)
      clips.push(
        `${a.localName}${[...a.classList].map((c) => `.${c}`).join('')} (${s.overflowX}/${s.overflowY}, ${Math.round(b.left)}-${Math.round(b.right)})`,
      );
  }
  return {
    text: full,
    fontSize: getComputedStyle(aside).fontSize,
    words,
    lineRight: line.right,
    asideRight: box.right,
    clips,
  };
};

const PAGES = [
  ["a case's aside", '/work/project-name'],
  ["the home hero's aside", '/'],
] as const;

for (const [width, height] of [
  [320, 568],
  [390, 844],
] as const)
  test.describe(`at ${width}`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });
    for (const [name, route] of PAGES)
      test(
        `at ${width} with the root text at 200%, ${name} fits its column: every word on one line, nothing clips it`,
        { annotation: [{ type: 'route', description: route }] },
        async ({ page }) => {
          await page.goto(route, { waitUntil: 'networkidle' });
          await expect(page.locator('.ss-poster__line .ss-poster__aside')).toHaveCount(1);
          await rootAt200(page);
          const read = await page.evaluate(readAside);
          expect(
            read.clips,
            `what clips "${read.text}" (at ${read.fontSize}): ${read.clips.join('; ') || 'nothing'}`,
          ).toEqual([]);
          for (const word of read.words) {
            expect(
              word.lines,
              `"${word.word}" of "${read.text}" (at ${read.fontSize}) stays on one line`,
            ).toBe(1);
            expect(
              word.right,
              `"${word.word}" ends inside the poster line (${read.lineRight})`,
            ).toBeLessThanOrEqual(read.lineRight + 0.5);
          }
        },
      );
  });
