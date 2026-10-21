import { expect, test } from '../harness/fixtures';

// The host starts visitors at the site's display mode, `system` here. The
// pre-hydration script sets data-theme, and nothing may change it after
// hydration: the fallback composition has no theme toggle, and #19's visitor
// control replaces each variant's own.

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
