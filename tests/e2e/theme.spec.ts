import { expect, test } from '../harness/fixtures';

// The fixture's theme is `system`. The pre-hydration script sets data-theme,
// and ThemeProvider must leave the same value after hydration.

test(
  'a stored theme preference survives hydration',
  { annotation: { type: 'route', description: '/' } },
  async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('portfolio:theme', 'dark'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  },
);

test.describe('with a dark OS color scheme', () => {
  test.use({ colorScheme: 'dark' });

  test(
    'the system preference resolves to dark',
    { annotation: { type: 'route', description: '/' } },
    async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    },
  );
});
