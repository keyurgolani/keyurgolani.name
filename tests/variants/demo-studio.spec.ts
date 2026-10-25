import { expect, test } from '../harness/fixtures';
import { openTask } from '../harness/studio-tasks';
import { COMPARE_SCREENSHOTS, DEMO } from './target';

// Demo Studio's Content task (#9) as a screenshot: its panel, the picker and
// Export setup with their hints, before anything is imported, and never the
// frame beside it, which the composition projects screenshot on their own.
// Attached to the report everywhere, and compared against
// tests/variants/__screenshots__/demo-studio-content.png only in the pinned
// image, where CI's variants job sets PORTFOLIO_SCREENSHOTS=compare. A
// missing baseline fails that job, which writes it and uploads it in its
// shard's variants-screenshots artifact, to be committed as it is.

test(
  "Demo Studio's Content task, its picker and Export setup, looks as its baseline does",
  { annotation: [{ type: 'route', description: '/studio' }, DEMO] },
  async ({ page }, testInfo) => {
    const response = await page.goto('/studio');
    expect(response?.status()).toBe(200);
    await openTask(page, 'Content');
    const panel = page.locator('.studio-content');
    await expect(panel).toBeVisible();
    await expect(page.locator('#studio-demo-import')).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    const options = { animations: 'disabled', caret: 'hide' } as const;
    await testInfo.attach('demo-studio-content.png', {
      body: await panel.screenshot(options),
      contentType: 'image/png',
    });
    if (COMPARE_SCREENSHOTS) {
      await expect(panel).toHaveScreenshot('demo-studio-content.png', options);
    }
  },
);
