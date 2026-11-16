import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// A testimonial's attribution sets the name over the role, a line each. The name's link takes
// focus, and its ring reaches its outline-offset plus its outline-width past the link's box. Where
// the role's line began at the name line's foot, its text lay inside that reach: under forced
// colors the role's text plate covered the ring's foot (the testimonial at 390x844, 3 of the
// foot's 170 points at 3:1). The role starts at least a ring's reach and 1px below the name's
// link, at a phone's width and a desktop's. Its own file, since a worker-scoped appOptions can't
// be set in a describe.

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'spatial-bento'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(
    `at ${width}x${height}: a testimonial's role clears its name link's focus ring by 1px`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      // A Tab first, so a link focused from script after it matches :focus-visible.
      await page.keyboard.press('Tab');
      const pairs = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('figcaption.sb-quote__who')].flatMap((who) => {
          const link = who.querySelector<HTMLElement>(':scope > .sb-strong a');
          const role = who.querySelector<HTMLElement>(':scope > .sb-label');
          if (!link || !role || link.getClientRects().length === 0) return [];
          link.focus({ preventScroll: true });
          const style = getComputedStyle(link);
          const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
          const visible = link.matches(':focus-visible');
          const foot = Math.max(...[...link.getClientRects()].map((rect) => rect.bottom));
          const top = role.getBoundingClientRect().top;
          link.blur();
          return [{ name: link.textContent?.trim() ?? '', reach, visible, gap: top - foot }];
        }),
      );
      expect(pairs.length, 'an attribution with a link').toBeGreaterThan(0);
      for (const pair of pairs) {
        expect(pair.visible, `${pair.name}: matches :focus-visible`).toBe(true);
        expect(pair.reach, `${pair.name}: its ring`).toBeGreaterThan(0);
        expect(pair.gap, `${pair.name}: its role under it`).toBeGreaterThanOrEqual(pair.reach + 1);
      }
    },
  );
}
