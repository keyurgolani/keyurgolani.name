import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';

// Kinetic Cosmos's project page with the root text at 200% (as the root-text condition sets it):
// its title breaks only between words. The title is the stage's display line, a hanging indent
// stepping its lines after the first in; at 200% its size and its indent grew with the root, so a
// word wider than what was left of a line broke inside itself ('na/me', 'dash/boa/rd').

/** The app options that serve fixture `fixture` in Kinetic Cosmos. */
export function servingKineticCosmos(fixture: string) {
  const f = contractFixture(fixture);
  const dir = path.dirname(f.files.portfolio);
  return {
    portfolio: f.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(f.files.site, 'utf8'), 'kinetic-cosmos'),
    sourceFiles: Object.fromEntries(
      f.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

export const annotation = (route: string) => [
  { type: 'route', description: route },
  { type: 'profile', description: 'read-only' },
];

export const WIDTHS = [1024, 1440] as const;

/** Each word of the project page's title that lies on more than one line, with the root text at 200%. */
export async function brokenTitleWords(page: Page, route: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.evaluate(() =>
    document.documentElement.style.setProperty('font-size', '200%', 'important'),
  );
  return page.evaluate(() => {
    const title = document.querySelector<HTMLElement>('.kc-case-stage__title');
    if (!title) return { words: 0, broken: ['no title'] };
    const broken: string[] = [];
    let words = 0;
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // A word between spaces, a slash, an en dash or a hyphen, each a break between words.
      for (const match of (node.textContent ?? '').matchAll(/[^\s/\u2013-]+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
        if (rects.length === 0) continue;
        words += 1;
        const lines = new Set(rects.map((rect) => Math.round(rect.top))).size;
        if (lines > 1) broken.push(`"${match[0]}" on ${lines} lines`);
      }
    }
    return { words, broken };
  });
}
