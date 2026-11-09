import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { readPoster, rootAt200 } from './swiss-signal-poster';

// Row 127, Swiss Signal, the floor: a case whose title has a ten-letter word, POSTMORTEM. With the root text at
// 200% at 320 the column (about 7.75em at body size) is narrower than that word's fit at body size wants, so
// the display type holds body size, and the word may break (hyphenated, where the browser has the language's
// dictionary) but still ends inside its column; at 390 it fits on one line above body size. The complete
// fixture, its first work's title swapped, under the default tuple. One language a file: each is a server of
// its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

/** The complete fixture with its first work (project-name) titled "Postmortem kit", in a temp dir. */
function postmortem() {
  const doc = parse(readFileSync(FIXTURE.files.portfolio, 'utf8')) as {
    works: { slug: string; title: string }[];
  };
  const work = doc.works.find((w) => w.slug === 'project-name')!;
  work.title = 'Postmortem kit';
  const portfolio = path.join(mkdtempSync(path.join(tmpdir(), 'ss-hero-floor-')), 'portfolio.yml');
  writeFileSync(portfolio, stringify(doc));
  return portfolio;
}

test.use({
  appOptions: {
    portfolio: postmortem(),
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

for (const [width, height] of [
  [390, 844],
  [320, 568],
] as const)
  test.describe(`at ${width}`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });
    test(
      `with the root text at 200% at ${width}, a case titled with a ten-letter word keeps it inside its column, at body size or more`,
      { annotation: [{ type: 'route', description: '/work/project-name' }] },
      async ({ page }) => {
        await page.goto('/work/project-name', { waitUntil: 'networkidle' });
        await expect(page.locator('.ss')).toHaveAttribute('data-ss-live', '');
        await rootAt200(page);
        const read = await page.evaluate(readPoster);
        expect(
          read.words.map((w) => w.word.toUpperCase()),
          'the title is the swapped one',
        ).toContain('POSTMORTEM');
        expect(read.size, 'the display type is body size or more').toBeGreaterThanOrEqual(
          read.body - 0.5,
        );
        const column = read.lineRight - read.lineLeft;
        for (const w of read.words) {
          if (w.atFloor <= column + 0.5) expect(w.lines, `"${w.word}" sits on one line`).toBe(1);
          expect(
            w.right,
            `"${w.word}" ends inside its column (hyphens ${read.hyphens}, ${w.lines} line(s), ${Math.round(w.atFloor)} px at body size in ${Math.round(column)})`,
          ).toBeLessThanOrEqual(read.lineRight + 0.5);
        }
      },
    );
  });
