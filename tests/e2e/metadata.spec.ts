import { readFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { ownerApp, READ_ONLY_APP } from '../harness/profile-matrix';

// Published metadata (#22) against the built server, under owner and
// read-only, on a .test origin the fixture's own links don't use: every
// metadata surface names the live person, every absolute URL starts with
// PORTFOLIO_ORIGIN, the canonical link and og:url never carry a query or
// visitor state, and no surface names the bundled sample, a host the
// request came through, the machine that built or runs the app, or a path
// on it.

const ORIGIN = 'https://published.rowan.test';
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** The fixture's person, tests/fixtures/portfolio.yml. */
const PERSON = 'Rowan Fixture';
/** The bundled sample's person, which production never shows. */
const SAMPLE_NAME = /^ {2}name: (.+)$/m
  .exec(readFileSync(path.join(REPO_ROOT, 'portfolio.example.yml'), 'utf8'))?.[1]
  ?.trim();

/** Every metadata surface a crawler or a link preview reads. */
const SURFACES = [
  '/',
  '/?utm_source=feed&variant=fixture-notes',
  '/robots.txt',
  '/sitemap.xml',
  '/feed.xml',
  '/does-not-exist',
];

/** What no surface may name: the sample, the request's host, the build host, and local paths. */
function forbidden(app: { origin: string; root: string }): string[] {
  expect(SAMPLE_NAME).toBe('Anamika Devi');
  const machine = hostname();
  return [
    SAMPLE_NAME!,
    'example.com',
    'localhost',
    '127.0.0.1',
    new URL(app.origin).host,
    ...(machine.length >= 4 ? [machine] : []),
    app.root,
    REPO_ROOT.replace(/\/$/, ''),
    homedir(),
    tmpdir(),
  ];
}

/** The head tags a link preview reads, from a page's HTML. */
async function head(
  request: APIRequestContext,
  route: string,
  headers: Record<string, string> = {},
) {
  const response = await request.get(route, { headers });
  expect(response.status(), route).toBe(200);
  const html = await response.text();
  const attribute = (pattern: RegExp) => [...html.matchAll(pattern)].map((match) => match[1]);
  return {
    response,
    html,
    canonical: attribute(/<link rel="canonical" href="([^"]*)"/g),
    ogUrl: attribute(/<meta property="og:url" content="([^"]*)"/g),
    ogImage: attribute(/<meta property="og:image" content="([^"]*)"/g),
    jsonLd: attribute(/<script type="application\/ld\+json"[^>]*>([^<]*)<\/script>/g).map(
      (json) => JSON.parse(json!) as Record<string, unknown>,
    ),
  };
}

const secret = ownerSecret();

for (const [profile, appOptions] of [
  ['owner', ownerApp(secret.hash)],
  ['read-only', READ_ONLY_APP],
] as const) {
  const PROFILE = { type: 'profile', description: profile };

  test.describe(`under ${profile}`, () => {
    test.use({
      appOptions: { ...appOptions, env: { ...appOptions.env, PORTFOLIO_ORIGIN: ORIGIN } },
    });

    test(
      'no metadata surface names the sample, a request host, the build host, or a local path',
      { annotation: [{ type: 'route', description: '(every metadata route)' }, PROFILE] },
      async ({ request, app }) => {
        const leaks = forbidden(app);
        for (const route of SURFACES) {
          const response = await request.get(route, { maxRedirects: 0 });
          const text = `${JSON.stringify(response.headers())}\n${await response.text()}`;
          for (const leak of leaks) expect(text, `${route} names ${leak}`).not.toContain(leak);
        }
        const image = await request.get('/opengraph-image-12o0cb');
        expect(image.status()).toBe(200);
        expect(image.headers()['content-type']).toBe('image/png');
        // Drawn from the live person, so no cache may keep it past a publish.
        expect(image.headers()['cache-control']).toMatch(/max-age=0|no-store/);
        expect(image.headers()['cache-control']).not.toContain('immutable');
      },
    );

    test(
      "home's canonical link and og:url are the origin's /, with no query or visitor state, and its head names the live person",
      { annotation: [{ type: 'route', description: '/' }, PROFILE] },
      async ({ request }) => {
        for (const [route, headers] of [
          ['/', {}],
          ['/?utm_source=feed&variant=fixture-notes', {}],
          ['/', { cookie: 'portfolio_appearance=dark' }],
        ] as const) {
          const page = await head(request, route, headers);
          expect(page.canonical, route).toEqual([`${ORIGIN}/`]);
          expect(page.ogUrl, route).toEqual([`${ORIGIN}/`]);
          expect(page.ogImage.length, route).toBe(1);
          expect(new URL(page.ogImage[0]!).origin, route).toBe(ORIGIN);
          const person = page.jsonLd.find((block) => block['@type'] === 'Person');
          expect(person?.name, route).toBe(PERSON);
          expect(person?.url, route).toBe(ORIGIN);
          expect(JSON.stringify(page.jsonLd), route).not.toContain('rowan@rowan.test');
          // A visitor page is never one a shared cache may keep.
          const cache = page.response.headers()['cache-control'] ?? '';
          expect(cache, route).toMatch(/(?:^|,)\s*no-store/);
          expect(cache, route).not.toMatch(/public|s-maxage/);
        }
      },
    );

    test(
      'robots keeps crawlers out of Studio and the API and names the sitemap on the origin, which lists home alone',
      { annotation: [{ type: 'route', description: '/robots.txt' }, PROFILE] },
      async ({ request }) => {
        for (const route of ['/robots.txt', '/sitemap.xml']) {
          const cache = (await request.get(route)).headers()['cache-control'];
          expect(cache, route).toMatch(/max-age=0|no-store/);
        }
        const robots = await (await request.get('/robots.txt')).text();
        expect(robots).toContain('Allow: /');
        expect(robots).toContain('Disallow: /studio');
        expect(robots).toContain('Disallow: /api/');
        expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
        expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
        const sitemap = await (await request.get('/sitemap.xml')).text();
        expect([...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1])).toEqual([
          `${ORIGIN}/`,
        ]);
        expect(sitemap).not.toContain('<lastmod>');
      },
    );

    test(
      "the feed links on the origin in the portfolio's language, and no cache keeps it stale",
      { annotation: [{ type: 'route', description: '/feed.xml' }, PROFILE] },
      async ({ request }) => {
        const response = await request.get('/feed.xml');
        expect(response.status()).toBe(200);
        expect(response.headers()['cache-control']).toBe('public, max-age=3600');
        const feed = await response.text();
        expect(feed).toContain(`<link>${ORIGIN}</link>`);
        expect(feed).toContain(`<atom:link href="${ORIGIN}/feed.xml"`);
        expect(feed).toContain('<language>en</language>');
        expect(feed).not.toContain('<source');
      },
    );
  });
}
