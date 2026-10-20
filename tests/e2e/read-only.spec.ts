import path from 'node:path';
import { expect, test } from '../harness/fixtures';

// The read-only profile from a mounted source directory. The canonical origin
// differs from the fixture's meta.url (https://rowan.test), so every absolute
// URL below has to come from PORTFOLIO_ORIGIN.
const ORIGIN = 'https://canonical.test';
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({ appOptions: { env: { PORTFOLIO_ORIGIN: ORIGIN } } });

// The baseline authoring surface, removed in every profile.
const DELETED: Array<[method: 'GET' | 'PUT', route: string, body?: string]> = [
  ['GET', '/admin'],
  ['GET', '/variants'],
  ['GET', '/preview/editorial'],
  ['GET', '/preview/kinetic-cosmos'],
  ['GET', '/api/portfolio'],
  ['PUT', '/api/portfolio', 'identity:\n  name: Overwritten\n'],
  ['PUT', '/api/variant', '{"slug":"kinetic-cosmos"}'],
  ['PUT', '/api/customize', '{"colorScheme":"warm"}'],
];

for (const [method, route, body] of DELETED) {
  test(
    `${method} ${route} answers 404 without x-portfolio-path`,
    { annotation: [{ type: 'route', description: route }, READ_ONLY] },
    async ({ request }) => {
      const response = await request.fetch(route, { method, data: body, maxRedirects: 0 });
      expect(response.status()).toBe(404);
      expect(response.headers()['x-portfolio-path']).toBeUndefined();
    },
  );
}

test(
  'a rejected write leaves the portfolio as mounted',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ request }) => {
    await request.put('/api/portfolio', { data: 'identity:\n  name: Overwritten\n' });
    const home = await request.get('/');
    expect(await home.text()).toContain('Rowan Fixture');
  },
);

test(
  'no response names a server path',
  { annotation: [{ type: 'route', description: '(every route)' }, READ_ONLY] },
  async ({ request, app }) => {
    // The harness keeps the build and the source directory under one temporary root.
    const root = path.dirname(app.sourceDir);
    const paths = ['/', '/robots.txt', '/sitemap.xml', '/feed.xml', '/api/health', '/nope'];
    for (const [method, route, body] of [
      ...paths.map((route) => ['GET', route] as const),
      ...DELETED,
    ]) {
      const response = await request.fetch(route, { method, data: body, maxRedirects: 0 });
      const text = `${JSON.stringify(response.headers())}\n${await response.text()}`;
      expect(text, `${method} ${route}`).not.toContain(root);
    }
  },
);

test(
  'robots.txt points at the sitemap on PORTFOLIO_ORIGIN and keeps crawlers out of /studio and /api/',
  { annotation: [{ type: 'route', description: '/robots.txt' }, READ_ONLY] },
  async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(body).toContain('Disallow: /studio');
    expect(body).toContain('Disallow: /api/');
    expect(body).not.toContain('rowan.test');
  },
);

test(
  'the sitemap lists only the home page, on PORTFOLIO_ORIGIN',
  { annotation: [{ type: 'route', description: '/sitemap.xml' }, READ_ONLY] },
  async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const locations = [...(await response.text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map(
      (match) => match[1],
    );
    expect(locations).toEqual([`${ORIGIN}/`]);
  },
);

test(
  'the feed links to PORTFOLIO_ORIGIN',
  { annotation: [{ type: 'route', description: '/feed.xml' }, READ_ONLY] },
  async ({ request }) => {
    const response = await request.get('/feed.xml');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain(`<link>${ORIGIN}</link>`);
    expect(body).toContain(`<atom:link href="${ORIGIN}/feed.xml"`);
  },
);

test(
  'the home page metadata and structured data use PORTFOLIO_ORIGIN',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await page.goto('/');
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content');
    expect(ogUrl?.replace(/\/$/, '')).toBe(ORIGIN);
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((scripts) => scripts.map((script) => JSON.parse(script.textContent ?? '')));
    const urls = Object.fromEntries(blocks.map((block) => [block['@type'], block.url]));
    expect(urls).toEqual({ Person: ORIGIN, ProfilePage: ORIGIN, WebSite: ORIGIN });
  },
);

test(
  'the Open Graph image renders per request',
  { annotation: [{ type: 'route', description: '/opengraph-image' }, READ_ONLY] },
  async ({ request }) => {
    const response = await request.get('/opengraph-image');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
  },
);

test(
  'an unknown path renders the generic 404 page, which links only home',
  { annotation: [{ type: 'route', description: '/does-not-exist' }, READ_ONLY] },
  async ({ page }) => {
    const response = await page.goto('/does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    const links = await page
      .getByRole('main')
      .getByRole('link')
      .evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href')));
    expect(links).toEqual(['/']);
  },
);
