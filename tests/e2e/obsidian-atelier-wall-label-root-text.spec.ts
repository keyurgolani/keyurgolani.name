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
