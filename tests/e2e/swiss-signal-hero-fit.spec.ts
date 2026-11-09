import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { readPoster, rootAt200 } from './swiss-signal-poster';

// Row 127, Swiss Signal: with the root text at 200% on a phone (390 and 320) the poster line's display type
// (the home hero, a case's title) kept its rem step and broke inside its words ("PRA / CTIC / E" at 320,
// "PRAC / TICE" at 390, D's look packet on fec718095). The coordinator's ruling: the display type is sized from
// its column, so its longest word fits; it breaks only between words; it never falls under body size, and only
// a word wider than its column at that floor may break (hyphenated, where the browser can), and it still ends
// inside its column. On a desktop at 1x no word is split either. The floor itself: the hero-floor spec.
// Set as the quality cells' root-text condition sets it (conditions.ts: the root's font-size at 200%,
// important). One language a file: each is a server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'swiss-signal')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const PAGES = [
  ['the home hero', '/'],
  ["a case's title", '/work/project-name'],
] as const;

for (const [width, height] of [
  [390, 844],
  [320, 568],
] as const)
  test.describe(`at ${width}`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });
    for (const [name, route] of PAGES)
      test(
        `with the root text at 200% at ${width}, ${name} breaks only between its words, at body size or more, inside its column`,
        { annotation: [{ type: 'route', description: route }] },
        async ({ page }) => {
          await page.goto(route, { waitUntil: 'networkidle' });
          await expect(page.locator('.ss')).toHaveAttribute('data-ss-live', '');
          await rootAt200(page);
          const read = await page.evaluate(readPoster);
          expect(read.words.length, 'the poster line has words').toBeGreaterThan(0);
          expect(read.size, 'the display type is body size or more').toBeGreaterThanOrEqual(
            read.body - 0.5,
          );
          const column = read.lineRight - read.lineLeft;
          for (const w of read.words) {
            // A word wider than its column at the floor may break (hyphenated, if the browser can); any
            // other sits on one line. Every word ends inside its column either way.
            if (w.atFloor <= column + 0.5) expect(w.lines, `"${w.word}" sits on one line`).toBe(1);
            expect(
              w.right,
              `"${w.word}" ends inside its column (hyphens ${read.hyphens}, ${w.lines} line(s))`,
            ).toBeLessThanOrEqual(read.lineRight + 0.5);
          }
        },
      );
  });

for (const [width, height] of [
  [1024, 768],
  [1440, 900],
] as const)
  test.describe(`at ${width}`, () => {
    test.use({ viewport: { width, height } });
    for (const [name, route] of PAGES)
      test(
        `at ${width}, ${name} splits none of its words`,
        { annotation: [{ type: 'route', description: route }] },
        async ({ page }) => {
          await page.goto(route, { waitUntil: 'networkidle' });
          await expect(page.locator('.ss')).toHaveAttribute('data-ss-live', '');
          const read = await page.evaluate(readPoster);
          expect(read.words.length, 'the poster line has words').toBeGreaterThan(0);
          for (const w of read.words) expect(w.lines, `"${w.word}" sits on one line`).toBe(1);
        },
      );
  });
