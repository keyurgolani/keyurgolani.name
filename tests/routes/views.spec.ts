import { expect, test } from '../harness/fixtures';
import { expectNotFoundPage, PUBLIC_FILE, READ_ONLY, readOnlyApp } from './apps';

// A variant's path views at the site root (#5, Slice 4), with the site
// selecting fixture-chapters: a view renders from the server, survives a
// refresh, and works without JavaScript; it's canonical to home and stays
// out of the sitemap. A path only fixture-notes declares is a 307 home,
// anything else is the 404 page, and the catch-all shadows no API or
// metadata route. The 404 page renders from the server, so it works
// without JavaScript too.

test.use({ appOptions: readOnlyApp('fixture-chapters') });

const VIEW = '/chapters/selected-work';

test(
  'a link to a view renders it, and a refresh renders it again',
  { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
  async ({ page, app }) => {
    expect((await page.goto('/'))?.status()).toBe(200);
    await expect(page.locator('[data-variant]')).toHaveAttribute(
      'data-variant',
      'fixture-chapters',
    );
    await expect(page.locator('[data-variant]')).not.toHaveAttribute('data-requested-variant');
    await page
      .getByRole('navigation', { name: 'Chapters' })
      .getByRole('link', { name: 'Selected work' })
      .click();
    await expect(page).toHaveURL(`${app.origin}${VIEW}`);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('Selected work');
    await expect(page.locator('main [data-section-id="selected-work"]')).toBeVisible();
    expect((await page.reload())?.status()).toBe(200);
    await expect(heading).toHaveText('Selected work');
    await expect(page.locator('main [data-section-id="selected-work"]')).toBeVisible();
  },
);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'a view renders from the server, and its links lead from view to view',
    { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
    async ({ page, app }) => {
      expect((await page.goto(VIEW))?.status()).toBe(200);
      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toHaveText('Selected work');
      await page.getByRole('link', { name: 'Get in touch' }).click();
      await expect(page).toHaveURL(`${app.origin}/chapters/contact`);
      await expect(heading).toHaveText('Get in touch');
      await page.getByRole('link', { name: 'Contents' }).click();
      await expect(page).toHaveURL(`${app.origin}/`);
      await expect(heading).toHaveText('Rowan Fixture');
    },
  );
});

test(
  'a view is canonical to home, and stays out of the sitemap',
  { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
  async ({ page, request, app }) => {
    await page.goto(VIEW);
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${app.origin}/`,
    );
    await page.goto('/');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect([...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, url]) => url)).toEqual([
      `${app.origin}/`,
    ]);
  },
);

test(
  'a path only another installed variant declares is a 307 home, which a browser follows',
  { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
  async ({ page, request, app }) => {
    const response = await request.get('/notes', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe('/');
    await page.goto('/notes');
    expect(page.url()).toBe(`${app.origin}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rowan Fixture');
  },
);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'anything else is the 404 page: an undeclared path, a bare view prefix, a work, or a host path',
    { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
    async ({ page }) => {
      for (const path of [
        '/chapters',
        '/chapters/selected-work/more',
        '/chapters/Selected-Work',
        // Longer than a content id, so no chapter: the contract caps a placeholder at 64.
        `/chapters/${'a'.repeat(65)}`,
        '/no-such-view',
        // No slug names a work until #10, its views included.
        '/work/tide-tables',
        '/work/tide-tables/credits',
        // A first segment the host keeps, which no route here answers.
        '/api/nope',
      ]) {
        await expectNotFoundPage(page, path);
      }
    },
  );
});

test(
  "the 404 page's HTML comes whole from the server, even for a path a browser won't open as a page",
  { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
  async ({ request }) => {
    // Chromium won't navigate to /favicon.ico, so this reads the HTML itself.
    for (const path of ['/favicon.ico', '/no-such-view']) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
      expect(response.headers()['content-type'], path).toMatch(/^text\/html/);
      const html = await response.text();
      expect(html, path).toMatch(/<html lang="en"/);
      expect(html, path).toContain('<h1>Page not found</h1>');
    }
  },
);

test(
  'a file in public/ is served, though no route lists its path',
  { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
  async ({ request }) => {
    const response = await request.get(`/${PUBLIC_FILE.name}`, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe(PUBLIC_FILE.text);
  },
);

test(
  'beside the catch-all, every API and metadata route still answers for itself',
  { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
  async ({ request }) => {
    const routes: Array<[path: string, status: number, type: RegExp]> = [
      ['/robots.txt', 200, /^text\/plain/],
      ['/sitemap.xml', 200, /^application\/xml/],
      ['/opengraph-image-12o0cb', 200, /^image\/png/],
      ['/feed.xml', 200, /^application\/rss\+xml/],
      ['/api/health', 200, /^application\/json/],
      ['/api/ready', 200, /^application\/json/],
      ['/api/studio/no.such.operation', 404, /^application\/json/],
    ];
    for (const [path, status, type] of routes) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(status);
      expect(response.headers()['content-type'], path).toMatch(type);
    }
    // This build registers the site's variant, so nothing degrades readiness.
    const ready = await (await request.get('/api/ready')).json();
    expect(ready.status).toBe('ready');
    expect(ready.checks).toContainEqual({ id: 'packs', status: 'ok' });
  },
);
