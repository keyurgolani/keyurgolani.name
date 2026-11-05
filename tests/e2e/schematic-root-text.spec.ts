import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Schematic under 200% root text (WCAG 2.2 1.4.4, 1.4.10; the quality cells'
// root-text reflow, quality row 16): the cover's title block keeps its Index
// control whole inside the block under every stable design language, at
// 1024 and 1440, where the block is half the cover, and at 390 and 320, where
// it's a phone's. At 1024 and 1440 every box in the block stays inside it
// (within 0.5 px, for sub-pixel rounding) and no word of the block's own text
// breaks between its letters (a slash or an en dash may end a line), unless
// its element hyphenates (a language's hyphens: auto). A language's control padding is the button's own (1.5rem a
// side under material-3), so a quarter of the block can't hold it at 200%
// text; at 1024 that ran it 7 px past the window. The complete fixture on the
// cells' tuple (warm-parchment, humanist-ui, system), under read-only, on
// one server: the language is the visitor's, picked by the appearance
// cookie. The text is set as the quality cells set it: the root's
// font-size, inline, after the page loads.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const PACKS_DIR = fileURLToPath(
  new URL('../../packages/appearance-languages/packs/', import.meta.url),
);
/** Sub-pixel rounding between a box and the block's own edge, in CSS px: not a looser bar. */
const TOLERANCE = 0.5;
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

/** The stable design languages, the ones every changed variant meets in the quality cells. */
const LANGUAGES = readdirSync(PACKS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map(
    (entry) =>
      JSON.parse(readFileSync(path.join(PACKS_DIR, entry.name, 'manifest.json'), 'utf8')) as {
        id: string;
        tier: string;
      },
  )
  .filter((manifest) => manifest.tier === 'stable')
  .map((manifest) => manifest.id)
  .sort();

/** The complete fixture through Schematic on the cells' tuple, its language the visitor's to pick. */
function serving() {
  const site = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'schematic')
    .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
    .replace(/displayMode: .*/, 'displayMode: system')
    .replace('\n  designLanguage: locked\n', '\n  designLanguage: selectable\n');
  if (!site.includes('\n  designLanguage: selectable\n')) {
    throw new Error("The complete fixture's visitor controls moved: update serving().");
  }
  return {
    portfolio: FIXTURE.files.portfolio,
    siteText: site,
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  };
}

test.use({ appOptions: serving() });

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

test('the stable design languages are read', () => {
  expect(LANGUAGES.length).toBeGreaterThan(1);
  expect(LANGUAGES).toContain('material-3-inspired');
});

for (const language of LANGUAGES) {
  test.describe(`under ${language}`, () => {
    for (const viewport of VIEWPORTS) {
      test(
        `the cover's Index stays inside its title block at ${viewport.width} under 200% text`,
        { annotation },
        async ({ page, app }, testInfo) => {
          await page.context().addCookies([
            {
              name: 'portfolio_appearance',
              value: new URLSearchParams({ language }).toString(),
              url: app.origin,
            },
          ]);
          await page.setViewportSize(viewport);
          await page.goto('/', { waitUntil: 'networkidle' });
          const boundary = page.locator('[data-variant]').first();
          await expect(boundary).toHaveAttribute('data-variant', 'schematic');
          await expect(boundary).toHaveAttribute('data-design-language', language);
          await page.evaluate(() => document.fonts.ready);
          const measure = () =>
            page.evaluate((TOLERANCE) => {
              const block = document.querySelector('.sx-sheet--cover .sx-tb[data-at="cover"]');
              const index = block?.querySelector(':scope > .sx-tb__here > a[data-sx-open]');
              const cell = index?.parentElement;
              if (!block || !index || !cell) return null;
              const box = (el: Element) => {
                const r = el.getBoundingClientRect();
                return {
                  left: r.left,
                  right: r.right,
                  top: r.top,
                  bottom: r.bottom,
                  width: r.width,
                };
              };
              const outer = block.getBoundingClientRect();
              const visible = (el: Element) => !el.closest('.sx-hidden');
              // Every box in the block, against the block's own box.
              const outside = [...block.querySelectorAll('*')]
                .filter(visible)
                .map((el) => ({ el, r: el.getBoundingClientRect() }))
                .filter(({ r }) => r.width > 0 || r.height > 0)
                .filter(
                  ({ r }) =>
                    r.left < outer.left - TOLERANCE ||
                    r.right > outer.right + TOLERANCE ||
                    r.top < outer.top - TOLERANCE ||
                    r.bottom > outer.bottom + TOLERANCE,
                )
                .map(
                  ({ el, r }) =>
                    `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent ?? '').trim().slice(0, 24)}" ${r.left.toFixed(1)} to ${r.right.toFixed(1)}`,
                );
              // Each word of the block's own text, between whitespace, a slash or an en dash
              // (each a line-break opportunity, so "(they/them)" may wrap after its slash): one
              // line box unless its element hyphenates (hyphens: auto, a language's own break),
              // and how much room its cell's content box leaves it. A break between letters is
              // the defect.
              const words: { word: string; lines: number; width: number; room: number }[] = [];
              const hyphenated = new Set<string>();
              const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const host = node.parentElement;
                if (!host || !visible(host)) continue;
                const style = getComputedStyle(host);
                if (style.hyphens === 'auto') hyphenated.add(host.className || host.tagName);
                const holder = host.closest('.sx-tb__cell');
                if (!holder) continue;
                const hs = getComputedStyle(holder);
                const room =
                  holder.getBoundingClientRect().width -
                  parseFloat(hs.paddingInlineStart) -
                  parseFloat(hs.paddingInlineEnd) -
                  parseFloat(hs.borderInlineStartWidth) -
                  parseFloat(hs.borderInlineEndWidth);
                const text = node.textContent ?? '';
                for (const match of text.matchAll(/[^\s/\u2013]+/g)) {
                  const range = document.createRange();
                  range.setStart(node, match.index!);
                  range.setEnd(node, match.index! + match[0].length);
                  const rects = [...range.getClientRects()].filter((r) => r.width > 0);
                  const lines = new Set(rects.map((r) => Math.round(r.top))).size;
                  words.push({
                    word: match[0],
                    lines: style.hyphens === 'auto' ? 1 : lines,
                    width: rects.reduce((sum, r) => sum + r.width, 0),
                    room,
                  });
                }
              }
              return {
                rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
                block: box(block),
                cell: box(cell),
                index: box(index),
                outside,
                broken: words.filter((w) => w.lines > 1).map((w) => w.word),
                tightest: words
                  .filter((w) => w.lines === 1)
                  .map((w) => ({ word: w.word, margin: w.room - w.width }))
                  .sort((a, b) => a.margin - b.margin)
                  .slice(0, 3),
                hyphenated: [...hyphenated],
              };
            }, TOLERANCE);
          // The page's own text size first, for the record: what the block is without the condition.
          const atDefault = await measure();
          await page.evaluate(() =>
            document.documentElement.style.setProperty('font-size', '200%', 'important'),
          );
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          const measured = await measure();
          expect(measured, 'the cover title block and its Index').not.toBeNull();
          const { block, index } = measured!;
          await testInfo.attach('measured', {
            body: JSON.stringify({ language, viewport, atDefault, ...measured }),
            contentType: 'application/json',
          });
          const where = `Index ${index.left.toFixed(1)} to ${index.right.toFixed(1)}, block ${block.left.toFixed(1)} to ${block.right.toFixed(1)}`;
          expect.soft(index.left, where).toBeGreaterThanOrEqual(block.left - TOLERANCE);
          expect.soft(index.right, where).toBeLessThanOrEqual(block.right + TOLERANCE);
          expect.soft(index.top, where).toBeGreaterThanOrEqual(block.top - TOLERANCE);
          expect.soft(index.bottom, where).toBeLessThanOrEqual(block.bottom + TOLERANCE);
          // The quality cells' condition itself: at 1024, nothing scrolls sideways.
          if (viewport.width === 1024) {
            expect
              .soft(measured!.scrollWidth, 'the page scrolls sideways')
              .toBeLessThanOrEqual(measured!.clientWidth);
          }
          // Where the block is half the cover: nothing in it leaves it, and no word of its
          // own breaks inside itself.
          if (viewport.width >= 1024) {
            expect.soft(measured!.outside, 'boxes outside the cover title block').toEqual([]);
            expect.soft(measured!.broken, 'words broken inside themselves').toEqual([]);
          }
        },
      );
    }
  });
}
