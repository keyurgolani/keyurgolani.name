import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { reflowConditions } from '../quality/lib/a11y/conditions';
import { inPage } from '../quality/lib/a11y/probe';
import { viewportSize } from '../../quality/thresholds';

// Row 62 (the 1440 default cell in full mode, CI 42317170858): under the reflow conditions a closed
// fold's first line, the summary's 4th child, was clipped by its own box ("its own box clips it:
// 687x42 of content in 668x42" at 200% root text, "340x21 in 334x21" at 200% zoom), since it was held
// to one line with an ellipsis. CI's Linux fonts overflowed the fixture's words; macOS's fit them. So
// under each of the harness's own zoom and root-text conditions (reflowConditions) every closed
// fold's first line is given its own words five times over, which overflow one line whatever the
// fonts, and the harness's reflow probe (probe.ts, kind 'reflow') reads the page. A first line that
// wraps fits. One language a file: each is a server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const conditions = reflowConditions().filter((each) => each.rule !== 'reflow');

test('the harness gives a zoom and a root-text condition', () => {
  expect(conditions.map((each) => each.rule).sort()).toEqual(['root-text', 'zoom']);
});

for (const condition of conditions)
  test(
    `a closed fold's first line wraps and fits its box under ${condition.rule} at ${condition.id}`,
    { annotation },
    async ({ page }) => {
      const { width, height } = viewportSize(condition.id);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: condition.scale,
        mobile: false,
      });
      await page.goto('/', { waitUntil: 'networkidle' });
      const firsts = await page.evaluate((text) => {
        if (text !== 1)
          document.documentElement.style.setProperty('font-size', `${text * 100}%`, 'important');
        const all = [
          ...document.querySelectorAll('details[data-ag-fold]:not([open]) .ag-fold__first'),
        ];
        for (const el of all) el.textContent = Array(5).fill(el.textContent?.trim()).join(' ');
        return all.length;
      }, condition.text);
      expect(firsts).toBeGreaterThan(0);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
      const problems = await inPage<{ rule: string; path: string; detail: string }[]>(page, {
        kind: 'reflow',
      });
      const onFirsts = await page.evaluate(
        (each) => each.filter((p) => document.querySelector(p.path)?.matches('.ag-fold__first')),
        problems,
      );
      expect(onFirsts).toEqual([]);
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await cdp.detach();
    },
  );
