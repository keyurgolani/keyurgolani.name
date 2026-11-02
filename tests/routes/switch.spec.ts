import { expect, test } from '../harness/fixtures';
import { READ_ONLY, readOnlyApp } from './apps';

// After the site switches from fixture-chapters to fixture-notes (#5, Slice
// 4): the new variant's view renders, and the chapters a visitor bookmarked
// redirect home, since fixture-chapters, still installed, declares them.

test.use({ appOptions: readOnlyApp('fixture-notes') });

test(
  "the old variant's views are a 307 home, which a browser follows",
  { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
  async ({ page, request, app }) => {
    for (const path of ['/chapters/selected-work', '/chapters/contact']) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(307);
      expect(response.headers().location, path).toBe('/');
    }
    await page.goto('/chapters/selected-work');
    expect(page.url()).toBe(`${app.origin}/`);
    await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'fixture-notes');
  },
);

test(
  "the new variant's view renders, survives a refresh, and is canonical to home",
  { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
  async ({ page, app }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Pages' })
      .getByRole('link', { name: 'Notes' })
      .click();
    await expect(page).toHaveURL(`${app.origin}/notes`);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('Notes');
    await expect(page.getByRole('main').getByRole('listitem')).toHaveText([
      'Selected work',
      'Get in touch',
    ]);
    expect((await page.reload())?.status()).toBe(200);
    await expect(heading).toHaveText('Notes');
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${app.origin}/`,
    );
  },
);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'the view renders, and an old bookmark lands home',
    { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
    async ({ page, app }) => {
      expect((await page.goto('/notes'))?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notes');
      await page.goto('/chapters/contact');
      expect(page.url()).toBe(`${app.origin}/`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rowan Fixture');
    },
  );
});
