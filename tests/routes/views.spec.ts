import { expect, test } from '../harness/fixtures';
import { headerProblems } from '../harness/route-headers.mjs';
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
  'a view is canonical to home, as home is to itself (#22), and stays out of the sitemap',
  { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
  async ({ page, request, app }) => {
    for (const route of [VIEW, '/']) {
      await page.goto(route);
      await expect(page.locator('head link[rel="canonical"]'), route).toHaveAttribute(
        'href',
        `${app.origin}/`,
      );
      await expect(page.locator('head meta[property="og:url"]'), route).toHaveAttribute(
        'content',
        `${app.origin}/`,
      );
    }
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
        // A slug the live revision doesn't route (#10b), its views included.
        '/work/tide-tables',
        '/work/tide-tables/credits',
        // A first segment the host keeps, which no route here answers.
        '/api/nope',
      ]) {
        await expectNotFoundPage(page, path);
      }
    },
  );

  test(
    "a path under /preview or /preview-assets is never a view, even one naming a view's own path: the 404 page, under the preview's headers (#7)",
    { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
    async ({ page, request }) => {
      for (const path of [
        '/preview',
        '/preview/chapters/selected-work',
        '/preview-assets/chapters/selected-work',
        '/PREVIEW/chapters/selected-work',
      ]) {
        await expectNotFoundPage(page, path);
        const response = await request.get(path, { maxRedirects: 0 });
        expect(headerProblems(new URL(response.url()).pathname, response.headers()), path).toEqual(
          [],
        );
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

test(
  'beside the catch-all, POST /api/appearance answers for itself, and the page it returns to renders in the display mode the visitor chose (#19, Slice 4)',
  {
    annotation: [
      { type: 'route', description: '/api/appearance' },
      { type: 'route', description: '/' },
      READ_ONLY,
    ],
  },
  async ({ request, app }) => {
    // Each page reads the cookie back, the 404 page too, and none may be
    // stored by any cache: Next sets its own Vary on every page, so
    // no-store is what keeps one visitor's appearance from another.
    const pages = [
      ['/', 200],
      ['/?view=all', 200],
      ['/no-such-page', 404],
    ] as const;
    const expectPages = async (mode: 'system' | 'dark', what: string) => {
      for (const [path, status] of pages) {
        const page = await request.get(path, { maxRedirects: 0 });
        expect(page.status(), `${path} ${what}`).toBe(status);
        expect(await page.text(), `${path} ${what}`).toMatch(
          new RegExp(`data-appearance-boundary="document"[^>]* data-display-mode="${mode}"`),
        );
        expectUncacheable(page.headers()['cache-control'], `${path} ${what}`);
      }
    };
    await expectPages('system', 'with no cookie');
    // The request context keeps the cookie the answer sets, as a browser does.
    const response = await request.post('/api/appearance', {
      headers: { origin: app.origin },
      form: { mode: 'dark', return: '/?view=all' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe(`${app.origin}/?view=all`);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['set-cookie'] ?? '').toMatch(
      /^portfolio_appearance=mode=dark; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax/,
    );
    await expectPages('dark', 'with the cookie');
  },
);

/**
 * A page that reads the visitor's appearance cookie is private and never
 * stored: anything that makes it cacheable, such as `revalidate`, a static
 * render, or a cache header of the host's, fails here.
 */
function expectUncacheable(header: string | undefined, what: string): void {
  const directives = (header ?? '').split(',').map((directive) => directive.trim().toLowerCase());
  expect(directives, what).toContain('private');
  expect(directives, what).toContain('no-store');
  for (const caching of ['public', 'immutable']) expect(directives, what).not.toContain(caching);
  expect(
    directives.filter((directive) => /^(?:s-maxage|stale-while-revalidate)=/.test(directive)),
    what,
  ).toEqual([]);
}
