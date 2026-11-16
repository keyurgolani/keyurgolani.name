import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { home, SUMMARY } from './obsidian-atelier-appearance';

// Obsidian Atelier's chrome lay over a band of fixed height at the entrance's top: with the root
// text at 200% on a phone, a name that wraps to more lines than the band holds ran past it and over
// the entrance's plaque. At 390 on phone emulation with the root text at 200%, on the long-text
// contract fixture's home, whose name is a run of hyphenated surnames, every line of the chrome's
// name and the Appearance summary stand above the entrance's first part, and the name clears the
// summary.
// In Warm Parchment, light.

const FIXTURE = contractFixture('long-text');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(
      readFileSync(FIXTURE.files.site, 'utf8'),
      'obsidian-atelier',
    ).replace(/colorScheme: .*/, 'colorScheme: warm-parchment'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test(
  'at 390 with the root text at 200%, every line of a long name and the Appearance summary stand above the entrance',
  { annotation },
  async ({ page, app }) => {
    await home(page, app.origin, { mode: 'light', rootText: '200%' });
    const read = await page.evaluate((summary) => {
      const r = (n: number) => Math.round(n * 10) / 10;
      const box = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return [r(b.left), r(b.top), r(b.right), r(b.bottom)];
      };
      return {
        pageWide: document.scrollingElement!.scrollWidth,
        chrome: box('.oa-chrome'),
        mark: box('.oa-chrome__mark'),
        summary: box(summary),
        // The entrance's first part: the top of the highest of its children.
        entrance: (() => {
          const tops = [...document.querySelectorAll('.oa-entrance > *')]
            .map((el) => el.getBoundingClientRect())
            .filter((b) => b.width > 0 && b.height > 0)
            .map((b) => b.top);
          return tops.length > 0 ? r(Math.min(...tops)) : null;
        })(),
      };
    }, SUMMARY);
    const { mark, summary, entrance } = read;
    expect(
      {
        found: mark !== null && summary !== null && entrance !== null,
        nameAboveTheEntrance: mark !== null && entrance !== null && mark[3]! <= entrance + 0.5,
        summaryAboveTheEntrance:
          summary !== null && entrance !== null && summary[3]! <= entrance + 0.5,
        nameClearsTheSummary:
          mark !== null &&
          summary !== null &&
          !(
            mark[0]! < summary[2]! &&
            summary[0]! < mark[2]! &&
            mark[1]! < summary[3]! &&
            summary[1]! < mark[3]!
          ),
      },
      JSON.stringify(read),
    ).toEqual({
      found: true,
      nameAboveTheEntrance: true,
      summaryAboveTheEntrance: true,
      nameClearsTheSummary: true,
    });
  },
);
