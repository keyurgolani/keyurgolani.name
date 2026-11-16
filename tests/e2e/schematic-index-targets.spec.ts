import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '../harness/fixtures';
import { annotation, openTuple, servingSchematic, type Tuple } from './schematic-tuples';

// The drawing index's links in the footer and a sheet's list of its views, a view's number and title
// each, set one under another or wrapped in rows, are targets 24 px tall, or 24 px apart, under every
// typography (WCAG 2.5.8, axe's target-size, the quality cells' rule). Paste-Up's and Shell Mono's
// lettering sets a row under 24 px, which the lists' own gaps didn't make up.

test.use({ appOptions: servingSchematic() });

const CASES: readonly { tuple: Tuple; width: number; height: number; more?: boolean }[] = [
  { tuple: 'glassmorphism/forest-moss/paste-up/system', width: 1024, height: 768, more: true },
  { tuple: 'raw-brutalist/pastel-sorbet/paste-up/dark', width: 1440, height: 900 },
  { tuple: 'carbon-inspired/aurora-meadow/shell-mono/dark', width: 1440, height: 900 },
];

for (const { tuple, width, height, more } of CASES)
  test(
    `under ${tuple} at ${width}${more ? ' with more contrast' : ''}, every drawing index and sheet view link is a 24 px target`,
    { annotation },
    async ({ page, app }) => {
      if (more) await page.emulateMedia({ contrast: 'more' });
      await page.setViewportSize({ width, height });
      await openTuple(page, app.origin, tuple);
      const links = page.locator('.sx-index__list a');
      expect(await links.count(), 'the footer holds the drawing index').toBeGreaterThan(5);
      const results = await new AxeBuilder({ page })
        .withRules(['target-size'])
        .include('.sx-index__list')
        .include('.sx-sheet__views')
        .analyze();
      const failing = results.violations.flatMap((rule) =>
        rule.nodes.map((node) => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`),
      );
      expect(failing).toEqual([]);
    },
  );
