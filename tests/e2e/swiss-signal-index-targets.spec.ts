import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '../harness/fixtures';
import { annotation, openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

// Without JavaScript the Index is a contents list after the main content: each part's title over
// its sections' links. On a phone every one of those links is a target 24 px tall, or 24 px from
// the next (WCAG 2.5.8, axe's target-size, the quality cells' no-JavaScript row), under every
// typography: Console Mono's lettering sets a link 20 px tall, flush under its part's title.

test.use({ appOptions: servingSwissSignal() });

const CASES: readonly Tuple[] = [
  'international-grid/coral-lagoon/console-mono/dark',
  'platform-neutral/warm-parchment/console-mono/system',
];

for (const tuple of CASES)
  test(
    `under ${tuple} at 390 without JavaScript, every Index contents link is a 24 px target`,
    { annotation },
    async ({ page, app }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      // Script off for the load, as the cells' row sets it, then on for axe, as theirs does.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
      await openTuple(page, app.origin, tuple);
      await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });
      await expect(page.locator('.ss:not([data-ss-live]) .ss-index__sheet')).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withRules(['target-size'])
        .include('.ss-index__sheet')
        .analyze();
      const failing = results.violations.flatMap((rule) =>
        rule.nodes.map((node) => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`),
      );
      expect(failing).toEqual([]);
      await cdp.detach();
    },
  );
