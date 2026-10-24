import { expect, test } from '../harness/fixtures';
import { send } from '../harness/http-client.mjs';
import { withRscHash } from '../harness/rsc';
import { DEMO, DEMO_APP, expectNotFoundPage, PUBLIC_FILE } from './apps';

// The bundled sample's routes under /sample, in demo (#5, Slice 4).
// `?variant=fixture-chapters` renders that variant's views below /sample,
// and every link and redirect keeps the parameter. The sample site selects
// Editorial Evidence, the platform default (#13), so without the parameter
// it renders, and declares no view. The root serves no
// view under demo. The 404 page renders from the server, so it works without
// JavaScript too.

test.use({ appOptions: DEMO_APP });

const CHAPTERS = '?variant=fixture-chapters';

test(
  "?variant= renders that variant's views below /sample, its links keeping the parameter",
  { annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
  async ({ page, app }) => {
    expect((await page.goto(`/sample${CHAPTERS}`))?.status()).toBe(200);
    await expect(page.locator('[data-variant]')).toHaveAttribute(
      'data-variant',
      'fixture-chapters',
    );
    await page
      .getByRole('navigation', { name: 'Chapters' })
      .getByRole('link', { name: 'About', exact: true })
      .click();
    await expect(page).toHaveURL(`${app.origin}/sample/chapters/about${CHAPTERS}`);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('About');
    // A variant's links are plain anchors, so that was a document load. Next's
    // router asks for the same view's payload with RSC: 1 and the `_rsc` hash
    // when it navigates or prefetches, and the rewrite serves it from the
    // variant's segment
    // (#6, Slice 2): x-nextjs-rewritten-path names the segment and the view,
    // never the query, which the router keeps from the URL it asked for.
    const router: Record<string, string>[] = [
      { rsc: '1' },
      { rsc: '1', 'next-router-prefetch': '1' },
    ];
    for (const headers of router) {
      const flight = await page.request.get(
        await withRscHash(`/sample/chapters/about${CHAPTERS}`, headers),
        { headers, maxRedirects: 0 },
      );
      expect(flight.status()).toBe(200);
      expect(flight.headers()['content-type']).toMatch(/^text\/x-component/);
      expect(flight.headers()['x-nextjs-rewritten-path']).toBe(
        '/_experience/fixture-chapters/sample/chapters/about',
      );
      expect(flight.headers()['x-nextjs-rewritten-query'] ?? '').toBe('');
    }
    expect((await page.reload())?.status()).toBe(200);
    await expect(heading).toHaveText('About');
    // /sample isn't the live site, so its views name no canonical and no
    // og:url (#22), as its home doesn't.
    await expect(page.locator('head link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('head meta[property="og:url"]')).toHaveCount(0);
  },
);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'a view below /sample renders from the server, and its links stay in the variant',
    { annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
    async ({ page, app }) => {
      expect((await page.goto(`/sample/chapters/about${CHAPTERS}`))?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('About');
      await page
        .getByRole('navigation', { name: 'Chapters' })
        .getByRole('link', { name: 'Skills', exact: true })
        .click();
      await expect(page).toHaveURL(`${app.origin}/sample/chapters/skills${CHAPTERS}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Skills');
    },
  );
});

test(
  'a path another variant declares redirects within /sample, keeping the parameter',
  { annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
  async ({ request }) => {
    for (const [path, location] of [
      [`/sample/notes${CHAPTERS}`, `/sample${CHAPTERS}`],
      ['/sample/chapters/about?variant=fixture-notes', '/sample?variant=fixture-notes'],
      // The sample's own selection: Editorial Evidence, which declares no view.
      ['/sample/chapters/about', '/sample'],
    ] as const) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(307);
      expect(response.headers().location, path).toBe(location);
    }
  },
);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'anything else under /sample, or at the root, is the 404 page',
    { annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
    async ({ page }) => {
      for (const path of [
        `/sample/no-such-view${CHAPTERS}`,
        `/sample/work/tide-tables${CHAPTERS}`,
        `/sample/work/tide-tables/credits${CHAPTERS}`,
        // A path no installed variant declares, and a slug the live revision doesn't route.
        '/no-such-view',
        '/work/tide-tables',
      ]) {
        await expectNotFoundPage(page, path);
      }
    },
  );
});

test(
  "a query the registry doesn't accept, in any part, is a 307 to the canonical one on the deployment's origin, which renders (#9)",
  { annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
  async ({ request, app }) => {
    for (const [path, location] of [
      // An unknown or unselectable variant falls back to the sample's own.
      ['/sample?variant=canary-variant', '/sample'],
      ['/sample?variant=fallback&mode=dark', '/sample?mode=dark'],
      ['/sample?variant=fixture-chapters&variant=fixture-chapters', '/sample'],
      // Another key, a value no axis accepts, motion other than reduce, another order.
      ['/sample?utm_source=mail', '/sample'],
      ['/sample?mode=sepia&language=no-such-pack', '/sample'],
      ['/sample?motion=full&mode=light', '/sample?mode=light'],
      [`/sample?mode=dark&variant=fixture-chapters`, `/sample${CHAPTERS}&mode=dark`],
      // The path below /sample comes along, each segment as one.
      ['/sample/chapters/about?variant=fallback', '/sample/chapters/about'],
      // Values that look like a URL or a host never reach the location.
      ['/sample?mode=%2F%2Fevil.example&scheme=https%3A%2F%2Fevil.example', '/sample'],
    ] as const) {
      const spoofed: Record<string, string>[] = [{}, { 'x-forwarded-host': 'evil.example' }];
      for (const headers of spoofed) {
        const response = await request.get(path, { maxRedirects: 0, headers });
        expect(response.status(), path).toBe(307);
        // Absolute, on PORTFOLIO_ORIGIN, whatever the request said its host was.
        expect(response.headers().location, path).toBe(`${app.origin}${location}`);
      }
      // A Host that isn't PORTFOLIO_ORIGIN's, which Playwright can't send, so
      // over node:http: the location still names PORTFOLIO_ORIGIN, never it.
      for (const host of [
        'evil.example',
        'evil.example:8443',
        `demo.${new URL(app.origin).host}`,
      ]) {
        const sent: Record<string, string>[] = [{ host }, { host, 'x-forwarded-host': host }];
        for (const headers of sent) {
          const answer = await send({
            protocol: 'http:',
            port: Number(new URL(app.origin).port),
            path,
            headers,
          });
          expect(answer.status, `${path} Host ${host}`).toBe(307);
          expect(answer.headers.location, `${path} Host ${host}`).toBe(`${app.origin}${location}`);
        }
      }
    }
    // The canonical URL renders as asked.
    for (const path of [
      '/sample',
      '/sample?mode=dark',
      `/sample${CHAPTERS}&mode=dark&motion=reduce`,
    ]) {
      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
    }
    // And the view redirect below /sample still keeps it, on the next request.
    const view = await request.get('/sample/chapters/about', { maxRedirects: 0 });
    expect(view.status()).toBe(307);
    expect(view.headers().location).toBe('/sample');
  },
);

test(
  'a view another profile serves at the root is absent under demo: the proxy answers it',
  { annotation: [{ type: 'route', description: '/[...view]' }, DEMO] },
  async ({ request }) => {
    // Each is a view an installed variant declares, which demo's root doesn't serve.
    for (const path of ['/chapters/about', '/notes']) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
      expect(response.headers()['content-type'], path).toMatch(/^text\/plain/);
    }
  },
);

test(
  'a file in public/ is served under demo too',
  { annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
  async ({ request }) => {
    const response = await request.get(`/${PUBLIC_FILE.name}`, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe(PUBLIC_FILE.text);
    expect(response.headers()['x-robots-tag']).toBe('noindex');
  },
);

test(
  'beside /sample, every API and metadata route still answers for itself',
  { annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
  async ({ request }) => {
    const routes: Array<[path: string, status: number, type: RegExp]> = [
      ['/robots.txt', 200, /^text\/plain/],
      ['/sitemap.xml', 200, /^application\/xml/],
      ['/opengraph-image-12o0cb', 200, /^image\/png/],
      ['/api/health', 200, /^application\/json/],
      ['/api/ready', 200, /^application\/json/],
    ];
    for (const [path, status, type] of routes) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(status);
      expect(response.headers()['content-type'], path).toMatch(type);
    }
  },
);
