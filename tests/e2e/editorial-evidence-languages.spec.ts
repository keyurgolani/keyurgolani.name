import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Editorial Evidence across languages and types in a browser (EE-LANG P3).
//
// The masthead: from 48rem the name, the running head, Contents, Contact
// and the visitor's Appearance control sit on one line in every language and type, at 1440, 1024
// and 768, where the tools' floor is four columns, not three (P3 L-5). The tools take
// the notes column when they fit, and when a language's type sets them wider (accessible-reading's
// Verdana) their track grows toward the running head by just what they need, never wrapping
// Appearance under the others or shrinking the type. On the complete contract fixture, whose site
// shows the visitor control, with the language and the type left to the visitor so a cookie picks
// them.
//
// A case's ruled fact sheet: its tone and rules hang a step into the gutter, so under the widest
// type its words stay inside them, never on the fill's last pixel (design review P3, S-1).

/** The complete fixture through Editorial Evidence, its language and type the visitor's to pick. */
function serving() {
  const fixture = contractFixture('complete');
  const dir = path.dirname(fixture.files.portfolio);
  const site = fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'editorial-evidence')
    .replace('\n  designLanguage: locked\n', '\n  designLanguage: selectable\n')
    .replace('\n  typography: locked\n', '\n  typography: selectable\n');
  if (/\n {2}(designLanguage|typography): locked\n/.test(site)) {
    throw new Error("The complete fixture's visitor controls moved: update serving().");
  }
  return {
    portfolio: fixture.files.portfolio,
    siteText: site,
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

test.use({ appOptions: serving(), viewport: { width: 1440, height: 900 } });

const at = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

async function load(
  page: Page,
  origin: string,
  language: string,
  type: string,
  route = '/',
): Promise<void> {
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ language, type, mode: 'light' }).toString(),
      url: origin,
    },
  ]);
  await page.goto(route, { waitUntil: 'load' });
  const boundary = page.locator('[data-variant]').first();
  await expect(boundary).toHaveAttribute('data-variant', 'editorial-evidence');
  await expect(boundary).toHaveAttribute('data-design-language', language);
  await expect(boundary).toHaveAttribute('data-typography', type);
  await expect(page.locator('.ee-masthead [data-visitor-control-slot] summary')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** The masthead as laid out: its parts' boxes, the page's notes line and edge, and what the tools need. */
const masthead = (page: Page, notesColumn: number) =>
  page.evaluate((column) => {
    const one = (selector: string) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`the masthead has no ${selector} to measure`);
      return el;
    };
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, r: r.right, cy: (r.top + r.bottom) / 2 };
    };
    /** How many lines `el`'s words take: a line box starting below half the last one's height. */
    const lines = (el: Element) => {
      const range = document.createRange();
      const rects: DOMRect[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width > 0) rects.push(r);
      }
      rects.sort((a, b) => a.top - b.top);
      let count = 0;
      let last: DOMRect | undefined;
      for (const r of rects) {
        if (!last || r.top > last.top + last.height / 2) {
          count++;
          last = r;
        }
      }
      return count;
    };
    // The page's own 12 columns, read off the opening's grid: where the notes column starts.
    const grid = one('.ee-opening');
    const style = getComputedStyle(grid);
    const tracks = style.gridTemplateColumns.split(' ').map(parseFloat);
    const gap = parseFloat(style.columnGap);
    const edge = grid.getBoundingClientRect().right - parseFloat(style.paddingInlineEnd);
    const notes =
      grid.getBoundingClientRect().left +
      parseFloat(style.paddingInlineStart) +
      tracks.slice(0, column - 1).reduce((sum, w) => sum + w + gap, 0);
    // The tools' own width, unstretched: what they need on one line.
    const end = one('.ee-masthead__end');
    end.style.inlineSize = 'max-content';
    const need = end.getBoundingClientRect().width;
    end.style.inlineSize = '';
    return {
      tracks: tracks.length,
      notes,
      edge,
      need,
      end: box(end),
      name: box(one('.ee-masthead__name')),
      folio: box(one('.ee-masthead__folio')),
      folioLines: lines(one('.ee-masthead__folio')),
      contents: box(one('.ee-masthead__contents')),
      contact: box(one('.ee-masthead__contact a')),
      appearance: box(one('.ee-masthead [data-visitor-control-slot] summary')),
    };
  }, notesColumn);

const LANGUAGES = [
  'platform-neutral',
  'claymorphic',
  'raw-brutalist',
  'glassmorphism',
  'material-3-inspired',
  'letterpress',
];

for (const type of ['accessible-reading', 'humanist-ui']) {
  for (const language of LANGUAGES) {
    test(
      `under ${language} and ${type}, at 1440, 1024 and 768 the masthead is one line, its tools from the notes line or as wide as they need`,
      { annotation: at },
      async ({ page, app }) => {
        for (const width of [1440, 1024, 768]) {
          await page.setViewportSize({ width, height: 900 });
          await load(page, app.origin, language, type);
          // The notes column starts on the tenth column beside the head column, on the ninth below 81.25rem.
          const m = await masthead(page, width >= 1300 ? 10 : 9);
          expect(m.tracks, 'the page grid has 12 columns').toBe(12);
          const where = `at ${width}`;
          // One line: the name and every tool on one centre, so nothing wrapped and the name
          // isn't centred against a stack.
          for (const part of ['name', 'folio', 'contact', 'appearance'] as const) {
            expect(
              Math.abs(m[part].cy - m.contents.cy),
              `${where}, ${part} on Contents' line`,
            ).toBeLessThanOrEqual(2);
          }
          // The running head gives up room to the tools, never a line of its own.
          expect(m.folioLines, `${where}, the running head on one line`).toBe(1);
          // In order, apart, the last on the page edge.
          expect(m.contents.r, `${where}, Contents before Contact`).toBeLessThan(m.contact.x);
          expect(m.contact.r, `${where}, Contact before Appearance`).toBeLessThan(m.appearance.x);
          expect(m.appearance.r, `${where}, Appearance inside the page`).toBeLessThanOrEqual(
            m.edge + 1,
          );
          // The tools start on the notes line when they fit, and further out by just what they
          // need when they don't; the running head ends before them.
          const start = m.edge - Math.max(m.edge - m.notes, m.need);
          expect(Math.abs(m.end.x - start), `${where}, the tools' start`).toBeLessThanOrEqual(1);
          expect(m.folio.r, `${where}, the running head before the tools`).toBeLessThanOrEqual(
            m.end.x,
          );
        }
      },
    );
  }
}

test(
  'under accessible-reading at 1440 the masthead holds one nav line: Contents, Contact and Appearance side by side',
  { annotation: at },
  async ({ page, app }) => {
    await load(page, app.origin, 'platform-neutral', 'accessible-reading');
    let m = await masthead(page, 10);
    // The case the review saw: the tools are wider than the notes column under Verdana. Where the
    // platform has no Verdana (Linux, whose Liberation or DejaVu Sans sets them narrower, so they
    // fit), the case is made: the tools' letters spaced out by the shortfall and a rem besides.
    if (m.need <= m.edge - m.notes) {
      const tools =
        '.ee-masthead__end :is(.ee-masthead__contents, .ee-masthead__contact a, summary)';
      const letters = await page
        .locator(tools)
        .evaluateAll((els) => els.reduce((n, el) => n + el.textContent!.trim().length, 0));
      const spacing = (m.edge - m.notes - m.need + 16) / letters;
      await page.addStyleTag({
        content: `[data-variant='editorial-evidence'] ${tools} { letter-spacing: ${spacing}px; }`,
      });
      m = await masthead(page, 10);
    }
    expect(m.need, "accessible-reading's tools are wider than the notes column").toBeGreaterThan(
      m.edge - m.notes,
    );
    expect(Math.abs(m.appearance.cy - m.contents.cy)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.name.cy - m.contents.cy)).toBeLessThanOrEqual(2);
    expect(m.contact.r).toBeLessThan(m.appearance.x);
    // Their track grows toward the running head by just what they need, the head ending before it.
    expect(Math.abs(m.end.x - (m.edge - m.need)), "the tools' start").toBeLessThanOrEqual(1);
    expect(m.folio.r, 'the running head before the tools').toBeLessThanOrEqual(m.end.x);
  },
);

for (const language of LANGUAGES) {
  test(
    `under ${language} and accessible-reading at 1440, a case's fact sheet keeps its words at least 4 px inside its fill`,
    { annotation: [{ type: 'route', description: '/work/project-name' }, at[1]!] },
    async ({ page, app }) => {
      await load(page, app.origin, language, 'accessible-reading', '/work/project-name');
      const sheet = await page.locator('.ee-case__facts > .ee-facts').evaluate((list) => {
        const fill = list.getBoundingClientRect();
        // Every line box of the sheet's words, read off its text.
        const range = document.createRange();
        const lines: { x: number; r: number }[] = [];
        const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          range.selectNodeContents(node);
          for (const r of range.getClientRects())
            if (r.width > 0) lines.push({ x: r.left, r: r.right });
        }
        return { x: fill.left, r: fill.right, lines };
      });
      expect(sheet.lines.length).toBeGreaterThan(0);
      const start = Math.min(...sheet.lines.map((line) => line.x)) - sheet.x;
      const end = sheet.r - Math.max(...sheet.lines.map((line) => line.r));
      expect(start, 'the words start inside the fill').toBeGreaterThanOrEqual(4);
      expect(end, 'the words end inside the fill').toBeGreaterThanOrEqual(4);
    },
  );
}

// The open index, beside the head column, rules itself in the language's divider (EE-LANG P4): a
// head rule under "In this issue" and one over each chapter after the first, so the index reads in
// each language's own divider; its numerals take the type's display weight. (Every type pack sets
// display and title in one family, so the weight is what the display role changes here.)
for (const language of LANGUAGES) {
  test(
    `under ${language} at 1440, the open index is ruled in the language's divider, its numerals at the display weight`,
    { annotation: at },
    async ({ page, app }) => {
      await load(page, app.origin, language, 'humanist-ui');
      const index = await page.locator('.ee-contents').evaluate((contents) => {
        const rule = (el: Element, side: 'Top' | 'Bottom') => {
          const style = getComputedStyle(el);
          return [
            style[`border${side}Width`],
            style[`border${side}Style`],
            style[`border${side}Color`],
          ].join(' ');
        };
        // The language's divider and the type's display weight, on probes in the index's context.
        const probe = document.createElement('div');
        probe.style.borderBlockEnd = 'var(--ui-border-divider)';
        probe.style.fontWeight = 'var(--type-display-font-weight)';
        contents.append(probe);
        const divider = rule(probe, 'Bottom');
        const display = getComputedStyle(probe).fontWeight;
        probe.remove();
        const chapters = [...contents.querySelectorAll('.ee-contents__chapter')];
        return {
          divider,
          display,
          label: rule(contents.querySelector('.ee-contents__label')!, 'Bottom'),
          first: rule(chapters[0]!, 'Top'),
          rest: chapters.slice(1).map((chapter) => rule(chapter, 'Top')),
          numerals: [...contents.querySelectorAll('.ee-contents__link .ee-n')].map(
            (n) => getComputedStyle(n).fontWeight,
          ),
        };
      });
      expect(index.divider, "the language's divider draws").not.toMatch(/^0px/);
      expect(index.label, 'the head rule').toBe(index.divider);
      expect(index.first, 'no rule over the first chapter, under the head rule').toMatch(/^0px/);
      expect(index.rest.length).toBeGreaterThan(1);
      for (const each of index.rest)
        expect(each, 'a rule over each later chapter').toBe(index.divider);
      expect(index.numerals.length).toBe(index.rest.length + 1);
      for (const each of index.numerals) expect(each).toBe(index.display);
    },
  );
}
