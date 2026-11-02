import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Editorial Evidence in a browser (redesign, stream C, P2), on the complete
// contract fixture: no dead space in a full-width block of home or of a
// case study; Record's long tail behind "The rest of the record", opened by
// a fragment link that lands focus on its section, open in print, and
// working with no script; Skills and Stack folded on one column; the
// Contents sheet as a popover that takes focus and gives it back; the case
// study as a feature article; and nothing past the window's edge at 320.

/** The app options that serve a contract fixture through Editorial Evidence. */
function serving(name: string) {
  const fixture = contractFixture(name);
  const dir = path.dirname(fixture.files.portfolio);
  return {
    portfolio: fixture.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'editorial-evidence'),
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

const READ_ONLY = { type: 'profile', description: 'read-only' };
const tag = '@interaction';
const CASE = '/work/project-name';
const at = (route: string) => [{ type: 'route', description: route }, READ_ONLY];

test.use({ appOptions: serving('complete'), viewport: { width: 1440, height: 900 } });

async function load(page: Page, route = '/'): Promise<void> {
  await page.goto(route, { waitUntil: 'load' });
  await expect(page.locator('[data-variant]')).toHaveAttribute(
    'data-variant',
    'editorial-evidence',
  );
}

/**
 * Every block that spans at least 60% of the window, and how far across its
 * own width what it paints reaches (its text's line boxes, its images and
 * drawings): the ones under 70% are named. No stretched, parked, or empty
 * block.
 */
const sparse = (page: Page) =>
  page.evaluate(() => {
    const found: string[] = [];
    const blocks = document.querySelectorAll<HTMLElement>(
      // Not the case's pull quote: a display line set between its own rules, not a card.
      '.ee-band__body > :not(.ee-case__quote), .ee-case__matter, .ee-case__plates',
    );
    for (const block of blocks) {
      const box = block.getBoundingClientRect();
      if (box.width < innerWidth * 0.6 || box.height < 40) continue;
      let start = box.right;
      let end = box.left;
      const reach = (r: DOMRect) => {
        if (r.width === 0 || r.height === 0) return;
        start = Math.min(start, r.left);
        end = Math.max(end, r.right);
      };
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) reach(r);
      }
      for (const media of block.querySelectorAll('img, svg, video, .pf-media-box')) {
        reach(media.getBoundingClientRect());
      }
      // Rules inside it paint too, its rows' hairlines and its leaders; never its own border.
      for (const ruled of block.querySelectorAll<HTMLElement>('*')) {
        const cs = getComputedStyle(ruled);
        if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0) {
          reach(ruled.getBoundingClientRect());
        }
      }
      const spread = (end - start) / box.width;
      if (spread < 0.7) {
        found.push(`${block.className || block.tagName} ${Math.round(spread * 100)}%`);
      }
    }
    return found;
  });

/** How far the page runs past the window's inline end, and what does, outside any scroller. */
const past = (page: Page) =>
  page.evaluate(() => {
    const over = document.documentElement.scrollWidth - innerWidth;
    const scrolls = (el: Element) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(a).overflowX)) return true;
      }
      return false;
    };
    const what =
      over > 0
        ? [...document.querySelectorAll<HTMLElement>('body *')]
            .filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5 && !scrolls(el))
            .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80))
        : [];
    return { over: Math.max(0, over), what };
  });

for (const route of ['/', CASE]) {
  test(
    `${route}: every full-width block's content spans at least 70% of it`,
    { annotation: at(route) },
    async ({ page }) => {
      await load(page, route);
      // With the record's fold open, so what it holds is held to the rule too.
      await page.evaluate(() => {
        for (const fold of document.querySelectorAll('details')) fold.setAttribute('open', '');
      });
      expect(await sparse(page)).toEqual([]);
    },
  );
}

test.describe("Record's fold", () => {
  test(
    'a Contents entry into a folded section opens the fold, goes there, and puts focus on it',
    { annotation: at('/'), tag },
    async ({ page }) => {
      await load(page);
      const fold = page.locator('details.ee-fold');
      await expect(fold).not.toHaveAttribute('open', '');
      const target = await fold.locator('section[data-section-id]').first().getAttribute('id');
      expect(target).toBeTruthy();
      await page.locator('[data-ee-contents]').click();
      await page.locator(`.ee-sheet a[href="#${target}"]`).click();
      await expect(fold).toHaveAttribute('open', '');
      await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${target}`);
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(target);
      await expect(page.locator(`#${target}`)).toBeInViewport();
    },
  );

  test(
    'a page loaded at a folded section opens the fold there',
    { annotation: at('/') },
    async ({ page }) => {
      // The first navigation is the load at the fragment, so the island's reveal on mount runs.
      const target = 'publications';
      await page.goto(`/#${target}`, { waitUntil: 'load' });
      await expect(page.locator('details.ee-fold')).toHaveAttribute('open', '');
      await expect(page.locator(`#${target}`)).toBeInViewport();
      // The island's own effect, which the browser's opening of the fold can't stand in for.
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(target);
    },
  );

  test('it prints open', { annotation: at('/') }, async ({ page }) => {
    await load(page);
    await page.emulateMedia({ media: 'print' });
    const sections = page.locator('details.ee-fold section[data-section-id]');
    expect(await sections.count()).toBeGreaterThan(1);
    for (const section of await sections.all()) await expect(section).toBeVisible();
  });

  test.describe('with no script', () => {
    test.use({ javaScriptEnabled: false });

    test('it opens and closes on its summary', { annotation: at('/'), tag }, async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      const fold = page.locator('details.ee-fold');
      const first = fold.locator('section[data-section-id]').first();
      await expect(first).toBeHidden();
      await fold.locator('> summary').click();
      await expect(first).toBeVisible();
      await fold.locator('> summary').click();
      await expect(first).toBeHidden();
    });
  });
});

test(
  "an unavailable Pl. 1 shows no marks, keys or leaders, and its mat sits on the caption's foot",
  { annotation: at('/') },
  async ({ page }) => {
    await load(page);
    await expect(page.locator('.ee-lead .pf-media-box')).toBeVisible();
    for (const part of ['.ee-lead__pin', '.ee-lead__key', '.ee-lead__run']) {
      for (const el of await page.locator(part).all()) await expect(el).toBeHidden();
    }
    const [frame, caption] = await Promise.all(
      ['.ee-lead__frame', '.ee-lead__caption'].map((s) =>
        page.locator(s).evaluate((el) => el.getBoundingClientRect().bottom),
      ),
    );
    expect(Math.abs(frame! - caption!)).toBeLessThanOrEqual(2);
  },
);

// The language reaches EE through the shared primitives (owner's similarity complaint): Pl. 1's
// mat is the Surface primitive, its corner and depth the language's card, and an unavailable
// picture keeps a picture's place on a placeholder's ground, square on the mat, never a black
// pill: beside its caption it fills the plate, and on one column it keeps the kit's 3:2.
for (const width of [1440, 1024, 768, 390]) {
  test(
    `at ${width}, Pl. 1's mat is the language's Surface, its unavailable picture a picture's placeholder`,
    { annotation: at('/') },
    async ({ page }) => {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await load(page);
      const frame = page.locator('.ee-lead__frame');
      await expect(frame).toHaveAttribute('data-ui-slot', 'surface');
      // The complete fixture's cover is unavailable; say so if it ever gains a picture.
      await expect(
        frame.locator('.pf-media-box'),
        "the fixture's Pl. 1 is unavailable",
      ).toHaveCount(1);
      const plate = await frame.evaluate((mat) => {
        const box = mat.querySelector('.pf-media-box')!;
        const r = box.getBoundingClientRect();
        const style = getComputedStyle(box);
        const own = getComputedStyle(mat);
        // What the language's card tokens resolve to here, on a probe with only those set.
        const probe = document.createElement('div');
        probe.style.borderRadius = 'var(--ui-radius-card)';
        probe.style.boxShadow = 'var(--ui-shadow-card)';
        probe.style.color = 'var(--color-border-subtle)';
        mat.append(probe);
        const card = getComputedStyle(probe);
        const token = {
          radius: card.borderStartStartRadius,
          shadow: card.boxShadow,
          rule: card.color,
        };
        probe.remove();
        const inner =
          mat.getBoundingClientRect().height -
          parseFloat(own.paddingBlockStart) -
          parseFloat(own.paddingBlockEnd) -
          parseFloat(own.borderBlockStartWidth) -
          parseFloat(own.borderBlockEndWidth);
        return {
          radius: own.borderStartStartRadius,
          shadow: own.boxShadow,
          token,
          ratio: r.height / r.width,
          // The picture's figure, its box and its credit, fills the mat inside its padding.
          fill: mat.querySelector('figure')!.getBoundingClientRect().height - inner,
          boxRadius: parseFloat(style.borderStartStartRadius),
          ground: style.backgroundImage,
          // Its own keyline, on every side, in the language's subtle border colour (r2 N-3).
          keyline: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
          keylineStyle: style.borderTopStyle,
          keylineColor: style.borderTopColor,
          label: box.textContent,
        };
      });
      expect(plate.radius).toBe(plate.token.radius);
      expect(plate.shadow).toBe(plate.token.shadow);
      if (width >= 768) {
        // Beside its caption: a picture's place, never a bar, its figure filling the mat.
        expect(plate.ratio).toBeGreaterThan(0.6);
        expect(Math.abs(plate.fill)).toBeLessThanOrEqual(2);
      } else {
        // On one column: the picture's 3:2, neither a strip nor taller.
        expect(plate.ratio).toBeGreaterThan(0.64);
        expect(plate.ratio).toBeLessThan(0.69);
      }
      expect(plate.boxRadius).toBe(0);
      expect(plate.ground).toMatch(/^linear-gradient/);
      expect(plate.keyline).toEqual(['1px', '1px', '1px', '1px']);
      expect(plate.keylineStyle).toBe('solid');
      expect(plate.keylineColor).toBe(plate.token.rule);
      expect(plate.label).toContain('Image unavailable');
    },
  );
}

// The Contents sheet is EE's own full-bleed sheet: an opaque ground, which forced colours keep,
// so the page never shows through its entries, and no floating pane's corner (EE-LANG round 2, H1).
for (const forcedColors of ['none', 'active'] as const) {
  test(
    `the Contents sheet is opaque and square-cornered, forced colours ${forcedColors}`,
    { annotation: at('/'), tag },
    async ({ page }) => {
      await page.emulateMedia({ forcedColors });
      await load(page);
      await page.locator('[data-ee-contents]').click();
      const sheet = page.locator('.ee-sheet');
      await expect(sheet).toBeVisible();
      const paint = await sheet.evaluate((el) => {
        const style = getComputedStyle(el);
        const probe = document.createElement('canvas').getContext('2d')!;
        // Fails closed: a colour string the canvas can't read leaves it transparent, alpha 0.
        probe.fillStyle = 'transparent';
        probe.fillStyle = style.backgroundColor;
        probe.fillRect(0, 0, 1, 1);
        return {
          alpha: probe.getImageData(0, 0, 1, 1).data[3],
          radius: style.borderStartStartRadius,
          slot: el.getAttribute('data-ui-slot'),
        };
      });
      expect(paint.alpha).toBe(255);
      expect(paint.radius).toBe('0px');
      expect(paint.slot).toBeNull();
    },
  );
}

// A case's fact sheet (r2 N-1): on one column the language's whole subtle Surface, never
// stretched past its rows; in the notes column a ruled sheet, not a card: the Surface gives up its
// box, frame and depth with it, the list takes the Surface's subtle stack, and its rules run to its
// edges, closing it top and foot, its tone and rules hung a step into the gutter so its words sit
// inside them (editorial-evidence-languages.spec.ts holds that in six languages).
test(
  "on one column a case's fact sheet sits on the language's subtle Surface, never stretched past its rows",
  { annotation: at(CASE) },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, CASE);
    const sheet = await page.locator('.ee-case__facts').evaluate((surface) => {
      const list = surface.querySelector('.ee-facts')!.getBoundingClientRect();
      const box = surface.getBoundingClientRect();
      const style = getComputedStyle(surface);
      const edges =
        parseFloat(style.paddingBlockStart) +
        parseFloat(style.paddingBlockEnd) +
        parseFloat(style.borderBlockStartWidth) +
        parseFloat(style.borderBlockEndWidth);
      return {
        slot: surface.getAttribute('data-ui-slot'),
        emphasis: surface.getAttribute('data-emphasis'),
        display: style.display,
        slack: box.height - list.height - edges,
      };
    });
    expect(sheet.slot).toBe('surface');
    expect(sheet.emphasis).toBe('subtle');
    expect(sheet.display).toBe('block');
    expect(Math.abs(sheet.slack)).toBeLessThanOrEqual(2);
  },
);

for (const width of [1440, 1024, 768]) {
  test(
    `at ${width}, a case's fact sheet is ruled on the language's subtle tone, its rules to its edges, no frame`,
    { annotation: at(CASE) },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await load(page, CASE);
      const sheet = await page.locator('.ee-case__facts').evaluate((surface) => {
        const list = surface.querySelector<HTMLElement>('.ee-facts')!;
        const own = getComputedStyle(list);
        // The subtle Surface's own paint, on a probe Surface in the sheet's context.
        const probe = document.createElement('div');
        probe.setAttribute('data-ui-slot', 'surface');
        probe.setAttribute('data-emphasis', 'subtle');
        surface.parentElement!.append(probe);
        const tone = getComputedStyle(probe).backgroundImage;
        probe.remove();
        const box = list.getBoundingClientRect();
        const rows = [...list.children].map((row) => {
          const r = row.getBoundingClientRect();
          const style = getComputedStyle(row);
          return {
            x: r.left,
            r: r.right,
            pad: parseFloat(style.paddingInlineStart) + parseFloat(style.paddingInlineEnd),
            top: parseFloat(style.borderTopWidth),
          };
        });
        const last = getComputedStyle(list.lastElementChild!);
        return {
          slot: surface.getAttribute('data-ui-slot'),
          surfaceDisplay: getComputedStyle(surface).display,
          ground: own.backgroundImage,
          tone,
          frame: [
            own.borderTopWidth,
            own.borderRightWidth,
            own.borderBottomWidth,
            own.borderLeftWidth,
          ],
          shadow: own.boxShadow,
          padInline: parseFloat(own.paddingInlineStart) + parseFloat(own.paddingInlineEnd),
          box: { x: box.left, r: box.right },
          rows,
          foot: parseFloat(last.borderBottomWidth),
        };
      });
      expect(sheet.slot).toBe('surface');
      // The Surface lays no box out here, so none of its frame or depth paints.
      expect(sheet.surfaceDisplay).toBe('contents');
      expect(sheet.ground).toBe(sheet.tone);
      expect(sheet.frame).toEqual(['0px', '0px', '0px', '0px']);
      expect(sheet.shadow).toBe('none');
      expect(sheet.padInline).toBe(0);
      expect(sheet.rows.length).toBeGreaterThan(1);
      for (const row of sheet.rows) {
        // Each rule runs from the sheet's edge to its edge, its words a step inside (S-1).
        expect(Math.abs(row.x - sheet.box.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(row.r - sheet.box.r)).toBeLessThanOrEqual(0.5);
        expect(row.pad).toBeGreaterThan(0);
        expect(row.top).toBeGreaterThan(0);
      }
      expect(sheet.foot).toBeGreaterThan(0);
    },
  );
}

// Beside the head column the contents is always open, EE's own index: the Disclosure lays no box
// out there, so none of its rules or padding shows. Below 81.25rem it's the language's Disclosure,
// one line that opens.
for (const width of [1440, 1024]) {
  const open = width >= 1300;
  test(
    `at ${width}, the contents' Disclosure ${open ? 'lays no box out beside the head column' : 'is a box whose summary opens it'}`,
    { annotation: at('/') },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await load(page);
      const details = page.locator('.ee-contents__details');
      await expect(details).toHaveAttribute('data-ui-slot', 'disclosure');
      const displays = await details.evaluate((el) => [
        getComputedStyle(el).display,
        getComputedStyle(el.querySelector(':scope > div')!).display,
      ]);
      if (open) {
        expect(displays).toEqual(['contents', 'contents']);
        await expect(details.locator('> summary')).toBeHidden();
        await expect(details.locator('ol').first()).toBeVisible();
      } else {
        expect(displays[0]).not.toBe('contents');
        // The language's Disclosure: closed, its summary opens it and shows the index.
        const summary = details.locator('> summary');
        const list = details.locator('ol').first();
        await expect(summary).toBeVisible();
        await expect(details).not.toHaveAttribute('open', '');
        await expect(list).toBeHidden();
        await summary.click();
        await expect(details).toHaveAttribute('open', '');
        await expect(list).toBeVisible();
      }
    },
  );
}

test(
  'Skills and Stack read open beside the text column',
  { annotation: at('/') },
  async ({ page }) => {
    await load(page);
    const folds = await page.locator('details.ee-band__fold').all();
    expect(folds.length).toBeGreaterThan(0);
    for (const fold of folds) {
      await expect(fold.locator('> summary')).toBeHidden();
      await expect(fold.locator('.ee-band__body')).toBeVisible();
    }
  },
);

test.describe('on one column', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test(
    'the practice lists and the all-figure works fold under their heads, each a summary line that takes focus and opens',
    { annotation: at('/'), tag },
    async ({ page }) => {
      await load(page);
      const folds = page.locator('details.ee-band__fold');
      expect(await folds.count()).toBeGreaterThan(0);
      for (const fold of await folds.all()) {
        const summary = fold.locator('> summary');
        await expect(summary).toBeVisible();
        await expect(summary).toContainText(/\d+ (groups?|offers?|photographs?|tracks?|works?)/);
        // The section's head stays outside the fold, in the outline.
        await expect(
          fold.locator('xpath=..').locator('> .ee-band__head h2, > .ee-band__head h3'),
        ).toBeVisible();
        await expect(fold.locator('.ee-band__body')).toBeHidden();
        await summary.focus();
        await expect(summary).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(fold.locator('.ee-band__body')).toBeVisible();
      }
    },
  );

  test(
    'a link to a folded band opens its fold and lands focus on its section',
    { annotation: at('/'), tag },
    async ({ page }) => {
      await load(page);
      const band = page.locator('section.ee-band:has(> details.ee-band__fold)').first();
      const id = await band.getAttribute('id');
      expect(id).toBeTruthy();
      const fold = band.locator('> details.ee-band__fold');
      await expect(fold).not.toHaveAttribute('open', '');
      await page.evaluate((target) => (location.hash = target), `#${id}`);
      await expect(fold).toHaveAttribute('open', '');
      await expect(fold.locator('.ee-band__body')).toBeVisible();
      await expect(band).toBeFocused();
    },
  );

  test('its folds print open', { annotation: at('/') }, async ({ page }) => {
    await load(page);
    await page.emulateMedia({ media: 'print' });
    const folded = page.locator('details.ee-band__fold > .ee-band__body');
    expect(await folded.count()).toBeGreaterThan(1);
    for (const body of await folded.all()) await expect(body).toBeVisible();
  });
});

// The lede's Read more is in editorial-evidence-lede.spec.ts, on the demo's sample.

test(
  'Contents opens as a popover, takes focus, closes on Escape, and gives focus back to its link',
  { annotation: at('/'), tag },
  async ({ page }) => {
    await load(page);
    const contents = page.locator('[data-ee-contents]');
    await contents.click();
    const sheet = page.locator('.ee-sheet');
    await expect(sheet).toBeVisible();
    await expect(contents).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(contents).toBeFocused();
    // A chapter followed from the sheet closes it and lands there.
    await contents.click();
    const chapter = sheet.locator('.ee-sheet__chapter-link').first();
    const href = await chapter.getAttribute('href');
    await chapter.click();
    await expect(sheet).toBeHidden();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(href);
  },
);

test(
  "a case study is a feature article: one h1, the issue's own stops, back matter, and a way on",
  { annotation: at(CASE) },
  async ({ page }) => {
    await load(page, CASE);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveClass(/ee-case__title/);
    const stops = await page.locator('main h2.ee-head-title').allTextContents();
    expect(stops.at(-1)).toBe('Back matter');
    for (const label of ['Challenge', 'Context', 'Outcomes', 'Reflection']) {
      expect(stops).not.toContain(label);
    }
    await expect(page.getByRole('heading', { name: 'Cite this work' })).toBeVisible();
    await expect(page.locator('.ee-case__end a[href]').first()).toBeVisible();
    // The work's other plates break out across the text and the margin (EE-S9).
    await expect(page.locator('.ee-case__plates .ee-caption__index').first()).toHaveText(/Pl\. 1a/);
    // The running head names the case's chapter and title.
    await expect(page.locator('[data-ee-folio-section]')).toContainText(
      (await page.locator('h1').textContent())!,
    );
  },
);

// K-12 moves these to the shared spec, with the platform's scroll-padding-top: they read only the
// page, its masthead (.ee-masthead) and the stops in <main>.
test.describe('focus under the masthead', () => {
  /** A stop in the page parked with its top `by` px above the masthead's foot, the stop beside it focused first. */
  const park = (page: Page, by: number, from: 'next' | 'previous') =>
    page.evaluate(
      ([under, side]) => {
        const stops = [
          ...document.querySelectorAll<HTMLElement>('main a[href], main summary, main button'),
        ].filter((el) => el.getClientRects().length > 0 && !el.closest('.ee-masthead, .ee-rail'));
        const at = Math.floor(stops.length / 2);
        const target = stops[at]!;
        target.setAttribute('data-ee-parked', '');
        stops[side === 'next' ? at + 1 : at - 1]!.focus({ preventScroll: true });
        const bar = document.querySelector('.ee-masthead')!.getBoundingClientRect();
        scrollTo(0, scrollY + target.getBoundingClientRect().top - (bar.bottom - under));
        return {
          bar: Math.round(bar.bottom),
          top: Math.round(target.getBoundingClientRect().top),
        };
      },
      [by, from] as const,
    );

  test(
    'Shift+Tab onto a stop under the masthead brings it out below it',
    { annotation: at('/'), tag },
    async ({ page }) => {
      await load(page);
      const parked = await park(page, 12, 'next');
      expect(parked.top, 'parked under the masthead').toBeLessThan(parked.bar);
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('[data-ee-parked]')).toBeFocused();
      const top = await page
        .locator('[data-ee-parked]')
        .evaluate((el) => el.getBoundingClientRect().top);
      expect(top).toBeGreaterThanOrEqual(parked.bar);
    },
  );

  test(
    "a click on a Record row's words leaves the page where it is",
    { annotation: at('/'), tag },
    async ({ page }) => {
      await load(page);
      await page.evaluate(() =>
        document.querySelector('details.ee-fold')?.setAttribute('open', ''),
      );
      // A row just under the masthead, and a point on its words that isn't a link.
      const point = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('details.ee-fold .ee-row')!;
        const bar = document.querySelector('.ee-masthead')!.getBoundingClientRect();
        scrollTo(0, scrollY + row.getBoundingClientRect().top - bar.bottom - 4);
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          if (node.parentElement?.closest('a, button, summary')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          if (r.width > 0 && r.top >= bar.bottom) return { x: r.left + 2, y: r.top + r.height / 2 };
        }
        return null;
      });
      expect(point, "a row's words, below the masthead").not.toBeNull();
      const before = await page.evaluate(() => scrollY);
      await page.mouse.click(point!.x, point!.y);
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => scrollY)).toBe(before);
    },
  );
});

// The chapter index folded at the top of the issue opens to Tab; a blur that sends focus nowhere
// leaves it open and over the heads as it was, so the blur takes only the entry's ring away (a
// ring the quality walk can measure), and focus going on past it lets it fold again.
test(
  'at 1440 the chapter index Tab opens stays open while focus goes nowhere, and yields once focus goes on',
  { annotation: at('/'), tag },
  async ({ page }) => {
    await load(page);
    const rail = page.locator('.ee-rail');
    const entries = rail.locator('.ee-rail__list > li > a');
    await expect(rail).toHaveAttribute('data-ee-yield', 'fold');
    await expect(entries.nth(1)).toBeHidden();
    await entries.first().focus();
    await page.keyboard.press('Tab');
    await expect(entries.nth(1)).toBeFocused();
    const layer = () => rail.evaluate((el) => getComputedStyle(el).zIndex);
    expect(await layer(), 'over the heads while it holds focus').toBe('3');
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await expect(entries.nth(1), 'the blur left the entry where it was').toBeVisible();
    expect(await layer(), 'and the index over the heads').toBe('3');
    await entries.nth(1).focus();
    const inRail = () => rail.evaluate((el) => el.contains(document.activeElement));
    for (let n = 0; n < 40 && (await inRail()); n++) await page.keyboard.press('Tab');
    expect(await inRail(), 'Tab went on past the index').toBe(false);
    await expect(rail).not.toHaveAttribute('data-ee-yield', 'held');
    expect(await layer(), 'back under the heads').toBe('1');
  },
);

test.describe('at 320', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  /** Where the wrapped chapter bar ends, and where `selector`'s element begins, in the window. */
  const edges = (page: Page, selector: string) =>
    page.evaluate((target) => {
      const bar = document.querySelector('.ee-rail')!.getBoundingClientRect();
      const element = document.querySelector(target)!.getBoundingClientRect();
      return { bar: Math.round(bar.bottom), top: Math.round(element.top) };
    }, selector);

  test(
    'a folded fragment and a focused row both land below the wrapped chapter bar',
    { annotation: at('/'), tag },
    async ({ page }) => {
      await page.goto('/#publications', { waitUntil: 'load' });
      await expect(page.locator('details.ee-fold')).toHaveAttribute('open', '');
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('publications');
      const landed = await edges(page, '#publications');
      expect(landed.top).toBeGreaterThanOrEqual(landed.bar);
      // A row's link parked under the bar's second row, then reached by Tab from the stop
      // before it: focus brings it out below the bar. Were only one row reserved, it would
      // already count as in view there and stay covered, so this fails.
      const parked = await page.evaluate(() => {
        const stops = [
          ...document.querySelectorAll<HTMLElement>('a[href], button, summary, [tabindex="0"]'),
        ].filter((el) => el.getClientRects().length > 0);
        const at = stops.findIndex((el) => el.closest('.ee-row__title') !== null);
        if (at < 1) return null;
        const target = stops[at]!;
        target.setAttribute('data-ee-parked', '');
        // Focus on the stop before it first, so nothing that focus does moves the parked link.
        stops[at - 1]!.focus({ preventScroll: true });
        const bar = document.querySelector('.ee-rail')!.getBoundingClientRect();
        const row = document.querySelector('.ee-rail__link')!.getBoundingClientRect().height;
        // Its top half a row above the bar's foot: inside the second row.
        scrollTo(0, scrollY + target.getBoundingClientRect().top - (bar.bottom - row / 2));
        const now = document.querySelector('.ee-rail')!.getBoundingClientRect();
        return { bar: Math.round(now.bottom), top: Math.round(target.getBoundingClientRect().top) };
      });
      expect(parked, 'a row link with a stop before it').not.toBeNull();
      expect(parked!.top, 'parked under the bar').toBeLessThan(parked!.bar);
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-ee-parked]')).toBeFocused();
      const focused = await page.evaluate(() => {
        const bar = document.querySelector('.ee-rail')!.getBoundingClientRect();
        const element = document.activeElement!.getBoundingClientRect();
        return { bar: Math.round(bar.bottom), top: Math.round(element.top) };
      });
      expect(focused.top).toBeGreaterThanOrEqual(focused.bar);
    },
  );

  for (const route of ['/', CASE]) {
    test(
      `${route}: nothing runs past the window's edge`,
      { annotation: at(route) },
      async ({ page }) => {
        await load(page, route);
        // Every fold open, so what they hold is held to the window too.
        await page.evaluate(() => {
          for (const fold of document.querySelectorAll('details')) fold.setAttribute('open', '');
        });
        expect(await past(page)).toEqual({ over: 0, what: [] });
      },
    );
  }
});
