import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// P1-10: a hanging figure ends before its words start. On the complete fixture, whose metrics
// carry units their statements don't open ("1,200" in Stat unit, "12" years), the title page's
// proof figures and a chapter's figures hang the number alone, in a column as wide as the widest,
// at a wide screen and a phone. The condition shots found "1,200 Stat unit" printed over its label
// and "12 years" over "tenure summary." Its own file: the app's options are per worker.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'chapters'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/**
 * Every printed hanging figure with its words: where the figure's own glyphs end (a range over
 * its text, so a figure that overflows its box counts) and where its words' box starts.
 */
const figures = () =>
  [...document.querySelectorAll<HTMLElement>('.tp-proof li > .tp-proof__n, .it--figure .it__fig')]
    .filter((figure) => figure.textContent?.trim())
    .map((figure) => {
      const words = figure.nextElementSibling as HTMLElement | null;
      const range = document.createRange();
      range.selectNodeContents(figure);
      const glyphs = range.getBoundingClientRect();
      return {
        figure: figure.textContent!.trim(),
        kind: figure.className,
        end: glyphs.right,
        words: words?.textContent?.trim().slice(0, 24) ?? '',
        start: words ? words.getBoundingClientRect().left : Infinity,
      };
    });

test(
  'P1-10: every hanging figure ends before its words start, on the title page and in a chapter, at 1440 and 390',
  { annotation },
  async ({ page }) => {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      const seen = new Set<string>();
      for (const at of ['/', '/chapters/experience-organization']) {
        await page.goto(at, { waitUntil: 'networkidle' });
        const found = await page.evaluate(figures);
        for (const { kind } of found) seen.add(kind.split(' ')[0]!);
        const over = found.filter(({ end, start }) => end > start + 0.5);
        expect(over, `${at} at ${width}`).toEqual([]);
      }
      // Both renderers were on the page, so the check isn't empty.
      expect([...seen].sort(), `figures seen at ${width}`).toEqual(['it__fig', 'tp-proof__n']);
    }
  },
);

test(
  'the title page reads whole from the first frame: its entrance moves words, never hides them',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForSelector('.tp-title');
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll('.ch-spread--title *')]
        .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))
        // Laid out (not display: none at this width), yet hidden by its own or an ancestor's opacity.
        .filter((el) => el.getClientRects().length > 0)
        .filter((el) => !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
        .map((el) => `${el.localName}.${el.className}`)
        .filter((name) => !/ch-sr/.test(name)),
    );
    expect(hidden).toEqual([]);
  },
);

test(
  "the fore-edge's closed labels stand over nothing the pointer or a hit test can reach (the quality cell's focus perimeter)",
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const reached = await page.evaluate(() => {
      // As the harness hit-tests a cover: with pointer events forced on, so a layer that only
      // lets the pointer through still counts.
      const labels = [...document.querySelectorAll<HTMLElement>('.ch-edge__label')];
      for (const el of document.querySelectorAll<HTMLElement>('.ch-edge__label, .ch-edge__label *'))
        el.style.setProperty('pointer-events', 'auto', 'important');
      return {
        count: labels.length,
        hit: labels
          .filter((label) => {
            const r = label.getBoundingClientRect();
            const points = [0.1, 0.5, 0.9].flatMap((fx) =>
              [0.2, 0.5, 0.8].map((fy) => [r.left + r.width * fx, r.top + r.height * fy] as const),
            );
            return points.some(([x, y]) =>
              document.elementsFromPoint(x, y).some((layer) => label.contains(layer)),
            );
          })
          .map((label) => label.textContent?.trim().slice(0, 40)),
      };
    });
    expect(reached.count).toBeGreaterThan(1);
    expect(reached.hit).toEqual([]);
  },
);

test(
  'in print the page is no wider than the window at 1440 and 390, home and a chapter, and every fore-edge link keeps its name',
  { annotation },
  async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const at of ['/', '/chapters/experience-organization']) {
        await page.goto(at, { waitUntil: 'networkidle' });
        const where = `${at} at ${width}, print`;
        const size = await page
          .locator('html')
          .evaluate((html) => ({ scroll: html.scrollWidth, client: html.clientWidth }));
        expect(size.scroll, where).toBeLessThanOrEqual(size.client);
        // The fore-edge prints on a wide page; under 60rem the top bar stands for it, and the
        // fore-edge isn't rendered at all.
        const links = await page.locator('.ch-edge a:visible').all();
        if (width >= 960) expect(links.length, where).toBeGreaterThan(1);
        for (const link of links) await expect(link, where).toHaveAccessibleName(/\S/);
      }
    }
  },
);
