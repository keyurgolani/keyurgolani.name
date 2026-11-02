import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// The case title at a narrow phone (design review P1-2): no word of the h1 splits across lines,
// at 320 and 360, in the own recipe's face, and the page never scrolls sideways. On the complete
// fixture's case study under the sample's title, under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/work/project-name' },
  { type: 'profile', description: 'read-only' },
];

const SITE_TEXT = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular');
// The work's title as the sample's: "Postmortem", ten letters, is the longest word a 320 column takes.
const TITLED = readFileSync(FIXTURE.files.portfolio, 'utf8').replace(
  '    title: Project name\n',
  '    title: Postmortem Template Kit\n',
);
if (!TITLED.includes('Postmortem Template Kit')) throw new Error('the fixture copy kept its title');
const APP = {
  portfolio: FIXTURE.files.portfolio,
  siteText: SITE_TEXT,
  sourceFiles: {
    ...Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
    'portfolio.yml': TITLED,
  },
};

test.use({ appOptions: APP });

for (const width of [320, 360]) {
  test(
    `at ${width} no word of the case title splits across lines`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto('/work/project-name', { waitUntil: 'networkidle' });
      await expect(page.locator('h1')).toHaveText('Postmortem Template Kit');
      const split = await page.locator('h1').evaluate((h1) => {
        const out: string[] = [];
        const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
            if (tops.size > 1) out.push(match[0]);
          }
        }
        return out;
      });
      expect(split).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    },
  );
}
