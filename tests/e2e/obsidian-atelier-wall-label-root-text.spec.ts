import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Obsidian Atelier: the quality cells obsidian-atelier missing-media / x platform-neutral (system,
// light, dark and high contrast) record reflow/root-text at 1024x768: with the root text at 200%, the wall label
// of the work with a missing picture (two fixed page columns, about 122 px) grows to its longest word, so its
// spans pass the wall's edge and .oa-wall's overflow-x clip cuts them off. At 1024 with the root text at 200%,
// as the root-text condition sets it (conditions.ts: the root's font-size at 200%, important), every span of
// that label ends inside its wall. One language a file: each is a server of its own.

const FIXTURE = contractFixture('missing-media');
const DIR = path.dirname(FIXTURE.files.portfolio);
const LABEL = '[id="oa--label-a-project-with-a-missing-picture"]';

test.use({
  viewport: { width: 1024, height: 768 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'obsidian-atelier')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  'at 1024 with the root text at 200%, the wall label of the work with a missing picture ends inside its wall',
  { annotation: [{ type: 'route', description: '/' }] },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator(LABEL)).toHaveCount(1);
    await page.evaluate(() =>
      document.documentElement.style.setProperty('font-size', '200%', 'important'),
    );
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const read = await page.locator(LABEL).evaluate((label) => {
      const wall = label.closest('.oa-wall')!.getBoundingClientRect();
      return {
        wall: [wall.left, wall.right],
        spans: [...label.querySelectorAll(':scope > span')].map((span) => {
          const range = document.createRange();
          range.selectNodeContents(span);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          return {
            text: (span.textContent ?? '').trim().slice(0, 30),
            right: Math.max(...rects.map((r) => r.right)),
            left: Math.min(...rects.map((r) => r.left)),
          };
        }),
      };
    });
    expect(read.spans.length, 'the label has its spans').toBeGreaterThan(0);
    for (const span of read.spans) {
      expect(
        span.right,
        `"${span.text}" ends inside its wall (${read.wall[1]})`,
      ).toBeLessThanOrEqual(read.wall[1]! + 0.5);
      expect(
        span.left,
        `"${span.text}" starts inside its wall (${read.wall[0]})`,
      ).toBeGreaterThanOrEqual(read.wall[0]! - 0.5);
    }
  },
);

// At the reader's own text size the label keeps its place: beside the work, in the hang's last two columns,
// ending at its wall's end, at 1024 and at 1440, so a fix for the root text leaves 1x where it is.
for (const [width, height] of [
  [1024, 768],
  [1440, 900],
] as const)
  test.describe(`at ${width}`, () => {
    test.use({ viewport: { width, height } });
    test(
      `at ${width} at 1x, the wall label of the work with a missing picture hangs beside the work, at its wall's end`,
      { annotation: [{ type: 'route', description: '/' }] },
      async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        await expect(page.locator(LABEL)).toHaveCount(1);
        const read = await page.locator(LABEL).evaluate((label) => {
          const box = (el: Element) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          const work = label.closest('.oa-hang')!.querySelector('.oa-hang__work')!;
          return {
            root: getComputedStyle(document.documentElement).fontSize,
            column: getComputedStyle(label).gridColumnStart,
            label: box(label),
            work: box(work),
            wall: box(label.closest('.oa-wall')!),
          };
        });
        expect(read.root, 'the reader text is the default').toBe('16px');
        expect(read.column, 'the label starts on the hang column after the work').toBe('7');
        expect(read.label.left, 'the label starts past the work').toBeGreaterThanOrEqual(
          read.work.right,
        );
        expect(read.label.top, 'the label is beside the work, not under it').toBeLessThan(
          read.work.bottom,
        );
        expect(
          Math.abs(read.label.right - read.wall.right),
          "the label ends at its wall's end",
        ).toBeLessThanOrEqual(0.5);
      },
    );
  });
