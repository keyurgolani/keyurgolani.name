import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { platformStylesheet } from '../../packages/appearance/src/node/platform';

// The kit's parts under a composition's own wrapper (the redesign audit's
// rescope): every shared renderer's output, each in a bespoke frame of its
// own, with the platform stylesheet on a boundary and the kit's stylesheet
// in the variant-layout layer, as registry generation compiles it. Each part
// keeps its layout there, so no kit rule may need the frame's
// data-renderer: the avatar stays 48 px, actions and tags stay rows with no
// markers, the browser's 40 px inline margins are gone, running text holds
// the body measure, a nested heading has room above it, figures pair each
// value with its term, a case-study link leaves its entry's text
// selectable, and a stack spaces its children by the section rhythm. A
// static page, no server, and nothing leaves the browser.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KIT_CSS = readFileSync(path.join(ROOT, 'packages/kit/src/sections/styles.css'), 'utf8');

/** The parts' markup, as the kit's own renderers write it (packages/kit/src/test-support/kit-parts.tsx). */
const PARTS = execFileSync(
  process.execPath,
  ['--import', 'tsx', path.join(ROOT, 'packages/kit/src/test-support/kit-parts.tsx')],
  { cwd: ROOT, encoding: 'utf8' },
);

/** The pack values the parts read: the body and compact measures in ch, as every profile has them, and the language's divider. */
const PACKS = `@layer typography { [data-appearance-boundary] {
  --type-measure-body: 68ch; --type-measure-compact: 45ch; --type-caption-font-size: 13px;
  font-size: 16px;
} }
@layer language { [data-appearance-boundary] {
  --ui-border-divider: 1px solid currentColor;
} }`;

/**
 * A stack of four shared frames, a section, a chapter, and a group apart,
 * and one shared frame outside a stack, as a composition that hasn't moved
 * onto it renders one.
 */
const STACK = `<main class="pf-stack" id="stack">
  <section id="s1" data-renderer="shared"><p>One</p></section>
  <section id="s2" data-renderer="shared" data-rhythm="chapter"><p>Two</p></section>
  <section id="s3" data-renderer="shared" data-rhythm="group"><p>Three</p></section>
  <section id="s4" data-renderer="shared"><p>Four</p></section>
</main>
<section id="unstacked" data-renderer="shared"><p>Unstacked</p></section>`;

test.beforeEach(async ({ context, page }) => {
  await context.route('**/*', (route) => route.abort('blockedbyclient'));
  await page.setViewportSize({ width: 1240, height: 900 });
  await page.setContent(`<!doctype html><html lang="en"><head>
<style>${platformStylesheet()}</style><style>${PACKS}</style>
<style>@layer variant-layout { ${KIT_CSS} }</style>
</head><body style="margin: 0">
<div data-appearance-boundary="document" data-variant="probe">
  <div id="probe"></div>
  ${PARTS}
  ${STACK}
</div>
</body></html>`);
});

/** What `value` comes to on the boundary's probe, in CSS px, as a width would compute it. */
const length = (page: Page, value: string) =>
  page.evaluate((css) => {
    const probe = document.getElementById('probe')!;
    probe.style.width = css;
    return Number.parseFloat(getComputedStyle(probe).width);
  }, value);

/** A computed property of every element `selector` matches, or of its `pseudo`. */
const computed = (page: Page, selector: string, property: string, pseudo?: string) =>
  page.evaluate(
    ({ selector, property, pseudo }) =>
      [...document.querySelectorAll(selector)].map((element) =>
        getComputedStyle(element, pseudo ?? null).getPropertyValue(property),
      ),
    { selector, property, pseudo },
  );

const every = (values: string[], expected: string) => {
  expect(values.length).toBeGreaterThan(0);
  for (const value of values) expect(value).toBe(expected);
};

test('the parts sit in bespoke frames: no part is in a shared one', async ({ page }) => {
  expect(
    await page
      .locator('.own-frame [data-renderer="shared"], .own-frame[data-renderer="shared"]')
      .count(),
  ).toBe(0);
  expect(await page.locator('[data-renderer="bespoke"]').count()).toBeGreaterThan(10);
});

test('an avatar and a logo stay 48 px, and actions, tags, links, and meta lines stay rows with no markers', async ({
  page,
}) => {
  every(await computed(page, 'img.pf-avatar', 'width'), '48px');
  every(await computed(page, 'img.pf-logo', 'width'), '48px');
  every(await computed(page, ':is(.pf-actions, .pf-tags, .pf-links, .pf-meta)', 'display'), 'flex');
  every(
    await computed(page, ':is(.pf-actions, .pf-tags, .pf-links) > li', 'list-style-type'),
    'none',
  );
  every(
    await computed(page, ':is(.pf-actions, .pf-tags, .pf-links, .pf-list)', 'padding-inline-start'),
    '0px',
  );
  // A meta line's parts sit apart by the row's gap: no dot in the text.
  const meta = await page.locator('.pf-meta').allTextContents();
  expect(meta.join(' ')).not.toContain('·');
});

test("figures, quotes, and a dl's values sit at the text edge: no browser inline margin", async ({
  page,
}) => {
  for (const selector of ['figure', 'blockquote', 'dd']) {
    every(await computed(page, `.own-frame ${selector}`, 'margin-inline-start'), '0px');
  }
  // No indent and no stripe on a quote: it's set off by its type role.
  every(await computed(page, '.own-frame blockquote', 'padding-inline-start'), '0px');
  every(await computed(page, '.own-frame blockquote', 'border-inline-start-width'), '0px');
  // Who said it starts where the quote does.
  const edges = await page.evaluate(() =>
    [...document.querySelectorAll('.pf-quote')].map((quote) => [
      quote.querySelector('blockquote')!.getBoundingClientRect().left,
      quote.querySelector('figcaption')!.getBoundingClientRect().left,
    ]),
  );
  expect(edges.length).toBeGreaterThan(0);
  for (const [quote, caption] of edges) expect(caption).toBe(quote);
});

test('running text keeps the body measure, at most 68ch of its own text, and a tagline at body size takes it too (G5)', async ({
  page,
}) => {
  const text = await length(page, 'var(--layout-width-text)');
  // 68ch of a 16 px boundary's body text: about 600 px, not the frame's 1240.
  expect(text).toBeGreaterThan(400);
  expect(text).toBeLessThan(800);
  // Each one's own 68ch, or the body measure where that's narrower.
  const measures = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '.own-frame :is(.pf-summary, .pf-message, .pf-hero__tagline), .pf-section__subtitle',
      ),
    ].map((element) => {
      const probe = document.createElement('span');
      probe.style.cssText = 'display: inline-block; width: 68ch';
      element.append(probe);
      const ch68 = probe.getBoundingClientRect().width;
      probe.style.width = '45ch';
      const ch45 = probe.getBoundingClientRect().width;
      probe.remove();
      return {
        subtitle: element.classList.contains('pf-section__subtitle'),
        max: Number.parseFloat(getComputedStyle(element).maxWidth),
        ch68,
        ch45,
      };
    }),
  );
  expect(measures.length).toBeGreaterThan(3);
  for (const { subtitle, max, ch68, ch45 } of measures) {
    expect(Math.abs(max - (subtitle ? ch45 : Math.min(text, ch68)))).toBeLessThan(0.5);
  }
  // A tagline set larger than body takes 45ch of its own text.
  const large = await page.evaluate(() => {
    const tagline = document.querySelector<HTMLElement>('.pf-hero__tagline')!;
    tagline.style.fontSize = '2rem';
    const probe = document.createElement('span');
    probe.style.cssText = 'display: inline-block; width: 45ch';
    tagline.append(probe);
    const ch45 = probe.getBoundingClientRect().width;
    probe.remove();
    const max = Number.parseFloat(getComputedStyle(tagline).maxWidth);
    tagline.style.fontSize = '';
    return Math.abs(max - ch45);
  });
  expect(large).toBeLessThan(0.5);
});

test('a nested heading has at least twice the space above it as below it, and an excerpt is a marked quotation (G4)', async ({
  page,
}) => {
  const spaces = await page.evaluate(() =>
    [...document.querySelectorAll('.pf-decision__label')].map((label) => [
      Number.parseFloat(getComputedStyle(label).marginTop),
      Number.parseFloat(getComputedStyle(label.nextElementSibling!).marginTop),
    ]),
  );
  expect(spaces.length).toBeGreaterThan(0);
  for (const [above, below] of spaces) expect(above!).toBeGreaterThanOrEqual(2 * below!);
  every(await computed(page, '.pf-excerpt p:first-child', 'content', '::before'), 'open-quote');
  every(await computed(page, '.pf-excerpt p:last-child', 'content', '::after'), 'close-quote');
});

test('figures are a plain dl by default, each value in its term’s cell and nearer it than any other term (C6)', async ({
  page,
}) => {
  const columns = (count: number) =>
    page.evaluate(
      (count) =>
        getComputedStyle(document.querySelector(`.pf-stats[data-count="${count}"]`)!)
          .gridTemplateColumns.split(' ')
          .filter(Boolean).length,
      count,
    );
  // In a 1240 px frame: four in two columns, three in three.
  expect(await columns(4)).toBe(2);
  expect(await columns(3)).toBe(3);
  every(
    await computed(page, '.pf-stat__value', 'font-variant-numeric'),
    'lining-nums tabular-nums',
  );
  // No leader by default.
  every(await computed(page, '.pf-stat', 'content', '::after'), 'none');
  // Each value sits with its own term, closer to it than to the next column's.
  const pairs = await page.evaluate(() =>
    [...document.querySelectorAll('.pf-stats')].flatMap((list) => {
      const stats = [...list.querySelectorAll(':scope > .pf-stat')];
      const term = (stat: Element) =>
        stat.querySelector(':scope > :not(.pf-stat__value, .pf-stat__note)')!;
      return stats.map((stat, index) => {
        const value = stat.querySelector('.pf-stat__value')!.getBoundingClientRect();
        const own = term(stat).getBoundingClientRect();
        const next = stats[index + 1] && term(stats[index + 1]!).getBoundingClientRect();
        const distance = (a: DOMRect, b: DOMRect) =>
          Math.hypot(a.left - b.left, Math.max(0, a.top - b.bottom, b.top - a.bottom));
        return [distance(value, own), next ? distance(value, next) : Infinity];
      });
    }),
  );
  expect(pairs.length).toBeGreaterThan(3);
  for (const [own, next] of pairs) expect(own!).toBeLessThan(next!);
  // A figure whose words are a statement comes first, above them, never as a sentence's tail.
  const firsts = await page.evaluate(() =>
    [...document.querySelectorAll('.pf-stat:has(> dt.pf-stat__value)')].map(
      (stat) =>
        stat.querySelector('.pf-stat__value')!.getBoundingClientRect().bottom <=
        stat.querySelector(':scope > dd:not(.pf-stat__note)')!.getBoundingClientRect().top,
    ),
  );
  expect(firsts.length).toBeGreaterThan(0);
  for (const first of firsts) expect(first).toBe(true);
  // A note is set quieter than the figure and its words, in the caption role.
  const sizes = await page.evaluate(() => {
    const stat = document.querySelector('.pf-stat:has(.pf-stat__note)')!;
    const size = (selector: string) =>
      Number.parseFloat(getComputedStyle(stat.querySelector(selector)!).fontSize);
    return { note: size('.pf-stat__note'), value: size('.pf-stat__value') };
  });
  expect(sizes.note).toBeLessThan(sizes.value);
});

test("a kit list spaces its items by its own gap, so a composition's grid of it keeps every cell's top level", async ({
  page,
}) => {
  // As Editorial grids its Proof strip: a kit list in a composition's own grid.
  const tops = await page.evaluate(() =>
    ['.pf-list', '.pf-evidence:not(.pf-list, .pf-stats)', '.pf-groups', '.pf-decisions'].map(
      (selector) => {
        const list = [...document.querySelectorAll<HTMLElement>(selector)].sort(
          (a, b) => b.children.length - a.children.length,
        )[0]!;
        const grid = list.cloneNode(true) as HTMLElement;
        // Three equal cells at least, the first item repeated where the list has fewer.
        while (grid.children.length < 3) grid.append(grid.children[0]!.cloneNode(true));
        grid.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px';
        document.querySelector('[data-variant="probe"]')!.append(grid);
        const cells = [...grid.children].slice(0, 3);
        const top = cells.map((cell) => cell.getBoundingClientRect().top);
        // Unstyled, the list's items are an item apart by its gap, with no margin on any.
        const margins = [...list.children].map((item) =>
          Number.parseFloat(getComputedStyle(item).marginTop),
        );
        return {
          selector,
          cells: cells.length,
          level: Math.max(...top) - Math.min(...top),
          margins: Math.max(...margins),
          gap: Number.parseFloat(getComputedStyle(list).rowGap),
        };
      },
    ),
  );
  for (const list of tops) {
    expect(list.cells, list.selector).toBeGreaterThan(1);
    expect(list.level, list.selector).toBeLessThan(0.5);
    expect(list.margins, list.selector).toBe(0);
    expect(list.gap, list.selector).toBeGreaterThan(0);
  }
  // Decisions and tracks keep their numbers.
  every(await computed(page, ':is(.pf-decisions, .pf-tracks)', 'list-style-type'), 'decimal');
  every(await computed(page, ':is(.pf-decisions, .pf-tracks) > li', 'display'), 'list-item');
});

test('a ledger, where a composition opts in, is one figure a row with a dotted leader in the text’s own color (C6)', async ({
  page,
}) => {
  await page.evaluate(() => {
    const ledger = document.createElement('div');
    ledger.className = 'pf-stats--leaders';
    ledger.id = 'ledger';
    ledger.append(document.querySelector('.pf-stats[data-count="4"]')!.cloneNode(true));
    document.querySelector('[data-variant="probe"]')!.append(ledger);
  });
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#ledger .pf-stat')].map((stat) => {
      const leader = getComputedStyle(stat, '::after');
      return {
        width: stat.getBoundingClientRect().width,
        list: stat.parentElement!.getBoundingClientRect().width,
        style: leader.borderBottomStyle,
        color: leader.borderBottomColor,
        text: getComputedStyle(stat).color,
      };
    }),
  );
  expect(rows.length).toBe(4);
  for (const row of rows) {
    expect(row.width).toBeCloseTo(row.list, 0);
    expect(row.style).toBe('dotted');
    // In the text's own color, so it has the text's contrast, well past 3:1.
    expect(row.color).toBe(row.text);
  }
  // A note sits on its own row, under the term and the value.
  const note = await page.evaluate(() => {
    const stat = document.querySelector('#ledger .pf-stat:has(.pf-stat__note)')!;
    const term = stat.querySelector('dt')!.getBoundingClientRect();
    return stat.querySelector('.pf-stat__note')!.getBoundingClientRect().top >= term.bottom;
  });
  expect(note).toBe(true);
});

test("a work's case-study link is its title, its target grown by padding; the entry's text stays selectable, and its cover links as an untabbed duplicate named by its alt", async ({
  page,
}) => {
  const entry = page.locator('.pf-work--linked').first();
  const title = entry.locator('.pf-stretch');
  expect(
    Number.parseFloat(await title.evaluate((a) => getComputedStyle(a).paddingTop)),
  ).toBeGreaterThan(4);
  every(await computed(page, '.pf-stretch', 'content', '::after'), 'none');
  // Nothing covers the summary: the point at its middle is its own text, not a link.
  const hit = await entry.locator('.pf-summary').evaluate((summary) => {
    const box = summary.getBoundingClientRect();
    const element = document.elementFromPoint(box.left + 4, box.top + box.height / 2)!;
    return { inside: summary.contains(element), link: Boolean(element.closest('a')) };
  });
  expect(hit).toEqual({ inside: true, link: false });
  // The cover links as a duplicate out of the tab order, its alt exposed as
  // the link's name, never hidden from assistive technology (WCAG 1.1.1).
  const cover = entry.locator('a.pf-cover-link');
  await expect(cover).not.toHaveAttribute('aria-hidden', /.*/);
  await expect(cover).toHaveAttribute('tabindex', '-1');
  const alt = await cover.locator('img').getAttribute('alt');
  expect(alt?.trim()).toBeTruthy();
  await expect(cover).toHaveAccessibleName(alt!);
  await expect(entry.getByRole('img', { name: alt! })).toHaveCount(1);
  expect(await cover.getAttribute('href')).toBe(await title.getAttribute('href'));
  // The cover sits on the outset track or the entry's width, whichever is narrower.
  const [cover_, outset, box] = await Promise.all([
    entry.locator('img.pf-cover').evaluate((img) => img.getBoundingClientRect().width),
    length(page, 'var(--layout-width-outset)'),
    entry.evaluate((li) => li.getBoundingClientRect().width),
  ]);
  expect(Math.abs(cover_ - Math.min(outset, box))).toBeLessThan(1);
  // The entry reads title, meta, summary, then its cover.
  const order = await entry.evaluate((li) =>
    ['.pf-item__title', '.pf-meta', '.pf-summary', '.pf-figure'].map(
      (selector) => li.querySelector(selector)!.getBoundingClientRect().top,
    ),
  );
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test('a stack spaces its children by the section rhythm, and a shared frame outside one keeps its 3rem gap (G4)', async ({
  page,
}) => {
  const [section, chapter, group] = await Promise.all(
    ['--rhythm-section', '--rhythm-chapter', '--rhythm-group'].map((name) =>
      length(page, `var(${name})`),
    ),
  );
  // At 1240 px wide: 128, 192, and 64 px.
  expect(section).toBeCloseTo(128, 1);
  expect(chapter).toBeCloseTo(192, 1);
  expect(group).toBeCloseTo(64, 1);
  const gaps = await page.evaluate(() =>
    ['s1', 's2', 's3', 's4'].map((id) => {
      const style = getComputedStyle(document.getElementById(id)!);
      return [Number.parseFloat(style.marginTop), Number.parseFloat(style.marginBottom)];
    }),
  );
  [0, chapter, group, section].forEach((expected, index) => {
    expect(Math.abs(gaps[index]![0]! - expected!)).toBeLessThan(0.1);
    expect(gaps[index]![1]).toBe(0);
  });
  // A composition that hasn't moved onto the stack keeps today's section gap.
  expect(
    await page.evaluate(() => getComputedStyle(document.getElementById('unstacked')!).marginBottom),
  ).toBe('48px');
});
