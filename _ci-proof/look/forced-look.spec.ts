import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';

// A look under forced colours, run from tests/e2e at the base and at the head: one composition
// (PROOF_LOOK_COMP) on the complete fixture, in the system's light palette and its dark one, a
// test each. Each test writes PNGs to PROOF_LOOK_OUT:
//   <comp>-<palette>-<route>-<width>-page: the first screen at each route and width read here
//   <comp>-<palette>-<route>-<width>-spot<n>: each red case's first shown match, with its surround
//   <comp>-<palette>-text<n>: a mid-range text, at its own palette, route and width
//   <comp>-<palette>-home-<width>-draw<n>: a dark ground's drawings (Kinetic Cosmos's orrery and
//     pills, Spatial Bento's inverse and accent tiles, Singular's inverse and accent grounds)
//   <comp>-<palette>-island<n>: each of Raw Grid's unadjusted islands focused from the keyboard,
//     clipped to it and the ring around it
// One composition a file run, since a file takes one appOptions.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const COMP = process.env.PROOF_LOOK_COMP ?? 'raw-grid';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), COMP),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

type Palette = 'light' | 'dark';
const HOME = '/';
const WORK = '/work/project-name';

/** The red's cases: each route's selectors, and the widths they're read at. */
const CASES: Record<string, { texts: Record<string, string[]>; widths?: number[] }> = {
  flux: { texts: { [HOME]: ['.fx-btn:not(.fx-btn--quiet)'] } },
  'horizontal-cinema': {
    texts: { [HOME]: ["[data-ui-slot='action'][data-emphasis='primary']"] },
    widths: [390],
  },
  'kinetic-cosmos': {
    texts: {
      [HOME]: [
        ".kc-masthead [data-ui-slot='disclosure.summary']",
        '.kc-masthead .kc-index-trigger',
      ],
      [WORK]: [
        ".kc-masthead [data-ui-slot='disclosure.summary']",
        '.kc-masthead .kc-index-trigger',
      ],
    },
  },
  'mission-control': { texts: { [HOME]: ['.mc-act--primary'] } },
  'obsidian-atelier': {
    texts: { [HOME]: ['.oa-sleeve__series'] },
    widths: [390],
  },
  'raw-grid': {
    texts: {
      [HOME]: ['.pf-media-box__label'],
      [WORK]: ['.pf-media-box__label'],
    },
  },
  'spatial-bento': {
    texts: {
      [HOME]: ['.sb-btn--strong', '.sb-tile--inverse .sb-title', '.sb-reach__where'],
      [WORK]: ['.sb-btn--strong'],
    },
  },
  'terra-field': {
    texts: {
      [HOME]: ['.tf-mast .tf-mast__name', '.tf-mast .tf-linkbtn'],
      [WORK]: ['.tf-mast .tf-mast__name', '.tf-mast .tf-linkbtn'],
    },
  },
  // Affected with no case in the red (Singular's labels are fixed apart): the first screen only.
  singular: { texts: { [HOME]: [] } },
  schematic: { texts: { [HOME]: [] } },
};

/** The mid-range texts, read by design at their own palette, route and width: their words. */
const TEXTS: Record<string, { palette: Palette; route: string; width: number; words: string }[]> = {
  'kinetic-cosmos': [
    { palette: 'light', route: HOME, width: 1024, words: 'Work' },
    { palette: 'dark', route: WORK, width: 1024, words: 'Project name' },
  ],
  'raw-grid': [
    {
      palette: 'dark',
      route: HOME,
      width: 1024,
      words: 'Credit gallery-photo',
    },
  ],
  'terra-field': [{ palette: 'dark', route: HOME, width: 390, words: 'Hero subtagline' }],
  'horizontal-cinema': [
    {
      palette: 'light',
      route: HOME,
      width: 1024,
      words: 'Credit gallery-photo',
    },
  ],
};

/** The parts on a dark ground that draw in its ink, shot on home at 1024 and 390. */
const DRAWN: Record<string, string[]> = {
  'kinetic-cosmos': [
    '.kc-orrery',
    '.kc-opening__actions .kc-button--bright',
    '.kc-signature-label',
  ],
  'spatial-bento': ['.sb-tile--inverse', '.sb-tile--accent'],
  singular: ["[data-ground='inverse']", "[data-ground='accent']"],
};

/** Raw Grid's islands, which keep their own colours (forced-color-adjust: none). */
const ISLANDS = [
  '.rg-tab',
  '.rg-index__tab',
  ".rg-sticker[data-tone='emphasis']",
  '.rg-act:first-child',
  '.rg-head__dest[aria-current]',
  ".rg-ticker__toggle [aria-pressed='true']",
];
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

const slug = (route: string) =>
  route === HOME ? 'home' : route.replace(/\W+/g, '-').replace(/^-/, '');

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

async function openForced(page: Page, route: string, palette: Palette, width: number) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 768 });
  await page.emulateMedia({
    colorScheme: palette,
    forcedColors: 'active',
    reducedMotion: 'reduce',
  });
  await page.goto(route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await settle(page);
}

/** Shoots `locator`'s box and `pad` px round it, clamped to the viewport; false when it's off it. */
async function shot(page: Page, locator: Locator, name: string, pad: number): Promise<boolean> {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await settle(page);
  const b = await locator.boundingBox();
  const vp = page.viewportSize()!;
  if (!b || b.width < 1 || b.height < 1) return false;
  const x = Math.max(0, Math.floor(b.x - pad));
  const y = Math.max(0, Math.floor(b.y - pad));
  const width = Math.min(vp.width, Math.ceil(b.x + b.width + pad)) - x;
  const height = Math.min(vp.height, Math.ceil(b.y + b.height + pad)) - y;
  if (width < 2 || height < 2) return false;
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    clip: { x, y, width, height },
    animations: 'disabled',
    caret: 'hide',
  });
  return true;
}

/** The first match of `selector` that is shown (has a box). */
async function firstShown(page: Page, selector: string): Promise<Locator | null> {
  const all = page.locator(selector);
  for (let i = 0; i < (await all.count()); i += 1) {
    const one = all.nth(i);
    if (await one.evaluate((el) => el.getClientRects().length > 0)) return one;
  }
  return null;
}

/** Marks the innermost shown elements whose words are `words`, at most 3, and returns their marks. */
async function byWords(page: Page, words: string): Promise<string[]> {
  return page.evaluate((w) => {
    const norm = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const found: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (found.length === 3) break;
      if (norm(el) !== w || !el.getClientRects().length) continue;
      if ([...el.children].some((child) => norm(child) === w)) continue;
      const mark = `t${found.length}`;
      el.setAttribute('data-look-text', mark);
      found.push(mark);
    }
    return found;
  }, words);
}

for (const palette of ['light', 'dark'] as const) {
  test(`forced look ${COMP} ${palette}`, async ({ page }) => {
    test.setTimeout(300_000);
    mkdirSync(OUT, { recursive: true });
    const cases = CASES[COMP] ?? { texts: { [HOME]: [] } };
    for (const [route, selectors] of Object.entries(cases.texts)) {
      for (const width of cases.widths ?? [1024, 390]) {
        await openForced(page, route, palette, width);
        const name = `${COMP}-${palette}-${slug(route)}-${width}`;
        await page.screenshot({
          path: path.join(OUT, `${name}-page.png`),
          animations: 'disabled',
          caret: 'hide',
        });
        let n = 0;
        for (const selector of selectors) {
          const one = await firstShown(page, selector);
          if (one && (await shot(page, one, `${name}-spot${n}`, 16))) n += 1;
        }
      }
    }
    let t = 0;
    for (const text of (TEXTS[COMP] ?? []).filter((x) => x.palette === palette)) {
      await openForced(page, text.route, palette, text.width);
      for (const mark of await byWords(page, text.words)) {
        if (
          await shot(
            page,
            page.locator(`[data-look-text="${mark}"]`),
            `${COMP}-${palette}-text${t}`,
            16,
          )
        )
          t += 1;
      }
    }
    for (const width of DRAWN[COMP] ? [1024, 390] : []) {
      await openForced(page, HOME, palette, width);
      let d = 0;
      for (const selector of DRAWN[COMP]!) {
        const one = await firstShown(page, selector);
        if (one && (await shot(page, one, `${COMP}-${palette}-home-${width}-draw${d}`, 8))) d += 1;
      }
    }
    if (COMP === 'raw-grid') {
      await openForced(page, HOME, palette, 1024);
      let i = 0;
      for (const selector of ISLANDS) {
        const island = await firstShown(page, selector);
        if (!island) continue;
        const own = await island.evaluate((el, f) => el.matches(f), FOCUSABLE);
        const stop = own ? island : island.locator(FOCUSABLE).first();
        if (!(await stop.count())) continue;
        await stop.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
        await stop.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        if (await shot(page, island, `${COMP}-${palette}-island${i}`, 16)) i += 1;
      }
    }
  });
}
