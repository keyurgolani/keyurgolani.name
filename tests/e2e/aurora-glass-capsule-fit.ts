import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Row 150, Aurora Glass (the coordinator's ruling): at 1024 at 1x the capsule held the name, four
// destinations, the Index, the call and Pause in less room than they need, so the name and the call
// ellipsized, on Accessible Reading ("Ro…", "Co…") and on Humanist UI ("Rowan V…", "Contact ti…"),
// and a reader lost part of each. Now the name and the call never split a word and are never cut, and
// the capsule folds its destinations into the Index while the chrome, in its text's em, is narrower
// than what the capsule needs beside the ornament (FOLD_EM, styles.css). The pins, on one pack each
// (a spec file per pack: each is a server of its own):
//   - at 1024 at 1x, the destinations fold into the Index, and nothing in the capsule is cut;
//   - at the widths just below and just above the fold, the chrome's em either side of FOLD_EM, the
//     destinations fold and show, and nothing in the capsule is cut either way;
//   - at 1024 at 1x the Index is Tab's next stop after the name, as the Menu is at 2x, it lists Work,
//     Writing, Record and About in that order, and its keyboard path, in and back, is the one at 2x;
//   - at 320 (the phone regression of the fix: on Humanist UI the Menu ran 13.4px past the capsule,
//     on Accessible Reading 62.6px, over the Appearance pill), nothing in the capsule is cut, runs
//     past it or into the ornament, and the Menu shows its word;
//   - just below and just above the fold the name starts where it does at 1024, the capsule at the
//     header's inset and filling its row to the ornament, as at 1024 (the coordinator's look ruling:
//     on Accessible Reading the fold fell in the wide layout, where the folded capsule shrank to its
//     content and sat off the header's start).
// "Cut" is any of the name, a destination, the Index, the call or its text whose own box holds less
// than its content (a tolerance of 1px, as the harness's reflow probe), that runs past the capsule's
// box, or a word of the name or the call laid out over two lines; and a capsule that runs into the
// ornament. Each just-above read logs what the capsule needs beside the ornament, measured with every
// track at its content's width and the destinations shown, in the chrome's em.

/** The chrome's em under which the destinations fold into the Index (styles.css, row 150). */
export const FOLD_EM = 64;

export type Pack = 'accessible-reading' | 'humanist-ui';

/** One of the quality cells' tuples per pack: Accessible Reading's red cell, and the default pack. */
const TUPLE: Record<Pack, { language: string; scheme: string; family: RegExp }> = {
  'accessible-reading': { language: 'minimal-flat', scheme: 'control-room', family: /Verdana/i },
  'humanist-ui': { language: 'platform-neutral', scheme: 'warm-parchment', family: /Trebuchet/i },
};

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

export function capsuleFitOptions(pack: Pack) {
  const { language, scheme } = TUPLE[pack];
  return {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
      .replace(/designLanguage: .*/, `designLanguage: ${language}`)
      .replace(/colorScheme: .*/, `colorScheme: ${scheme}`)
      .replace(/typography: .*/, `typography: ${pack}`)
      .replace(/displayMode: .*/, 'displayMode: dark'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  };
}

const annotation = [{ type: 'route', description: '/' }];

const twoFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** The header's read: the chrome's em, whether the destinations show, and what's cut. */
export function readHeader(page: Page) {
  return page.evaluate(() => {
    const chrome = document.querySelector('.ag-chrome')!;
    const capsule = chrome.querySelector('.ag-capsule')!;
    const ornament = chrome.querySelector('.ag-ornament')!;
    const shown = (el: Element) =>
      [...el.getClientRects()].some((r) => r.width > 0 && r.height > 0);
    const em = parseFloat(getComputedStyle(chrome).fontSize);
    const c = capsule.getBoundingClientRect();
    const o = ornament.getBoundingClientRect();
    const cut: string[] = [];
    const label = (el: Element) =>
      `${el.className.toString().split(' ')[0] || el.localName} "${(el.textContent ?? '').trim()}"`;
    const items = [
      ...capsule.querySelectorAll(
        '.ag-capsule__name, .ag-capsule__dest a, .ag-capsule__index, .ag-capsule__cta, .ag-capsule__cta-text',
      ),
    ].filter(shown);
    for (const el of items) {
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
        cut.push(
          `${label(el)}: ${el.scrollWidth}x${el.scrollHeight} of content in ${el.clientWidth}x${el.clientHeight}`,
        );
      const r = el.getBoundingClientRect();
      if (r.left < c.left - 1 || r.right > c.right + 1)
        cut.push(
          `${label(el)}: ${r.left.toFixed(1)}-${r.right.toFixed(1)} past the capsule's ${c.left.toFixed(1)}-${c.right.toFixed(1)}`,
        );
    }
    // A word of the name or the call over two lines: its own range has a box on each.
    for (const el of capsule.querySelectorAll('.ag-capsule__name, .ag-capsule__cta-text')) {
      if (!shown(el)) continue;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.nodeValue ?? '';
        // A word runs between spaces; a hyphen ends one, as a line may break after it.
        for (const m of value.matchAll(/[^\s-]+-?/g)) {
          const range = document.createRange();
          range.setStart(node, m.index!);
          range.setEnd(node, m.index! + m[0].length);
          const lines = new Set(
            [...range.getClientRects()]
              .filter((r) => r.width > 0 && r.height > 0)
              .map((r) => Math.round(r.top)),
          );
          if (lines.size > 1) cut.push(`${label(el)}: "${m[0]}" is split over ${lines.size} lines`);
        }
      }
    }
    const rtl = getComputedStyle(chrome).direction === 'rtl';
    // Only on one line: on two (row 150's (iii)), the ornament takes a line of its own below the
    // capsule, and the inline spans of the two lines overlap without either running into the other
    // (the coordinator's (c): AR at 320, the capsule 18-302 on the first line, the ornament 178-302
    // on the second).
    const oneLine = o.height > 0 && o.top < c.bottom - 1;
    if (oneLine && (rtl ? c.left < o.right - 1 : c.right > o.left + 1))
      cut.push(
        `the capsule, ${c.left.toFixed(1)}-${c.right.toFixed(1)}, runs into the ornament, ${o.left.toFixed(1)}-${o.right.toFixed(1)}`,
      );
    const dest = capsule.querySelector('.ag-capsule__dest');
    return {
      chromeEm: chrome.getBoundingClientRect().width / em,
      family: getComputedStyle(capsule.querySelector('.ag-capsule__name')!).fontFamily,
      folded: !dest || !shown(dest),
      index:
        (
          capsule.querySelector('.ag-capsule__index--live') as HTMLElement | null
        )?.innerText.trim() ?? '',
      cut,
    };
  });
}

/**
 * What the capsule needs beside the ornament, in px and the chrome's em: every track at its
 * content's width and the destinations shown, the capsule's start to the ornament's end, and the
 * gaps of the tracks before the capsule's. The page's styles are back as they were after.
 */
function readNeed(page: Page) {
  return page.evaluate(() => {
    const chrome = document.querySelector<HTMLElement>('.ag-chrome')!;
    const capsule = chrome.querySelector('.ag-capsule')!;
    const ornament = chrome.querySelector('.ag-ornament')!;
    const style = document.createElement('style');
    style.textContent =
      "[data-variant='aurora-glass'] .ag-chrome { grid-template-columns: repeat(3, max-content) !important; }" +
      "[data-variant='aurora-glass'] .ag-capsule .ag-capsule__dest { display: flex !important; }" +
      // Its content's width, not the row the capsule fills above 75rem under 70em (row 150).
      "[data-variant='aurora-glass'] .ag-capsule { inline-size: auto !important; max-inline-size: none !important; margin-inline-start: 0 !important; }" +
      // Under 75rem the chrome is a flex line and the capsule grows to fill it, so read as it was the
      // need was the chrome's own width (row 150, the coordinator's (e)): one line, each at its content.
      "[data-variant='aurora-glass'] .ag-chrome { flex-wrap: nowrap !important; }" +
      "[data-variant='aurora-glass'] .ag-capsule { flex: none !important; inline-size: max-content !important; min-inline-size: 0 !important; }" +
      "[data-variant='aurora-glass'] .ag-ornament { flex: none !important; margin-inline-start: 0 !important; }";
    document.head.append(style);
    try {
      const s = getComputedStyle(chrome);
      const before = Number(getComputedStyle(capsule).gridColumnStart) - 1 || 0;
      const c = capsule.getBoundingClientRect();
      const o = ornament.getBoundingClientRect();
      const px =
        Math.max(c.right, o.right) - Math.min(c.left, o.left) + before * parseFloat(s.columnGap);
      return { px, em: px / parseFloat(s.fontSize) };
    } finally {
      style.remove();
    }
  });
}

/**
 * Where the capsule sits in the header: the name's start from the chrome's start, and the gap
 * from the capsule's end to what follows it in the row, the ornament if it shows or else the
 * chrome's end, less the chrome's column gap when it's the ornament. In the inline direction.
 */
function readAnchor(page: Page) {
  return page.evaluate(() => {
    const chrome = document.querySelector('.ag-chrome')!;
    const capsule = chrome.querySelector('.ag-capsule')!;
    const name = capsule.querySelector('.ag-capsule__name')!;
    const ornament = chrome.querySelector('.ag-ornament')!;
    const rtl = getComputedStyle(chrome).direction === 'rtl';
    const start = (r: DOMRect) => (rtl ? -r.right : r.left);
    const end = (r: DOMRect) => (rtl ? -r.left : r.right);
    const h = chrome.getBoundingClientRect();
    const c = capsule.getBoundingClientRect();
    const o = ornament.getBoundingClientRect();
    const orn = o.width > 0 && o.height > 0;
    const row = getComputedStyle(capsule.parentElement!);
    const gap = parseFloat(row.columnGap) || 0;
    const cs = getComputedStyle(capsule);
    return {
      nameStart: start(name.getBoundingClientRect()) - start(h),
      nameInset:
        parseFloat(rtl ? cs.borderRightWidth : cs.borderLeftWidth) +
        parseFloat(cs.paddingInlineStart),
      capsuleStart: start(c) - start(h),
      endGap: orn ? start(o) - end(c) - gap : end(h) - end(c),
    };
  });
}

/** The chrome's em at a viewport width (the page at 1x). */
async function chromeEmAt(page: Page, width: number) {
  await page.setViewportSize({ width, height: 768 });
  await twoFrames(page);
  return page.evaluate(() => {
    const chrome = document.querySelector('.ag-chrome')!;
    return chrome.getBoundingClientRect().width / parseFloat(getComputedStyle(chrome).fontSize);
  });
}

/** The narrowest viewport, between 1024 and 1600, whose chrome is at least `em` wide in its own em. */
async function widthFor(page: Page, em: number) {
  let [lo, hi] = [1024, 1600];
  expect(await chromeEmAt(page, hi), `the chrome reaches ${em}em by ${hi}`).toBeGreaterThanOrEqual(
    em,
  );
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await chromeEmAt(page, mid)) >= em) hi = mid;
    else lo = mid;
  }
  return hi;
}

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 768 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.ag[data-ag-live]')).toHaveCount(1);
  await twoFrames(page);
}

/** The keyboard path at the current size: from the name, the next stop, then in the Index and back. */
async function indexPath(page: Page) {
  const name = page.locator('.ag-capsule__name');
  const button = page.locator('.ag-capsule__index--live');
  await name.focus();
  await page.keyboard.press('Tab');
  const next = await page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.className.toString().split(' ')[0] ?? '',
  );
  await expect(button, 'the Index is the next stop after the name').toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.locator('.ag-index');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'dialog');
  const words = (await dialog.locator('.ag-index__dest').allInnerTexts()).map((w) => w.trim());
  const stops: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el
          ? `${el.className.toString().split(' ')[0] || el.localName} ${el.innerText.trim()}`
          : '';
      }),
    );
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button, 'Escape gives focus back to the button').toBeFocused();
  return { next, words, stops };
}

export function capsuleFit(pack: Pack) {
  test(
    `at 1024 at 1x on ${pack}, the destinations fold into the Index, and nothing in the capsule is cut`,
    { annotation },
    async ({ page }) => {
      await open(page, 1024);
      const read = await readHeader(page);
      expect(read.family, `the ${pack} face`).toMatch(TUPLE[pack].family);
      const need = await readNeed(page);
      console.log(
        `r150 ${pack} 1024: chrome ${read.chromeEm.toFixed(2)}em, need ${need.px.toFixed(1)}px = ${need.em.toFixed(2)}em`,
      );
      expect(read.chromeEm, `the chrome at 1024 is under ${FOLD_EM}em`).toBeLessThan(FOLD_EM);
      expect(read.folded, 'the destinations fold into the Index').toBe(true);
      expect(read.index).toBe('Index');
      expect(read.cut, 'nothing in the capsule is cut').toEqual([]);
    },
  );

  test(
    `on ${pack}, just below the fold the destinations fold, just above they show, and nothing in the capsule is cut`,
    { annotation },
    async ({ page }) => {
      await open(page, 1024);
      const at = await widthFor(page, FOLD_EM);
      for (const [side, width] of [
        ['below', at - 8],
        ['above', at + 8],
      ] as const) {
        await page.setViewportSize({ width, height: 768 });
        await twoFrames(page);
        const read = await readHeader(page);
        const need = await readNeed(page);
        console.log(
          `r150 ${pack} ${side} ${width}: chrome ${read.chromeEm.toFixed(2)}em, folded ${read.folded}, need ${need.px.toFixed(1)}px = ${need.em.toFixed(2)}em`,
        );
        if (side === 'below') {
          expect(read.chromeEm, `${width} is just below ${FOLD_EM}em`).toBeLessThan(FOLD_EM);
          expect(read.chromeEm).toBeGreaterThan(FOLD_EM - 1);
          expect(read.folded, `${width}: the destinations fold`).toBe(true);
        } else {
          expect(read.chromeEm, `${width} is just above ${FOLD_EM}em`).toBeGreaterThan(FOLD_EM);
          expect(read.chromeEm).toBeLessThan(FOLD_EM + 1);
          expect(read.folded, `${width}: the destinations show`).toBe(false);
          expect(need.em, `the capsule's need is under ${FOLD_EM}em`).toBeLessThan(FOLD_EM);
        }
        expect(read.cut, `${width}: nothing in the capsule is cut`).toEqual([]);
      }
    },
  );

  test(
    `on ${pack}, just below and just above the fold the name starts where it does at 1024, at the header's inset, and the capsule fills the row`,
    { annotation },
    async ({ page }) => {
      await open(page, 1024);
      const at1024 = await readAnchor(page);
      // At 1024 the name sits at the capsule's own inset from the header's start; the inset's padding
      // is fluid, so either side of the fold it's read at that width.
      expect(
        Math.abs(at1024.nameStart - at1024.nameInset),
        "1024: the name starts at the capsule's inset from the header's start",
      ).toBeLessThanOrEqual(1);
      const at = await widthFor(page, FOLD_EM);
      for (const [side, width] of [
        ['below', at - 8],
        ['above', at + 8],
      ] as const) {
        await page.setViewportSize({ width, height: 768 });
        await twoFrames(page);
        const read = await readAnchor(page);
        console.log(
          `r150 ${pack} anchor ${side} ${width}: name at ${read.nameStart.toFixed(1)}px, its inset ${read.nameInset.toFixed(1)}px (1024: ${at1024.nameStart.toFixed(1)}px of ${at1024.nameInset.toFixed(1)}px), capsule at ${read.capsuleStart.toFixed(1)}px, ${read.endGap.toFixed(1)}px short of the row's end`,
        );
        expect(
          Math.abs(read.nameStart - read.nameInset),
          `${width}: the name starts where it does at 1024, at the capsule's inset from the header's start`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(read.capsuleStart),
          `${width}: the capsule starts at the header's inset`,
        ).toBeLessThanOrEqual(1);
        expect(Math.abs(read.endGap), `${width}: the capsule fills the row`).toBeLessThanOrEqual(1);
      }
    },
  );

  test(
    `at 320 on ${pack}, nothing in the capsule is cut, nothing runs past it, and it doesn't run into the ornament`,
    { annotation },
    async ({ page }) => {
      await open(page, 320);
      await page.setViewportSize({ width: 320, height: 640 });
      await twoFrames(page);
      const read = await readHeader(page);
      console.log(
        `r150 ${pack} 320: chrome ${read.chromeEm.toFixed(2)}em, cut ${JSON.stringify(read.cut)}`,
      );
      expect(read.index).toBe('Menu');
      expect(read.cut, '320: nothing in the capsule is cut').toEqual([]);
    },
  );

  test(
    `at 1024 at 1x on ${pack}, the Index follows the name, lists Work, Writing, Record and About in order, and its keyboard path is the Menu's at 2x`,
    { annotation },
    async ({ page }) => {
      await open(page, 1024);
      const one = await indexPath(page);
      await page.evaluate(() =>
        document.documentElement.style.setProperty('font-size', '200%', 'important'),
      );
      await twoFrames(page);
      await expect(page.locator('.ag-capsule__index--live')).toHaveAccessibleName('Menu');
      const two = await indexPath(page);
      console.log(`r150 ${pack} index 1x ${JSON.stringify(one)} 2x ${JSON.stringify(two)}`);
      expect(one.words.slice(0, 4)).toEqual(['Work', 'Writing', 'Record', 'About']);
      expect(one.stops, 'the keyboard path in the Index at 1x is the one at 2x').toEqual(two.stops);
      expect(one.next).toBe(two.next);
    },
  );
}
