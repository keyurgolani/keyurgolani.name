import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { contrast, decodePng, pixel } from '../quality/lib/pixels';

// Obsidian Atelier under forced colors, on the complete contract fixture at
// 1440: a link focused from the keyboard shows its whole ring. Every line of
// text there stands on a backplate of the canvas, which painted over the foot
// of the ring of the link above it (a caption's date under its title). Each
// edge of the ring is checked along its length, against the same place
// unfocused. Primer's ring, 1px off the edge, lay on an underline: that's the
// language's own offset (primer-inspired 1.0.7), so its cells hold it.

/** The app options that serve the complete fixture through Atelier, in a design language. */
function serving(language: string) {
  const fixture = contractFixture('complete');
  const dir = path.dirname(fixture.files.portfolio);
  return {
    portfolio: fixture.files.portfolio,
    siteText: fixtureSiteSelecting(
      readFileSync(fixture.files.site, 'utf8'),
      'obsidian-atelier',
    ).replace(/^(\s+)designLanguage: platform-neutral$/m, `$1designLanguage: ${language}`),
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const LINKS = [
  'Episode title',
  'The plan of the exhibition',
  'Stat source',
  'Quote source',
  'Recording title',
];

/** The share of each edge of the link's ring, along its length, drawn 2 pixels deep at 3:1 against the link unfocused. */
async function ringEdges(page: Page, link: Locator) {
  await link.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const box = (await link.boundingBox())!;
  const clip = {
    x: Math.floor(box.x) - 12,
    y: Math.floor(box.y) - 12,
    width: Math.ceil(box.width) + 24,
    height: Math.ceil(box.height) + 24,
  };
  const before = decodePng(await page.screenshot({ clip }));
  await page.keyboard.press('Shift');
  await link.focus();
  expect(await link.evaluate((a) => a.matches(':focus-visible'))).toBe(true);
  const ring = await link.evaluate((a) => {
    const s = getComputedStyle(a);
    return { width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset) };
  });
  const after = decodePng(await page.screenshot({ clip }));
  await link.evaluate((a) => (a as HTMLElement).blur());
  const drawn = (x: number, y: number) => {
    const i = y * after.width + x;
    return contrast(pixel(before, i), pixel(after, i)) >= 3;
  };
  // The ring's band on each side, in the clip's pixels, a pixel wider each way for snapping.
  const out = ring.offset + ring.width;
  const left = box.x - clip.x - out,
    right = box.x - clip.x + box.width + out;
  const top = box.y - clip.y - out,
    bottom = box.y - clip.y + box.height + out;
  const share = (along: [number, number], across: [number, number], vertical: boolean) => {
    let whole = 0,
      all = 0;
    for (let a = Math.ceil(along[0]) + 2; a <= Math.floor(along[1]) - 3; a++) {
      let deep = 0;
      for (let c = Math.floor(across[0]) - 1; c <= Math.ceil(across[1]); c++)
        if (vertical ? drawn(c, a) : drawn(a, c)) deep++;
      all++;
      if (deep >= Math.min(2, ring.width)) whole++;
    }
    return Math.round((whole / all) * 100) / 100;
  };
  return {
    top: share([left, right], [top, top + ring.width], false),
    bottom: share([left, right], [bottom - ring.width, bottom], false),
    left: share([top, bottom], [left, left + ring.width], true),
    right: share([top, bottom], [right - ring.width, right], true),
  };
}

// The fixture's own language; the cells hold the rest, the caption's date the same in each.
const LANGUAGE = 'platform-neutral';
test.use({ appOptions: serving(LANGUAGE), viewport: { width: 1440, height: 900 } });

test(
  'under forced colors a focused link shows its whole ring, the line after it and its underline clear of it',
  { annotation },
  async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-variant]')).toHaveAttribute(
      'data-variant',
      'obsidian-atelier',
    );
    // A closed fold holds some of them: open every one, so each is in reach.
    await page.evaluate(() =>
      document.querySelectorAll('details').forEach((each) => (each.open = true)),
    );
    for (const name of LINKS) {
      const links = page.getByRole('link', { name, exact: true });
      const count = await links.count();
      expect(count, name).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const edges = await ringEdges(page, links.nth(i));
        for (const [edge, value] of Object.entries(edges))
          expect(
            value,
            `${name} ${i + 1} of ${count}: its ring's ${edge} edge, drawn whole`,
          ).toBeGreaterThanOrEqual(0.95);
      }
    }
  },
);
