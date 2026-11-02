import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Mission Control on the long-text fixture, under read-only. Its footer link
// shows its URL as its label, one word with no break in it. The colophon
// line is a flex row, whose items keep their min-content: the label breaks
// in the word, so the page keeps the window's width, and no box between it
// and the composition clips it.

const FIXTURE = contractFixture('long-text');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  'long text on a phone: the colophon’s unbroken URL label wraps, unclipped, with no sideways scroll at 390 or 320',
  { annotation },
  async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/', { waitUntil: 'networkidle' });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `the page at ${width} is no wider than the window`,
      ).toBeLessThanOrEqual(width);
      const links = await page.evaluate(() =>
        [...document.querySelectorAll('.mc-colophon__line a')].map((link) => {
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
      );
      const url = links.find((link) => link.text.startsWith('https://longtext.test/an/'));
      expect(url, 'the footer link with the URL label').toBeDefined();
      // It takes more than one line, so it broke rather than ran past the edge.
      expect(url!.lines).toBeGreaterThan(1);
      for (const link of links) {
        expect(link.right, `${link.text} ends inside the window`).toBeLessThanOrEqual(width);
        expect(link.clipped, `nothing clips ${link.text}`).toEqual([]);
      }
    }
  },
);

test(
  'long text on a desk: the sticky status line stays one line, no taller than the offset records scroll to, at 1024, 1280 and 1440 (the P2 review)',
  { annotation },
  async ({ page }) => {
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const bar = await page.evaluate(() => {
        const status = document.querySelector<HTMLElement>('.mc-status')!;
        const record = document.querySelector<HTMLElement>('.mc-main [id]')!;
        const items = [
          ...status.querySelectorAll<HTMLElement>('.mc-status__where, .mc-status__signals > li'),
        ]
          // What it shows: a reading with no room on the line drops below it, out of sight.
          .filter((item) => item.getBoundingClientRect().height > 0)
          .filter(
            (item) => item.getBoundingClientRect().top < status.getBoundingClientRect().bottom - 1,
          );
        return {
          position: getComputedStyle(status).position,
          height: status.getBoundingClientRect().height,
          offset: parseFloat(getComputedStyle(record).scrollMarginTop),
          // One line: every item it shows starts on the same top.
          tops: new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size,
        };
      });
      expect(bar.position, `${width}`).toBe('sticky');
      expect(bar.height, `${width}: the bar fits its offset`).toBeLessThanOrEqual(bar.offset + 0.5);
      expect(bar.tops, `${width}: one line`).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
  },
);
