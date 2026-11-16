import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '../harness/fixtures';
import { annotation, openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

// Swiss Signal sets its large parentheticals, a heading's count, a part's contents and the poster's
// aside, in the signal colour. Each passes axe's color-contrast (WCAG 1.4.3, large text 3:1, the
// quality cells' axe rule), on screen and on paper, under Pastel Sorbet, whose accent is a light
// pink on a pale ground.

test.use({ appOptions: servingSwissSignal() });

const CASES: readonly { tuple: Tuple; width: number; height: number; print?: boolean }[] = [
  {
    tuple: 'platform-neutral/pastel-sorbet/humanist-ui/dark',
    width: 1024,
    height: 768,
    print: true,
  },
  { tuple: 'platform-neutral/pastel-sorbet/humanist-ui/system', width: 1440, height: 900 },
  { tuple: 'utility-dense/pastel-sorbet/field-serif/system', width: 390, height: 844 },
];

for (const { tuple, width, height, print } of CASES)
  test(
    `under ${tuple} at ${width}${print ? ' in print' : ''}, every signal parenthetical passes axe's color contrast`,
    { annotation },
    async ({ page, app }) => {
      if (print) await page.emulateMedia({ media: 'print' });
      await page.setViewportSize({ width, height });
      await openTuple(page, app.origin, tuple);
      expect(await page.locator('.ss-paren--signal').count()).toBeGreaterThan(1);
      const results = await new AxeBuilder({ page })
        .withRules(['color-contrast'])
        .include('.ss-paren--signal')
        .analyze();
      const read = (kind: 'passes' | 'violations') =>
        results[kind].flatMap((rule) =>
          rule.nodes.map((node) =>
            `${node.target.join(' ')}: ${node.failureSummary ?? ''}`.slice(0, 220),
          ),
        );
      expect(
        read('passes').length + read('violations').length,
        'axe read the parentheticals',
      ).toBeGreaterThan(1);
      expect(read('violations')).toEqual([]);
    },
  );
