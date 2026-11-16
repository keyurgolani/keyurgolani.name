import { expect, test } from '../harness/fixtures';
import { reflowFindings } from '../quality/lib/a11y/conditions';
import { annotation, openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

// Swiss Signal under 200% root text at 1024 (WCAG 1.4.4, 1.4.10, the quality cells' root-text
// reflow): the harness's own reflow check finds nothing on the home page, no sideways scroll among
// it, under Accessible Reading's lettering, the largest the packs set.

test.use({ appOptions: servingSwissSignal() });

const CASES: readonly Tuple[] = [
  'memphis/neon-city/accessible-reading/dark',
  'platform-neutral/warm-parchment/accessible-reading/system',
];

for (const tuple of CASES)
  test(
    `under ${tuple}, the reflow check finds nothing under 200% root text at 1024`,
    { annotation },
    async ({ page, app }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openTuple(page, app.origin, tuple);
      const findings = (await reflowFindings(page, '/')).filter(
        (each) => each.rule === 'root-text' || each.gate !== 'reflow',
      );
      expect(
        findings.map((each) => `${each.viewport ?? ''} ${each.path ?? ''}: ${each.actual}`),
      ).toEqual([]);
    },
  );
