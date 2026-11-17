import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { load } from './horizontal-cinema-model';

// Horizontal Cinema's bars speak English round the portfolio's own words: a scene's bottom bar
// ends in "Next:" and the next scene's name, and the scrubber's position reads the scene's name,
// then "N of M". In a right-to-left portfolio the English frame ran right to left with the page:
// "Next:" stood after the name it introduces, its colon pointing away from it, and the position
// read "1 of 12 ,Opening". An English phrase reads left to right, whatever the page, with the name
// inside it kept whole in its own direction. On the mixed contract fixture (Arabic, dir=rtl) at
// 1440 by 900, with the strip live: every scene's "Next:" stands to the left of the name it
// introduces, and the position's "N of M" to the right of the scene's name.

const FIXTURE = contractFixture('mixed');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

test(
  'right to left at 1440 by 900, the bars\' English reads left to right: "Next:" before the name, the name before "N of M"',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const read = await page.evaluate(() => {
      const box = (node: Node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        return rects.length === 0
          ? null
          : {
              left: Math.min(...rects.map((r) => r.left)),
              right: Math.max(...rects.map((r) => r.right)),
            };
      };
      // What follows a lead node inside its parent, as one box.
      const after = (lead: Node) => {
        const range = document.createRange();
        range.setStartAfter(lead);
        range.setEnd(lead.parentNode!, lead.parentNode!.childNodes.length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        return rects.length === 0
          ? null
          : {
              left: Math.min(...rects.map((r) => r.left)),
              right: Math.max(...rects.map((r) => r.right)),
            };
      };
      // Every node inside one, outermost first: where a phrase's words sit, however it's wrapped.
      const within = (root: Node): Node[] => {
        const all: Node[] = [];
        const walker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        );
        for (let node = walker.nextNode(); node; node = walker.nextNode()) all.push(node);
        return all;
      };
      const nexts: string[] = [];
      let named = 0;
      for (const link of document.querySelectorAll<HTMLAnchorElement>('.hc-bar__next')) {
        // "Next:" on its own, then the next scene's name (an intertitle's and the credits' read whole).
        const lead = within(link).find((node) => node.textContent?.trim() === 'Next:');
        if (!lead) continue;
        named += 1;
        const label = box(lead);
        const name = after(lead);
        if (!label || !name) continue;
        if (label.right > name.left + 1)
          nexts.push(
            `${link.closest('.hc-scene')?.id}: "Next:" ${Math.round(label.left)}-${Math.round(label.right)}, its name ${Math.round(name.left)}-${Math.round(name.right)}`,
          );
      }
      const status = document.querySelector('.hc-scrub__status');
      const count = status
        ? within(status).find((node) => /^\d+ of \d+$/.test(node.textContent?.trim() ?? ''))
        : undefined;
      let position: string | null = null;
      if (status && count) {
        const range = document.createRange();
        range.setStart(status, 0);
        range.setEndBefore(count);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        const name = rects.length
          ? {
              left: Math.min(...rects.map((r) => r.left)),
              right: Math.max(...rects.map((r) => r.right)),
            }
          : null;
        const of = box(count);
        if (name && of && name.right > of.left + 1)
          position = `"${status.textContent?.trim()}": the name ${Math.round(name.left)}-${Math.round(name.right)}, "${count.textContent?.trim()}" ${Math.round(of.left)}-${Math.round(of.right)}`;
      }
      return { named, status: Boolean(status && count), nexts, position };
    });
    expect(read.named, 'scenes whose bar names the next scene').toBeGreaterThan(0);
    expect(read.status, 'the live position').toBe(true);
    expect({ nexts: read.nexts, position: read.position }).toEqual({ nexts: [], position: null });
  },
);
