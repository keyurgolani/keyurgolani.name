import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Rows 97 and 98's reach, Editorial Evidence (lead A): at 390 the case's back matter links, an address each, are
// 17 px tall, under the 24 px target size, and passed axe's target-size only by the spacing exception, at exactly
// 24 px to the link above. With the address set in inline parts (2aa929c81) axe measures the link over its parts'
// rects and finds 22.8 px, and the back matter's second link fails at 390 in every display mode (EE T2: 12 cells;
// EE probe 28: the same box, the same neighbour, the same 6 px gap, either side). A target that rests on spacing at
// exactly the line fails on any 1 px move, so each of these links, the back matter's and the fact sheet's, is a
// target of 24 px on its own. One language a file: each is a server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const LINKS = '.ee-case__matter li > a, .ee-links > a';
const annotation = [{ type: 'route', description: '/work/project-name' }];

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  "at 390, every link in the case's back matter and fact sheet is a target 24 px tall and wide on its own",
  { annotation },
  async ({ page }) => {
    await page.goto('/work/project-name', { waitUntil: 'networkidle' });
    const read = await page.locator(LINKS).evaluateAll((links) =>
      links.map((a) => {
        const r = a.getBoundingClientRect();
        return { text: (a.textContent ?? '').trim(), width: r.width, height: r.height };
      }),
    );
    expect(read.length, 'the back matter and the fact sheet have links').toBeGreaterThanOrEqual(2);
    for (const { text, width, height } of read) {
      expect(height, `"${text}" is ${height} px tall`).toBeGreaterThanOrEqual(24);
      expect(width, `"${text}" is ${width} px wide`).toBeGreaterThanOrEqual(24);
    }
  },
);

test(
  "at 390, axe's target-size passes every link in the case's back matter and fact sheet",
  { annotation },
  async ({ page }) => {
    await page.goto('/work/project-name', { waitUntil: 'networkidle' });
    const results = await new AxeBuilder({ page })
      .withRules(['target-size'])
      .include('.ee-case__matter')
      .include('.ee-links')
      .analyze();
    const failing = results.violations.flatMap((rule) =>
      rule.nodes.map((node) => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`),
    );
    expect(failing).toEqual([]);
  },
);
