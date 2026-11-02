import { expect, test } from '../harness/fixtures';
import { READ_ONLY, readOnlyApp } from './apps';

// A site selecting a variant this build doesn't register (#5, Slice 4): the
// fallback composition renders home, and declares no view, so a path an
// installed variant declares redirects home, and nothing else resolves.

test.use({ appOptions: readOnlyApp('missing-variant') });

test(
  "an installed variant's views redirect home while the fallback composition stands in",
  { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
  async ({ request, page }) => {
    for (const path of ['/chapters/selected-work', '/notes']) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(307);
      expect(response.headers().location, path).toBe('/');
    }
    expect((await request.get('/no-such-view', { maxRedirects: 0 })).status()).toBe(404);
    expect((await page.goto('/'))?.status()).toBe(200);
    const root = page.locator('[data-variant]');
    await expect(root).toHaveAttribute('data-variant', 'fallback');
    await expect(root).toHaveAttribute('data-requested-variant', 'missing-variant');
  },
);
