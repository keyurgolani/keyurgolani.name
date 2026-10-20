import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, test } from '../harness/fixtures';

// A right-to-left portfolio (#4): the mixed-practice profession pair, in
// Arabic, with its talks hidden by the site document.

const MIXED = fileURLToPath(
  new URL('../../packages/schema/src/__fixtures__/pairs/mixed/yaml/', import.meta.url),
);
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({
  appOptions: { portfolio: path.join(MIXED, 'portfolio.yml'), site: path.join(MIXED, 'site.yml') },
});

test(
  '<html lang dir> are the portfolio locale and direction',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('[data-variant]').first()).toHaveAttribute(
      'data-color-scheme',
      'ink-and-paper',
    );
    await expect(page.locator('[id="talks"]')).toHaveCount(0);
    await expect(page.locator('[id="podcast"]')).toHaveCount(1);
  },
);
