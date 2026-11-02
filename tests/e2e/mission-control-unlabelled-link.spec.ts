import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Mission Control on a phone, with a work link that has no label: the link
// shows its address, one word with no break in it, as a flex item of the
// work's actions, whose min-content would be the whole address. It breaks
// in the word, so the page keeps the window's width, and no box between it
// and the composition clips it. The complete fixture, its first work's
// links swapped for one unlabelled deep URL, under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const DEEP =
  'https://unlabelled.test/an/unusually/deep/path/that/keeps/going/and/going/until/it/stops';
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

/** The complete fixture with its first work's links one unlabelled deep URL, in a temp dir. */
function unlabelled() {
  const doc = parse(readFileSync(FIXTURE.files.portfolio, 'utf8')) as {
    works: { links?: { url: string }[] }[];
  };
  doc.works[0]!.links = [{ url: DEEP }];
  const portfolio = path.join(mkdtempSync(path.join(tmpdir(), 'mc-unlabelled-')), 'portfolio.yml');
  writeFileSync(portfolio, stringify(doc));
  return portfolio;
}

test.use({
  appOptions: {
    portfolio: unlabelled(),
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  'a work link with no label on a phone: its address wraps, unclipped, with no sideways scroll at 390 or 320',
  { annotation },
  async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/', { waitUntil: 'networkidle' });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `the page at ${width} is no wider than the window`,
      ).toBeLessThanOrEqual(width);
      const links = await page.evaluate(
        (deep) =>
          [...document.querySelectorAll<HTMLAnchorElement>('.mc-actions a')]
            .filter((link) => link.href === deep)
            .map((link) => {
              const clipped: string[] = [];
              for (
                let box = link.parentElement;
                box && !box.matches('[data-variant]');
                box = box.parentElement
              ) {
                const { overflowX } = getComputedStyle(box);
                if (overflowX !== 'visible') clipped.push(`${box.className}: ${overflowX}`);
              }
              // An inline box has one client rect per line it sits on.
              const lines = new Set([...link.getClientRects()].map((rect) => Math.round(rect.top)));
              const { right } = link.getBoundingClientRect();
              return { text: link.textContent ?? '', right, lines: lines.size, clipped };
            }),
        DEEP,
      );
      expect(links.length, 'the unlabelled link is on the page').toBeGreaterThan(0);
      for (const link of links) {
        expect(link.text, 'it shows its address').toContain('unlabelled.test/an/unusually');
        // It takes more than one line, so it broke rather than ran past the edge.
        expect(link.lines).toBeGreaterThan(1);
        expect(link.right, 'it ends inside the window').toBeLessThanOrEqual(width);
        expect(link.clipped, 'nothing clips it').toEqual([]);
      }
    }
  },
);
