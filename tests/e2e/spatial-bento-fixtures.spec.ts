import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { parse, stringify } from 'yaml';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '@playwright/test';
import { startApp } from '../harness/app-server.mjs';

// Spatial Bento's hardening (P3): the page on the fixture shapes that push a
// composition, at a desktop, a tablet and two phone widths, home and a case page where the
// shape has one. On each, nothing scrolls sideways, there's one h1, no tile
// or board is an empty frame or hollow, no text runs out of its tile, and on
// a phone no work's description sets narrower than 11em; a right to
// left portfolio sets right to left; and Markdown that tries to run a
// script, load a frame or reach a javascript: address renders as nothing
// worse than text. The shapes:
// - identity-only, the least that goes live;
// - sparse, one artifact, text only: one work, no media, nothing optional;
// - long-text, long and unbroken titles, non-Latin titles;
// - missing-media, images that never arrive, and items with none;
// - mixed, #4's mixed profession pair, right to left in Arabic;
// - rtl, a Hebrew portfolio with one section in English;
// - hostile, the complete fixture with hostile Markdown in its prose;
// - engineering, a showcase of three: the flagship across and two works
//   under it, the pair a phone sets one column (SPA-2);
// - design, a showcase of four: the flagship, the band, and the other two
//   as one ruled list, each of its works measured too.
// SB_FIXTURE_SHOTS names a directory to write each page's full shot into.

/** Markdown that tries everything a visitor's browser must never do. */
const HOSTILE = [
  'Raw <script>window.__sbHostile = 1</script> markup',
  'an image <img src="x" onerror="window.__sbHostile = 2">',
  'a [link](javascript:window.__sbHostile=3)',
  'a frame <iframe src="https://hostile.test/"></iframe>',
  'a <a href="https://hostile.test/" onclick="window.__sbHostile=4">click</a>',
  'and **bold**, which stays, and a [plain link](https://plain.test/).',
].join(', ');

/** The complete fixture, its prose and a work's summary carrying HOSTILE. */
function hostilePair() {
  const complete = contractFixture('complete');
  const doc = parse(readFileSync(complete.files.portfolio, 'utf8')) as {
    sections: { kind: string; body?: string }[];
    works: { summary?: string }[];
  };
  for (const section of doc.sections) {
    if (section.kind === 'lede' || section.kind === 'now') section.body = `${HOSTILE}\n`;
  }
  if (doc.works[0]) doc.works[0].summary = HOSTILE;
  const dir = mkdtempSync(path.join(tmpdir(), 'sb-hostile-'));
  const portfolio = path.join(dir, 'portfolio.yml');
  writeFileSync(portfolio, stringify(doc));
  return { portfolio, base: complete };
}

const SHAPES = [
  'identity-only',
  'sparse',
  'long-text',
  'missing-media',
  'mixed',
  'rtl',
  'hostile',
  'engineering',
  'design',
] as const;
type Shape = (typeof SHAPES)[number];

function appOptionsFor(shape: Shape) {
  const hostile = shape === 'hostile' ? hostilePair() : undefined;
  const fixture = hostile ? hostile.base : contractFixture(shape);
  const dir = path.dirname(fixture.files.portfolio);
  return {
    portfolio: hostile ? hostile.portfolio : fixture.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'spatial-bento'),
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

/** What the page breaks, read from its boxes: empty frames, and text past its tile. */
async function breaks(page: Page) {
  return page.evaluate(() => {
    // Shown: with a box, and not inside a closed part of the full record, whose content the
    // browser lays out but doesn't render.
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.height > 0 &&
        getComputedStyle(el).visibility !== 'hidden' &&
        !el.parentElement?.closest('details:not([open])')
      );
    };
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')}`;
    const empty: string[] = [];
    const overflow: string[] = [];
    for (const tile of document.querySelectorAll('.sb-tile, header.sb-label')) {
      if (!visible(tile)) continue;
      const words = (tile as HTMLElement).innerText.trim();
      // Media a visitor gets: a decoration hidden from assistive tech (the reach tile's
      // Postmark) is no content.
      const media = [
        ...tile.querySelectorAll('img, svg, picture, video, canvas, [role="img"]'),
      ].some((each) => !each.closest('[aria-hidden="true"]'));
      if (words === '' && !media) empty.push(name(tile));
      if (!tile.classList.contains('sb-tile')) continue;
      const edge = tile.getBoundingClientRect();
      for (const text of tile.querySelectorAll('h1, h2, h3, h4, p, a, li, dt, dd, figcaption')) {
        if (!visible(text) || text.closest('[aria-hidden="true"], .sb-hidden, dialog')) continue;
        const box = text.getBoundingClientRect();
        if (box.left < edge.left - 1 || box.right > edge.right + 1) {
          overflow.push(`${name(text)} in ${name(tile)}`);
        }
      }
    }
    // Under 1280 a work's tile is as tall as what it holds, give or take: never more than twice
    // its children's heights and padding (a lead with no cover was 390 px around 74 of words).
    const hollow: string[] = [];
    if (innerWidth < 1280) {
      for (const tile of document.querySelectorAll<HTMLElement>('.sb-work')) {
        if (!visible(tile)) continue;
        const style = getComputedStyle(tile);
        const held =
          [...tile.children].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0) +
          Number.parseFloat(style.paddingBlockStart) +
          Number.parseFloat(style.paddingBlockEnd);
        const height = tile.getBoundingClientRect().height;
        if (height > held * 2)
          hollow.push(`${name(tile)}: ${Math.round(height)} around ${Math.round(held)}`);
      }
    }
    // On a phone a work's description sets at a readable measure (SPA-2): its box is 11em or
    // more of its own font size wide, a measure that holds whatever face the browser finds (the
    // 390 pair was about 8.5em, the 320 column is about 13.9em). A rest of several works counts
    // each of its works.
    const narrow: string[] = [];
    if (innerWidth < 768) {
      for (const words of document.querySelectorAll<HTMLElement>(
        '.sb-work__summary, .sb-work--list .sb-quiet',
      )) {
        if (!visible(words) || words.innerText.trim() === '') continue;
        const style = getComputedStyle(words);
        const inline =
          words.getBoundingClientRect().width -
          Number.parseFloat(style.paddingInlineStart) -
          Number.parseFloat(style.paddingInlineEnd);
        const em = inline / Number.parseFloat(style.fontSize);
        if (em < 11) narrow.push(`${name(words.closest('li[id], .sb-work')!)}: ${em.toFixed(1)}em`);
      }
    }
    // A board is a label and something under it: tiles, or the full record.
    const bare = [...document.querySelectorAll('section.sb-board')]
      .filter((board) => !board.querySelector('.sb-tile'))
      .map(name);
    return { empty, overflow: overflow.slice(0, 12), bare, hollow, narrow };
  });
}

async function shoot(page: Page, testInfo: TestInfo, label: string) {
  const png = await page.screenshot({ fullPage: true });
  await testInfo.attach(label, { body: png, contentType: 'image/png' });
  const out = process.env.SB_FIXTURE_SHOTS;
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, `${label}.png`), png);
  }
}

/** The checks every page of every shape passes. */
async function holds(page: Page, testInfo: TestInfo, label: string, width: number) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => document.fonts.ready.then(() => true));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await expect(page.locator('h1')).toHaveCount(1);
  const found = await breaks(page);
  expect(found.empty, 'tiles with nothing in them').toEqual([]);
  expect(found.bare, 'boards with no tile').toEqual([]);
  expect(found.hollow, `work tiles twice as tall as what they hold at ${width}`).toEqual([]);
  expect(found.narrow, `work descriptions under 11em wide at ${width}`).toEqual([]);
  expect(found.overflow, `text past its tile at ${width}`).toEqual([]);
  await shoot(page, testInfo, label);
  expect(errors).toEqual([]);
}

// Each shape its own server, started once for its tests: a worker's app takes one set of
// options, and each shape has its own.
for (const shape of SHAPES) {
  test.describe(shape, () => {
    test.describe.configure({ mode: 'serial' });
    let app: { origin: string; stop: () => Promise<void> } | undefined;
    test.beforeAll(async () => {
      app = await startApp(appOptionsFor(shape));
    });
    test.afterAll(async () => {
      await app?.stop();
    });
    const at = (route: string) => `${app!.origin}${route}`;

    for (const width of [1440, 768, 390, 320]) {
      test.describe(`at ${width}px`, () => {
        const mobile = width < 768;
        test.use({
          viewport: { width, height: width === 320 ? 800 : mobile ? 844 : 900 },
          isMobile: mobile,
          hasTouch: mobile,
        });

        test('home holds its shape', { annotation }, async ({ page }, testInfo) => {
          await page.goto(at('/'), { waitUntil: 'networkidle' });
          await holds(page, testInfo, `${shape}-home-${width}`, width);
          if (shape === 'rtl' || shape === 'mixed') {
            expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe(
              'rtl',
            );
            // The hero's name starts on the right, the line's start.
            const { name, tile } = await page.evaluate(() => {
              const h1 = document.querySelector('h1')!;
              const range = document.createRange();
              range.selectNodeContents(h1);
              const words = range.getBoundingClientRect();
              const plate = h1.closest('.sb-tile')!.getBoundingClientRect();
              return { name: words.right, tile: plate.right };
            });
            expect(tile - name).toBeLessThan(tile / 4);
          }
          if (shape === 'hostile') {
            expect(
              await page.evaluate(() => 'sbHostile' in window || '__sbHostile' in window),
            ).toBe(false);
            const main = page.locator('main');
            await expect(main.locator('script, iframe, [onerror], [onclick]')).toHaveCount(0);
            await expect(main.locator('a[href^="javascript:" i]')).toHaveCount(0);
            await expect(main.locator('strong', { hasText: 'bold' }).first()).toBeVisible();
            await expect(main.locator('a[href="https://plain.test/"]').first()).toBeVisible();
          }
        });

        test('a case page holds its shape', { annotation }, async ({ page }, testInfo) => {
          await page.goto(at('/'), { waitUntil: 'networkidle' });
          const link = page.locator('main a[href^="/work/"]').first();
          const href = (await link.count()) > 0 ? await link.getAttribute('href') : null;
          test.skip(href === null, `${shape} has no case study`);
          await page.goto(at(href!), { waitUntil: 'networkidle' });
          await holds(page, testInfo, `${shape}-case-${width}`, width);
        });
      });
    }
  });
}
