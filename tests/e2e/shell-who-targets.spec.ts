import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Shell's whoami block, the key and value lines under the name: mail, the proof lines (a figure and
// what it counts, each linking to its record) and the links. Under a type whose line is under 24 px
// (Geometric Display sets Shell's line at 17 px) each link was 17 px tall: the proof list's lines
// stand a target apart, but its first link sat flush under the mail line's, so axe's target-size
// failed it on both size and spacing, at 1440, 1024 and 390, in every mode. Each link here is a
// target of 24 px on its own, so none rests on the spacing to the line above. On the complete
// contract fixture, Atelier Luxury on Low-Stimulus Warm in Geometric Display, dark.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const LINKS = '.sh-who .sh-kv a[href]';
const annotation = [{ type: 'route', description: '/' }];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'shell')
      .replace(/designLanguage: .*/, 'designLanguage: atelier-luxury')
      .replace(/colorScheme: .*/, 'colorScheme: low-stimulus-warm')
      .replace(/typography: .*/, 'typography: geometric-display')
      .replace(/displayMode: .*/, 'displayMode: dark'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

for (const viewport of VIEWPORTS) {
  test(
    `at ${viewport.width}, every link in the whoami block's key and value lines is a target 24 px tall and wide on its own`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ contrast: 'more' });
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator('[data-variant]').first()).toHaveAttribute('data-variant', 'shell');
      const read = await page.locator(LINKS).evaluateAll((links) =>
        links.map((a) => {
          const r = a.getBoundingClientRect();
          return { text: (a.textContent ?? '').trim(), width: r.width, height: r.height };
        }),
      );
      expect(
        read.some(({ text }) => text.startsWith('1,200')),
        'the proof lines link the fixture metric',
      ).toBe(true);
      const short = read.filter(({ width, height }) => width < 24 || height < 24);
      expect(short, `links under 24 by 24 px: ${JSON.stringify(read)}`).toEqual([]);
    },
  );

  test(
    `at ${viewport.width}, axe's target-size passes every link in the whoami block`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ contrast: 'more' });
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator(LINKS).first()).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withRules(['target-size'])
        .include('.sh-who')
        .analyze();
      const failing = results.violations.flatMap((rule) =>
        rule.nodes.map((node) => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`),
      );
      expect(failing).toEqual([]);
    },
  );
}
