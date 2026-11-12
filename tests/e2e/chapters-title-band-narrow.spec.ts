import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Row 118 (#211; second probe kgn-b-r118b-1b10a1fa, 2026-11-11): Chapters' title page on a
// portfolio with no signature work (missing-media), at 390. The spread is the solo title spread
// (.ch-spread--solo), and the band along its foot, .tp-band, has a content box 0 px wide: its verso,
// .tp-band__v, reads rect [20, 109, 0, 607], and the who-line in it, .tp-who, [20, 128, 0, 588], its
// words stacked one under another. The contrast check reads "it has no box in the viewport to
// sample" there, in every mode. At 390, light and system: the band's content box is at least half
// the spread's, the who-line's column at least half the band's, and the line wraps into no more
// lines than its words need at that width (one more for where a word breaks).

const FIXTURE = contractFixture('missing-media');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'chapters'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  colorScheme: 'light',
});

for (const mode of ['light', 'system'] as const) {
  test(
    `in ${mode} at 390, the title page's band and its who-line have their column's width, on a portfolio with no signature work (row 118)`,
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page, app }) => {
      await page.context().addCookies([
        {
          name: 'portfolio_appearance',
          value: new URLSearchParams({ scheme: 'warm-parchment', mode }).toString(),
          url: app.origin,
        },
      ]);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const boundary = page.locator('[data-variant]').first();
      await expect(boundary).toHaveAttribute('data-variant', 'chapters');
      await expect(boundary).toHaveAttribute('data-display-mode', mode);
      await expect(page.locator('.ch-spread--title.ch-spread--solo')).toHaveCount(1);
      await expect(page.locator('.tp-band .tp-who')).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      const read = await page.evaluate(() => {
        const content = (el: Element) => {
          const style = getComputedStyle(el);
          return (
            el.getBoundingClientRect().width -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight) -
            parseFloat(style.borderLeftWidth) -
            parseFloat(style.borderRightWidth)
          );
        };
        const spread = document.querySelector('.ch-spread--title')!;
        const band = spread.querySelector('.tp-band')!;
        const verso = band.querySelector('.tp-band__v')!;
        const who = band.querySelector<HTMLElement>('.tp-who')!;
        const range = document.createRange();
        range.selectNodeContents(who);
        const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        // The line's words on one line, in its own font, to count the lines they need.
        const probe = who.cloneNode(true) as HTMLElement;
        Object.assign(probe.style, {
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'nowrap',
          inlineSize: 'auto',
          maxInlineSize: 'none',
        });
        who.parentElement!.appendChild(probe);
        const oneLine = probe.getBoundingClientRect().width;
        probe.remove();
        return {
          spread: content(spread),
          band: content(band),
          column: content(verso),
          who: who.getBoundingClientRect().width,
          lines,
          oneLine,
          tracks: getComputedStyle(spread).gridTemplateColumns,
        };
      });
      const why = `tracks ${read.tracks}; spread ${read.spread}, band ${read.band}, column ${read.column}, who ${read.who}`;
      expect(read.band, `the band's content box: ${why}`).toBeGreaterThanOrEqual(read.spread / 2);
      expect(read.column, `the who-line's column: ${why}`).toBeGreaterThanOrEqual(read.band / 2);
      expect(
        read.lines,
        `its lines, its words needing ${read.oneLine} px on one line: ${why}`,
      ).toBeLessThanOrEqual(Math.ceil(read.oneLine / Math.max(read.column, 1)) + 1);
    },
  );
}
