import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { hoverFindings } from '../quality/lib/a11y/interaction';
import { load } from './horizontal-cinema-model';

// Horizontal Cinema's minimap, under the strip, on the missing-media contract fixture: a chapter's
// link, hovered or focused from the keyboard, names what the chapter holds above it, and hovering the
// minimap quiets the other chapters. The quality cells' hover check read the minimap as hover-only
// at 1024 and 1440: it hovered the minimap's centre, a middle chapter, then focused the minimap's
// first link and found the middle chapter's contents missing. Hovering a chapter and focusing that
// chapter's link show the same, so the hover check, the quality cells' own, finds no parity gap on
// the page, at 1440 by 900 and 1024 by 768, in light.

const FIXTURE = contractFixture('missing-media');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const) {
  test(
    `at ${viewport.width} by ${viewport.height} in light, the minimap's chapters show the same on hover and on focus, and the hover check finds no parity gap`,
    { annotation, tag },
    async ({ page, app }) => {
      await page.setViewportSize(viewport);
      await page.context().addCookies([
        {
          name: 'portfolio_appearance',
          value: new URLSearchParams({ scheme: 'warm-parchment', mode: 'light' }).toString(),
          url: app.origin,
        },
      ]);
      await load(page);
      const links = page.locator('.hc-scrub .hc-minimap__chapter > a');
      expect(await links.count(), 'the minimap has its chapters').toBeGreaterThan(1);
      // Each chapter with contents: hovered, its contents show; focused from the keyboard, the same.
      const shows = (link: Locator) =>
        link.evaluate((el) => {
          const contents = el.querySelector('.hc-minimap__contents');
          return contents ? getComputedStyle(contents).visibility === 'visible' : null;
        });
      const each: { chapter: number; hover: boolean | null; focus: boolean | null }[] = [];
      for (let chapter = 0; chapter < (await links.count()); chapter++) {
        const link = links.nth(chapter);
        await link.hover();
        const hover = await shows(link);
        await page.mouse.move(0, 0);
        await page.keyboard.press('Shift');
        await link.focus();
        const focus = await shows(link);
        await link.blur();
        each.push({ chapter, hover, focus });
      }
      expect(each, 'each chapter on hover and on focus').toEqual(
        each.map(({ chapter, hover }) => ({ chapter, hover, focus: hover })),
      );
      const parity = (await hoverFindings(page)).filter(({ rule }) => rule === 'parity');
      expect(parity, `the hover check's parity findings ${JSON.stringify(parity)}`).toEqual([]);
    },
  );
}
