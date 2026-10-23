import { readFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as plain, type APIRequestContext } from '@playwright/test';
import { startApp } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { ownerApp, READ_ONLY_APP } from '../harness/profile-matrix';

// Published metadata (#22) against the built server, under owner and
// read-only, on a .test origin the fixture's own links don't use: every
// metadata surface names the live person, every absolute URL starts with
// PORTFOLIO_ORIGIN, the canonical link and og:url never carry a query or
// visitor state, and no surface names the bundled sample, a host the
// request came through, the machine that built or runs the app, or a path
// on it. read-only runs on the harness's worker server; owner, whose
// options are the worker's too, on a server of its own for the group.

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

interface Server {
  readonly origin: string;
  readonly root: string;
}

/** What no surface may name: the sample, the request's host, the build host, and local paths. */
function forbidden(server: Server): string[] {
  expect(SAMPLE_NAME).toBe('Anamika Devi');
  const machine = hostname();
  return [
    SAMPLE_NAME!,
    'example.com',
    'localhost',
    '127.0.0.1',
    new URL(server.origin).host,
    ...(machine.length >= 4 ? [machine] : []),
    server.root,
    REPO_ROOT.replace(/\/$/, ''),
    homedir(),
    tmpdir(),
  ];
}

/** The head tags a link preview reads, from a page's HTML. */
async function head(request: APIRequestContext, url: string, headers: Record<string, string>) {
  const response = await request.get(url, { headers });
  expect(response.status(), url).toBe(200);
  const html = await response.text();
  const attribute = (pattern: RegExp) => [...html.matchAll(pattern)].map((match) => match[1]);
  return {
    response,
    canonical: attribute(/<link rel="canonical" href="([^"]*)"/g),
    ogUrl: attribute(/<meta property="og:url" content="([^"]*)"/g),
    ogImage: attribute(/<meta property="og:image" content="([^"]*)"/g),
    jsonLd: attribute(/<script type="application\/ld\+json"[^>]*>([^<]*)<\/script>/g).map(
      (json) => JSON.parse(json!) as Record<string, unknown>,
    ),
  };
}

async function noLeaks(request: APIRequestContext, server: Server) {
  const leaks = forbidden(server);
  for (const route of SURFACES) {
    const response = await request.get(`${server.origin}${route}`, { maxRedirects: 0 });
    const text = `${JSON.stringify(response.headers())}\n${await response.text()}`;
    for (const leak of leaks) expect(text, `${route} names ${leak}`).not.toContain(leak);
  }
  const image = await request.get(`${server.origin}/opengraph-image-12o0cb`);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');
  // Drawn from the live person, so no cache may keep it past a publish.
  expect(image.headers()['cache-control']).toMatch(/max-age=0|no-store/);
  expect(image.headers()['cache-control']).not.toContain('immutable');
}

async function homeHead(request: APIRequestContext, server: Server) {
  for (const [route, headers] of [
    ['/', {}],
    ['/?utm_source=feed&variant=fixture-notes', {}],
    ['/', { cookie: 'portfolio_appearance=dark' }],
  ] as const) {
    const page = await head(request, `${server.origin}${route}`, headers);
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
}

async function robotsAndSitemap(request: APIRequestContext, server: Server) {
  for (const route of ['/robots.txt', '/sitemap.xml']) {
    const cache = (await request.get(`${server.origin}${route}`)).headers()['cache-control'];
    expect(cache, route).toMatch(/max-age=0|no-store/);
  }
  const robots = await (await request.get(`${server.origin}/robots.txt`)).text();
  expect(robots).toContain('Allow: /');
  expect(robots).toContain('Disallow: /studio');
  expect(robots).toContain('Disallow: /api/');
  expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
  expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  const sitemap = await (await request.get(`${server.origin}/sitemap.xml`)).text();
  expect([...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1])).toEqual([
    `${ORIGIN}/`,
  ]);
  expect(sitemap).not.toContain('<lastmod>');
}

async function feed(request: APIRequestContext, server: Server) {
  const response = await request.get(`${server.origin}/feed.xml`);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('public, max-age=3600');
  const xml = await response.text();
  expect(xml).toContain(`<link>${ORIGIN}</link>`);
  expect(xml).toContain(`<atom:link href="${ORIGIN}/feed.xml"`);
  expect(xml).toContain('<language>en</language>');
  expect(xml).not.toContain('<source');
}

const TITLES = {
  leaks: 'no metadata surface names the sample, a request host, the build host, or a local path',
  home: "home's canonical link and og:url are the origin's /, with no query or visitor state, and its head names the live person",
  robots:
    'robots keeps crawlers out of Studio and the API and names the sitemap on the origin, which lists home alone',
  feed: "the feed links on the origin in the portfolio's language, and no cache keeps it stale",
};

const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({ appOptions: { ...READ_ONLY_APP, env: { PORTFOLIO_ORIGIN: ORIGIN } } });

test.describe('under read-only', () => {
  test(
    'no metadata surface names the sample, a request host, the build host, or a local path',
    { annotation: [{ type: 'route', description: '(every metadata route)' }, READ_ONLY] },
    async ({ request, app }) => noLeaks(request, app),
  );
  test(
    "home's canonical link and og:url are the origin's /, with no query or visitor state, and its head names the live person",
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ request, app }) => homeHead(request, app),
  );
  test(
    'robots keeps crawlers out of Studio and the API and names the sitemap on the origin, which lists home alone',
    { annotation: [{ type: 'route', description: '/robots.txt' }, READ_ONLY] },
    async ({ request, app }) => robotsAndSitemap(request, app),
  );
  test(
    "the feed links on the origin in the portfolio's language, and no cache keeps it stale",
    { annotation: [{ type: 'route', description: '/feed.xml' }, READ_ONLY] },
    async ({ request, app }) => feed(request, app),
  );
});

const OWNER = { type: 'profile', description: 'owner' };
const secret = ownerSecret();

plain.describe('under owner', () => {
  plain.describe.configure({ mode: 'serial' });
  let owner: (Server & { stop: () => Promise<void> }) | undefined;
  const server = () => {
    expect(owner, 'the owner server started').toBeDefined();
    return owner!;
  };
  plain.beforeAll(async () => {
    const options = ownerApp(secret.hash);
    owner = await startApp({ ...options, env: { ...options.env, PORTFOLIO_ORIGIN: ORIGIN } });
  });
  plain.afterAll(async () => {
    await owner?.stop();
  });

  plain(
    TITLES.leaks,
    { annotation: [{ type: 'route', description: '(every metadata route)' }, OWNER] },
    async ({ request }) => noLeaks(request, server()),
  );
  plain(
    TITLES.home,
    { annotation: [{ type: 'route', description: '/' }, OWNER] },
    async ({ request }) => homeHead(request, server()),
  );
  plain(
    TITLES.robots,
    { annotation: [{ type: 'route', description: '/robots.txt' }, OWNER] },
    async ({ request }) => robotsAndSitemap(request, server()),
  );
  plain(
    TITLES.feed,
    { annotation: [{ type: 'route', description: '/feed.xml' }, OWNER] },
    async ({ request }) => feed(request, server()),
  );
});
