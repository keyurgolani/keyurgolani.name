import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import type { Profile } from './server/capabilities';
import { readDeploymentConfig } from './server/config';
import { setDeploymentState, setServable } from './server/config-store';
import { readiness } from './server/readiness';
import { ROUTE_HEADER } from './server/routes';

// proxy.ts: 404 early for what the profile doesn't serve, a fresh request ID
// on everything else, noindex on every demo response, 503 before register()
// has stored the deployment, with readiness's own body for /api/ready, a
// static 503 page for visitor pages while the catalog can't serve (#5), and
// the route table's decision on every request it passes on, so next.config.ts
// sends a path no route renders to the app's 404 page (#5, Slice 4).

function deploy(t: TestContext, profile: Profile): void {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: profile,
      PORTFOLIO_ORIGIN: 'https://rowan.test',
      ...(profile === 'demo' ? {} : { PORTFOLIO_SOURCE_DIR: '/srv/config' }),
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  setDeploymentState({
    config: read.config,
    catalog: { getLive: () => assert.fail('the proxy reads no catalog') },
    dispatch: () => assert.fail('the proxy runs no operation'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
}

function request(path: string, method = 'GET'): NextRequest {
  return new NextRequest(`https://rowan.test${path}`, {
    method,
    headers: { 'x-request-id': 'client-chosen', [ROUTE_HEADER]: 'client-chosen' },
  });
}

/** The route table's decision as the request Next routes carries it, or null when it goes no further. */
const decision = (response: Response) =>
  response.headers.get('x-middleware-next') === '1'
    ? response.headers.get(`x-middleware-request-${ROUTE_HEADER}`)
    : null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('before register() stores the deployment, every request is 503', async () => {
  setDeploymentState(undefined);
  const response = proxy(request('/'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('x-request-id') ?? '', UUID);
});

test('before startup, /api/ready answers with the starting body readiness documents', async () => {
  setDeploymentState(undefined);
  const response = proxy(request('/api/ready'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('x-request-id') ?? '', UUID);
  const starting = await readiness(undefined, {
    variantHealth: () => assert.fail('nothing loads before startup'),
    loadedOwnerModules: () => [],
  });
  assert.deepEqual(await response.json(), starting.body);
});

test('a served path passes through with a fresh request ID, whatever the client sent', (t) => {
  deploy(t, 'read-only');
  for (const path of ['/', '/feed.xml', '/api/studio/config.status', '/_next/static/a.js']) {
    const response = proxy(request(path));
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
    const id = response.headers.get('x-request-id') ?? '';
    assert.match(id, UUID, path);
    // The id the route handler sees on the request is the same fresh one.
    assert.equal(response.headers.get('x-middleware-request-x-request-id'), id, path);
    assert.match(response.headers.get('x-middleware-override-headers') ?? '', /x-request-id/);
    // So is the table's decision, in place of the one the client sent.
    assert.equal(decision(response), path.startsWith('/_next/') ? 'unlisted' : 'served', path);
  }
  const first = proxy(request('/')).headers.get('x-request-id');
  const second = proxy(request('/')).headers.get('x-request-id');
  assert.notEqual(first, second);
});

test('retired routes are 404 in every profile, and only their exact paths', async (t) => {
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const path of ['/admin', '/variants', '/api/portfolio']) {
      const response = proxy(request(path));
      assert.equal(response.status, 404, `${profile} ${path}`);
      assert.equal(await response.text(), 'Not found.');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('x-request-id') ?? '', UUID);
    }
    // A path below one names nothing: a file in public/, or else the app's 404 page.
    assert.equal(decision(proxy(request('/variants/kinetic-cosmos/a.png'))), 'missing');
  }
});

test('next.config.ts sends a request marked missing to the 404 page, after public/', async () => {
  const { default: config } = await import('../next.config');
  const rewrites = await config.rewrites?.();
  assert.ok(rewrites && !Array.isArray(rewrites), 'rewrites in phases');
  // afterFiles: Next has looked in public/ first. An unnamed group adds
  // nothing to the 404 page's query. The router prefetch rule for /_next/
  // follows it, which headers.test.ts checks.
  assert.deepEqual(rewrites.afterFiles?.[0], {
    source: '/(.*)',
    has: [{ type: 'header', key: ROUTE_HEADER, value: 'missing' }],
    destination: '/_not-found',
  });
  assert.equal(rewrites.afterFiles?.length, 2);
});

test('a path no route renders goes on marked missing for GET and HEAD, in every profile (#5, Slice 4)', async (t) => {
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const path of [
      '/does-not-exist',
      '/api/nope',
      '/favicon.ico',
      '/work/x',
      '/chapters',
      `/chapters/${'a'.repeat(8000)}`,
      '/robots.txt/x',
    ]) {
      for (const method of ['GET', 'HEAD']) {
        const response = proxy(request(path, method));
        const what = `${profile} ${method} ${path.slice(0, 40)}`;
        assert.equal(decision(response), 'missing', what);
        const id = response.headers.get('x-request-id') ?? '';
        assert.match(id, UUID, what);
        // The 404 page sees the same fresh ID on its request.
        assert.equal(response.headers.get('x-middleware-request-x-request-id'), id, what);
        assert.equal(
          response.headers.get('x-robots-tag'),
          profile === 'demo' ? 'noindex' : null,
          what,
        );
      }
      // Only a page load gets the page. Anything else is the plain 404.
      for (const method of ['POST', 'PUT', 'DELETE']) {
        const response = proxy(request(path, method));
        assert.equal(response.status, 404, `${profile} ${method} ${path.slice(0, 40)}`);
        assert.equal(decision(response), null);
        assert.equal(await response.text(), 'Not found.');
      }
    }
  }
});

test('under demo, a /sample path or ?variant= that names nothing is missing too', (t) => {
  deploy(t, 'demo');
  for (const path of [
    '/sample?variant=fallback',
    '/sample?variant=canary-variant',
    '/sample?variant=',
    '/sample/nowhere',
    '/sample/work/x',
  ]) {
    assert.equal(decision(proxy(request(path))), 'missing', path);
  }
  assert.equal(decision(proxy(request('/sample'))), 'served');
});

test("a route outside the profile's matrix is 404 early", (t) => {
  deploy(t, 'demo');
  assert.equal(proxy(request('/feed.xml')).status, 404);
  assert.equal(proxy(request('/')).headers.get('x-middleware-next'), '1');
});

test('under demo every response asks crawlers not to index it, and elsewhere none does', async (t) => {
  const paths = ['/', '/sample', '/feed.xml', '/admin', '/_next/static/chunks/app.js', '/nowhere'];
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    await t.test(profile, (t) => {
      deploy(t, profile);
      for (const path of paths) {
        const tag = proxy(request(path)).headers.get('x-robots-tag');
        assert.equal(tag, profile === 'demo' ? 'noindex' : null, `${profile} ${path}`);
      }
    });
  }
});

test("while the catalog can't serve, visitor pages are a static 503 page, and the rest pass", async (t) => {
  deploy(t, 'read-only');
  setServable(false);
  t.after(() => setServable(true));
  for (const path of ['/', '/feed.xml', '/sitemap.xml', '/robots.txt', '/opengraph-image-12o0cb']) {
    const response = proxy(request(path));
    assert.equal(response.status, 503, path);
    assert.equal(response.headers.get('retry-after'), '120', path);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex', path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/, path);
    assert.match(response.headers.get('x-request-id') ?? '', UUID, path);
    const html = await response.text();
    assert.match(html, /<h1>Temporarily unavailable<\/h1>/);
    // No validation text, path, or Studio link.
    assert.doesNotMatch(html, /studio|config|\.yml|href=/i);
  }
  // Readiness, health, Studio, build assets, and what the profile doesn't serve answer as before.
  for (const path of [
    '/api/ready',
    '/api/health',
    '/api/studio/config.status',
    '/_next/static/a.js',
  ]) {
    assert.equal(proxy(request(path)).headers.get('x-middleware-next'), '1', path);
  }
  assert.equal(proxy(request('/admin')).status, 404);
  // A path no route renders is the 404 page, whatever the catalog's state.
  assert.equal(decision(proxy(request('/nowhere'))), 'missing');
  // Servable again, the page passes through.
  setServable(true);
  assert.equal(proxy(request('/')).headers.get('x-middleware-next'), '1');
});

test('demo serves /sample, a visitor page, under the same rule', (t) => {
  deploy(t, 'demo');
  setServable(false);
  t.after(() => setServable(true));
  assert.equal(proxy(request('/sample')).status, 503);
  assert.equal(proxy(request('/sample')).headers.get('x-robots-tag'), 'noindex');
});

test('build assets and optimized images go through the proxy too', async () => {
  // No matcher, so no demo response goes out without its X-Robots-Tag.
  const exported = (await import('./proxy')) as Record<string, unknown>;
  assert.equal(exported.config, undefined);
});

/** Studio's policy, as studio-headers.ts builds it in production, with its nonce. */
const STUDIO_CSP =
  /^default-src 'self'; script-src 'self' 'nonce-([A-Za-z0-9+/]{22}==)' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'$/;

function studio(path: string, headers: Record<string, string> = {}, method = 'GET'): NextRequest {
  return new NextRequest(`https://rowan.test${path}`, { method, headers });
}

test('every /studio response gets a nonce CSP of its own, which the page Next renders reads too', (t) => {
  deploy(t, 'owner');
  const nonces = new Set<string>();
  for (const path of ['/studio/sign-in', '/studio/sign-in', '/studio/sign-in?state=failed']) {
    const response = proxy(studio(path));
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
    const csp = response.headers.get('content-security-policy') ?? '';
    const nonce = STUDIO_CSP.exec(csp)?.[1];
    assert.ok(nonce, csp);
    nonces.add(nonce);
    assert.equal(response.headers.get('x-middleware-request-content-security-policy'), csp, path);
  }
  assert.equal(nonces.size, 3, 'a nonce came twice');
  // Only /studio: its transport, and a path that only starts the same, get none.
  for (const path of ['/', '/api/studio/auth.session', '/studios', '/sample']) {
    assert.equal(proxy(studio(path)).headers.get('content-security-policy'), null, path);
  }
});

test("under owner every /studio response, in any case or percent-encoding, gets Studio's CSP, Referrer-Policy, and Cross-Origin-Resource-Policy, redirects and 404s included", (t) => {
  deploy(t, 'owner');
  for (const path of [
    '/studio',
    '/studio/sign-in',
    '/studio/nowhere',
    '/Studio',
    '/STUDIO/sign-in',
    // The route table reads /studio here, so this is the 303 too.
    '/%73tudio',
    '/%53TUDIO/sign-in',
  ]) {
    const response = proxy(studio(path));
    assert.match(response.headers.get('content-security-policy') ?? '', STUDIO_CSP, path);
    assert.equal(response.headers.get('referrer-policy'), 'same-origin', path);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin', path);
  }
  // /studio with no session cookie is proxy.ts's own 303.
  assert.equal(proxy(studio('/studio')).status, 303);
  assert.equal(proxy(studio('/%73tudio')).status, 303);
  // Outside /studio, none of them.
  for (const path of ['/', '/studios', '/sample', '/api/studio/auth.session']) {
    const response = proxy(studio(path));
    assert.equal(response.headers.get('referrer-policy'), null, path);
    assert.equal(response.headers.get('cross-origin-resource-policy'), null, path);
  }
});

test("under owner the plain 404 for a missing /studio path, to a method but GET or HEAD, keeps Studio's headers (#5, Slice 4)", (t) => {
  deploy(t, 'owner');
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = proxy(studio('/studio/nowhere', {}, method));
    assert.equal(response.status, 404, method);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8', method);
    assert.match(response.headers.get('content-security-policy') ?? '', STUDIO_CSP, method);
    assert.equal(response.headers.get('referrer-policy'), 'same-origin', method);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin', method);
  }
});

/** What Next sends with its 404 page for a path no route matches. */
const UNKNOWN_PATH_CACHE_CONTROL = 'private, no-cache, no-store, max-age=0, must-revalidate';

/** None of Studio's own headers, on the response or on the request Next routes. */
function noStudioHeaders(response: Response, what: string): void {
  for (const name of [
    'content-security-policy',
    'referrer-policy',
    'cross-origin-resource-policy',
    'x-middleware-request-content-security-policy',
    'x-middleware-request-x-studio-path',
  ]) {
    assert.equal(response.headers.get(name), null, `${what}: ${name}`);
  }
}

/** The Studio pages the table lists, in each spelling it reads as theirs. */
const LISTED_STUDIO_PATHS = [
  '/studio',
  '/studio/sign-in',
  '/studio/sign-in?state=failed',
  '/%73tudio',
  '/%73tudio/sign-in',
  '/studio/%73ign-in',
];

/** Studio paths the table lists no page at: another case, or deeper. */
const UNLISTED_STUDIO_PATHS = [
  '/studio/nowhere',
  '/studio/sign-in/x',
  '/Studio',
  '/STUDIO/sign-in',
  '/sTuDiO/x',
  '/%53TUDIO/sign-in',
];

test("under a profile with no Studio page, every Studio path is as unknown as any path: none of Studio's headers, Next's 404 page for GET and HEAD, and the plain 404 for the rest", async (t) => {
  for (const profile of ['demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const method of ['GET', 'HEAD']) {
      for (const path of LISTED_STUDIO_PATHS) {
        const response = proxy(studio(path, {}, method));
        const what = `${profile} ${method} ${path}`;
        // On to Next, marked for next.config.ts's rewrite to the 404 page.
        assert.equal(response.headers.get('x-middleware-next'), '1', what);
        assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), '1', what);
        assert.equal(response.headers.get('cache-control'), UNKNOWN_PATH_CACHE_CONTROL, what);
        noStudioHeaders(response, what);
        assert.match(response.headers.get('x-request-id') ?? '', UUID, what);
      }
      // The rest go on marked missing, as any unknown path does, and get
      // its Cache-Control in place of next.config.ts's no-store for Studio.
      for (const path of UNLISTED_STUDIO_PATHS) {
        const response = proxy(studio(path, {}, method));
        const what = `${profile} ${method} ${path}`;
        assert.equal(decision(response), 'missing', what);
        assert.equal(
          response.headers.get('x-middleware-request-x-portfolio-not-found'),
          null,
          what,
        );
        assert.equal(response.headers.get('cache-control'), UNKNOWN_PATH_CACHE_CONTROL, what);
        noStudioHeaders(response, what);
      }
    }
    // Any other method gets the plain 404 /no-such-page gets.
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const unknown = proxy(studio('/no-such-page', {}, method));
      for (const path of [...LISTED_STUDIO_PATHS, ...UNLISTED_STUDIO_PATHS]) {
        const response = proxy(studio(path, {}, method));
        const what = `${profile} ${method} ${path}`;
        assert.equal(response.status, 404, what);
        assert.equal(await response.text(), 'Not found.', what);
        for (const name of ['content-type', 'cache-control', 'x-robots-tag']) {
          assert.equal(response.headers.get(name), unknown.headers.get(name), `${what}: ${name}`);
        }
        noStudioHeaders(response, what);
      }
    }
  }
});

test('a route spelled with a fixed segment percent-encoded is a path no route matches: the 404 page for GET and HEAD, the plain 404 for the rest (#5, Slice 4)', async (t) => {
  // Each one the route table serves the profile, read decoded. Next matches
  // a fixed segment as sent, so it never reaches the route.
  const spellings = {
    owner: [
      '/%66eed.xml',
      '/robots.tx%74',
      '/%73itemap.xml',
      '/opengraph-image-12o0c%62',
      '/%61pi/health',
      '/api/%68ealth',
      '/api/%72eady',
      '/%61pi/studio/config.status',
      '/api/%73tudio/config.status',
    ],
    'read-only': ['/%66eed.xml', '/robots.tx%74', '/%61pi/health', '/api/%68ealth'],
    demo: ['/%73ample', '/robots.tx%74', '/%61pi/health'],
  } as const;
  for (const [profile, paths] of Object.entries(spellings) as [Profile, readonly string[]][]) {
    deploy(t, profile);
    for (const path of paths) {
      for (const method of ['GET', 'HEAD']) {
        const response = proxy(request(path, method));
        const what = `${profile} ${method} ${path}`;
        assert.equal(response.headers.get('x-middleware-next'), '1', what);
        assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), '1', what);
        // Neither the table's decision nor the client's goes on with it.
        assert.equal(decision(response), null, what);
        assert.equal(response.headers.get('cache-control'), UNKNOWN_PATH_CACHE_CONTROL, what);
        assert.equal(
          response.headers.get('x-robots-tag'),
          profile === 'demo' ? 'noindex' : null,
          what,
        );
      }
      for (const method of ['POST', 'PUT', 'DELETE']) {
        const response = proxy(request(path, method));
        assert.equal(response.status, 404, `${profile} ${method} ${path}`);
        assert.equal(await response.text(), 'Not found.');
      }
    }
  }
  // A route the profile doesn't serve is its plain 404 in either spelling.
  deploy(t, 'demo');
  for (const path of ['/feed.xml', '/%66eed.xml']) {
    const response = proxy(request(path));
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), 'Not found.', path);
  }
  // A dynamic segment spelled encoded is still the route's: Next decodes it.
  deploy(t, 'read-only');
  assert.equal(decision(proxy(request('/api/studio/%63onfig.status'))), 'served');
});

test("under owner a Studio page spelled with a fixed segment percent-encoded is the 404 page with Studio's headers, its request carrying the policy for the page's nonce", (t) => {
  deploy(t, 'owner');
  const cookie = { cookie: '__Host-studio_session=anything' };
  for (const [path, headers] of [
    ['/%73tudio/sign-in', {}],
    ['/studio/%73ign-in', {}],
    ['/%73tudio', cookie],
  ] as const) {
    const response = proxy(studio(path, headers));
    assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), '1', path);
    const csp = response.headers.get('content-security-policy') ?? '';
    assert.match(csp, STUDIO_CSP, path);
    assert.equal(response.headers.get('x-middleware-request-content-security-policy'), csp, path);
    assert.equal(response.headers.get('referrer-policy'), 'same-origin', path);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin', path);
    assert.equal(response.headers.get('x-middleware-request-x-studio-path'), null, path);
  }
  // A page for a session, asked for with no session cookie, is the 303 first.
  assert.equal(proxy(studio('/%73tudio')).status, 303);
  // Any other method is the plain 404, which keeps Studio's headers.
  const posted = proxy(studio('/%73tudio/sign-in', {}, 'POST'));
  assert.equal(posted.status, 404);
  assert.match(posted.headers.get('content-security-policy') ?? '', STUDIO_CSP);
});

test("a missing path that is a route file's own, as sent or decoded whole, goes to the 404 page ahead of Next's file check, in every profile (#5, Slice 4)", async (t) => {
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const path of [
      '/studio%2Fsign-in',
      '/%73tudio%2Fsign-in',
      '/api%2Fhealth',
      '/work/[slug]',
      '/work/%5Bslug%5D',
      '/[...view]',
      '/sample/[[...path]]',
      '/%5Fnot-found',
    ]) {
      for (const method of ['GET', 'HEAD']) {
        const response = proxy(request(path, method));
        const what = `${profile} ${method} ${path}`;
        assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), '1', what);
        assert.equal(decision(response), null, what);
        assert.equal(response.headers.get('cache-control'), UNKNOWN_PATH_CACHE_CONTROL, what);
      }
      const posted = proxy(request(path, 'POST'));
      assert.equal(posted.status, 404, `${profile} POST ${path}`);
      assert.equal(await posted.text(), 'Not found.');
    }
  }
  // Under owner, a Studio one carries Studio's policy on the request, for the page's nonce.
  deploy(t, 'owner');
  const page = proxy(studio('/studio%2Fsign-in'));
  const csp = page.headers.get('content-security-policy') ?? '';
  assert.match(csp, STUDIO_CSP);
  assert.equal(page.headers.get('x-middleware-request-content-security-policy'), csp);
  // A path that names nothing and no route file goes on marked missing, for the afterFiles rewrite.
  assert.equal(decision(proxy(request('/work%2Fx'))), 'missing');
});

test('a Studio page learns the path asked for from proxy.ts alone, never from the client', (t) => {
  deploy(t, 'owner');
  const forged = { 'x-studio-path': '/studio/elsewhere' };
  const asked = proxy(studio('/studio/sign-in?returnTo=%2Fstudio', forged));
  assert.equal(
    asked.headers.get('x-middleware-request-x-studio-path'),
    '/studio/sign-in?returnTo=%2Fstudio',
  );
  // Outside /studio a client's header is dropped before the route sees it.
  const outside = proxy(studio('/', forged));
  assert.equal(outside.headers.get('x-middleware-request-x-studio-path'), null);
  assert.doesNotMatch(outside.headers.get('x-middleware-override-headers') ?? '', /x-studio-path/);
  // So is a client's 404 mark, on every path it reaches the app on.
  for (const path of ['/', '/studio/sign-in']) {
    const marked = proxy(studio(path, { 'x-portfolio-not-found': '1' }));
    assert.equal(marked.headers.get('x-middleware-request-x-portfolio-not-found'), null, path);
    assert.doesNotMatch(
      marked.headers.get('x-middleware-override-headers') ?? '',
      /x-portfolio-not-found/,
      path,
    );
  }
});

test('under owner a Studio page for a session, asked for with no session cookie, is a 303 to sign-in, kept to GET and HEAD', (t) => {
  deploy(t, 'owner');
  for (const method of ['GET', 'HEAD']) {
    const response = proxy(studio('/studio', {}, method));
    assert.equal(response.status, 303, method);
    assert.equal(response.headers.get('location'), 'https://rowan.test/studio/sign-in', method);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy') ?? '', STUDIO_CSP);
    assert.match(response.headers.get('x-request-id') ?? '', UUID);
  }
  // Where the owner was going comes along, made safe, on the canonical origin.
  const deep = proxy(studio('/studio?tab=drafts', { host: 'attacker.test' }));
  assert.equal(
    deep.headers.get('location'),
    'https://rowan.test/studio/sign-in?returnTo=%2Fstudio%3Ftab%3Ddrafts',
  );
  // With any cookie of the session's name, or for sign-in itself, the page decides.
  assert.equal(
    proxy(studio('/studio', { cookie: '__Host-studio_session=anything' })).headers.get(
      'x-middleware-next',
    ),
    '1',
  );
  assert.equal(proxy(studio('/studio/sign-in')).headers.get('x-middleware-next'), '1');
  // A cookie of another name is no session cookie.
  assert.equal(proxy(studio('/studio', { cookie: 'studio_session=anything' })).status, 303);
  // Another method goes on to the page, which answers it.
  assert.equal(proxy(studio('/studio', {}, 'POST')).headers.get('x-middleware-next'), '1');
});

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The preview's policy in production (#7), its one nonce on scripts and
 * styles alike, with only `ancestors` allowed to frame it.
 */
const previewPolicy = (ancestors: string) =>
  new RegExp(
    `^default-src 'none'; script-src 'nonce-([A-Za-z0-9+/]{22}==)' 'strict-dynamic'; style-src 'self' 'nonce-\\1'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' https: data:; media-src 'self' https:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${escape(ancestors)}$`,
  );

/** Preview paths, in any case and percent-encoded, as next.config.ts and the route table read them. */
const PREVIEW_PATHS = [
  '/preview',
  '/preview/editorial',
  '/preview/dev/fallback/complete',
  '/preview/g_7Hk-2/work/tide-tables',
  '/preview-assets',
  '/preview-assets/g_7Hk-2/asset/abc/large.webp',
  '/PREVIEW/x',
  '/Preview-Assets/x',
  '/%70review/x',
  '/preview%2Fx',
];

/** What is wrong with a preview response's headers but its CSP, which the caller checks. */
function previewHeaderProblems(response: Response): string[] {
  const expected = {
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': null,
  };
  return Object.entries(expected).flatMap(([name, value]) =>
    response.headers.get(name) === value ? [] : [`${name} is ${response.headers.get(name)}`],
  );
}

test("every preview response, in any case or percent-encoding, gets the preview's CSP with a nonce of its own, noindex, no-referrer, and private, no-store, 404s included (#7)", async (t) => {
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    const nonces = new Set<string>();
    for (const path of PREVIEW_PATHS) {
      // No preview route serves anything in this build, so each is a path no
      // route matches: on to Next's 404 page for GET and HEAD, under these
      // headers. The dev fixture route, which the table lists and only `next
      // dev` serves, goes there through the beforeFiles rewrite.
      for (const method of ['GET', 'HEAD']) {
        const response = proxy(request(path, method));
        const what = `${profile} ${method} ${path}`;
        if (path === '/preview/dev/fallback/complete') {
          assert.equal(
            response.headers.get('x-middleware-request-x-portfolio-not-found'),
            '1',
            what,
          );
        } else {
          assert.equal(decision(response), 'missing', what);
        }
        const csp = response.headers.get('content-security-policy') ?? '';
        const nonce = previewPolicy('https://rowan.test').exec(csp)?.[1];
        assert.ok(nonce, `${what}: ${csp}`);
        nonces.add(nonce);
        // On the request too, so Next puts the nonce on the page's scripts and styles.
        assert.equal(
          response.headers.get('x-middleware-request-content-security-policy'),
          csp,
          what,
        );
        assert.deepEqual(previewHeaderProblems(response), [], what);
        assert.equal(response.headers.get('x-middleware-request-x-studio-path'), null, what);
      }
      // Any other method is the plain 404, under the same headers.
      for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
        const response = proxy(request(path, method));
        const what = `${profile} ${method} ${path}`;
        assert.equal(response.status, 404, what);
        assert.equal(await response.text(), 'Not found.', what);
        const csp = response.headers.get('content-security-policy') ?? '';
        const nonce = previewPolicy('https://rowan.test').exec(csp)?.[1];
        assert.ok(nonce, `${what}: ${csp}`);
        nonces.add(nonce);
        assert.deepEqual(previewHeaderProblems(response), [], what);
      }
    }
    assert.equal(nonces.size, PREVIEW_PATHS.length * 6, `${profile}: a nonce came twice`);
  }
});

test('a preview request reaches Next without its Cookie header, so no preview route reads a session or a preference (#7)', (t) => {
  const cookie = '__Host-studio_session=anything; studio_session=anything; theme=dark';
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const path of PREVIEW_PATHS) {
      const response = proxy(new NextRequest(`https://rowan.test${path}`, { headers: { cookie } }));
      const what = `${profile} ${path}`;
      assert.equal(response.headers.get('x-middleware-next'), '1', what);
      // Next drops every request header the override list leaves out.
      assert.doesNotMatch(
        response.headers.get('x-middleware-override-headers') ?? '',
        /(?:^|,)\s*cookie\s*(?:,|$)/,
        what,
      );
      assert.equal(response.headers.get('x-middleware-request-cookie'), null, what);
    }
    // Any other path keeps the cookies it came with.
    for (const path of ['/', '/previews', '/no-such-page']) {
      const response = proxy(new NextRequest(`https://rowan.test${path}`, { headers: { cookie } }));
      assert.equal(
        response.headers.get('x-middleware-request-cookie'),
        cookie,
        `${profile} ${path}`,
      );
    }
  }
});

test("before startup a preview path's 503 keeps the preview's headers, and nothing may frame it (#7)", () => {
  setDeploymentState(undefined);
  for (const path of ['/preview/editorial', '/preview-assets/g/x.png', '/%70review']) {
    const response = proxy(request(path));
    assert.equal(response.status, 503, path);
    assert.match(response.headers.get('content-security-policy') ?? '', previewPolicy("'none'"));
    assert.deepEqual(previewHeaderProblems(response), [], path);
  }
  const other = proxy(request('/'));
  assert.equal(other.headers.get('content-security-policy'), null);
  assert.equal(other.headers.get('cache-control'), 'no-store');
});

test("no response outside /preview and /preview-assets gets the preview's headers, and Studio's stay Studio's (#7)", (t) => {
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const path of ['/', '/sample', '/previews', '/preview-asset', '/api/health', '/nowhere']) {
      const response = proxy(request(path));
      const what = `${profile} ${path}`;
      assert.doesNotMatch(
        response.headers.get('content-security-policy') ?? '',
        /default-src 'none'/,
        what,
      );
      assert.notEqual(response.headers.get('referrer-policy'), 'no-referrer', what);
      assert.notEqual(response.headers.get('x-robots-tag'), 'noindex, nofollow', what);
      assert.notEqual(response.headers.get('cache-control'), 'private, no-store', what);
    }
  }
  deploy(t, 'owner');
  assert.match(
    proxy(studio('/studio/sign-in')).headers.get('content-security-policy') ?? '',
    STUDIO_CSP,
  );
});

test('under the prefixes next.config.ts lets any origin read, only a GET or HEAD of a file Next serves there goes on to Next, and the rest is the plain 404, never a page (#7)', async (t) => {
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const method of ['GET', 'HEAD']) {
      const asset = proxy(request('/_next/static/chunks/app.js', method));
      assert.equal(asset.headers.get('x-middleware-next'), '1', `${profile} ${method}`);
      assert.equal(decision(asset), 'unlisted', `${profile} ${method}`);
      // #19's compiled packs, which the registry writes into public/_portfolio/pack/.
      // Marked missing, so one that isn't there gets the 404 page after Next looks in public/.
      const pack = proxy(request('/_portfolio/pack/0123456789ab.css', method));
      assert.equal(pack.headers.get('x-middleware-next'), '1', `${profile} ${method}`);
      assert.equal(decision(pack), 'missing', `${profile} ${method}`);
    }
    for (const [path, method] of [
      ['/_next/static/chunks/app.js', 'POST'],
      ['/_next/static/chunks/app.js', 'PUT'],
      ['/_next/static/chunks/app.js', 'DELETE'],
      ['/_next/static/chunks/app.js', 'OPTIONS'],
      // Spellings Next doesn't serve from disk, which would reach the 404 page.
      ['/_NEXT/STATIC/chunks/app.js', 'GET'],
      ['/_next/Static/chunks/app.js', 'GET'],
      ['/%5Fnext/static/chunks/app.js', 'GET'],
      ['/_next/static', 'GET'],
      ['/_portfolio', 'GET'],
      ['/_PORTFOLIO/pack/0123456789ab.css', 'GET'],
      ['/%5Fportfolio/pack/0123456789ab.css', 'GET'],
      ['/_portfolio/pack/0123456789ab.css', 'POST'],
      ['/_portfolio/pack/0123456789ab.css', 'OPTIONS'],
    ] as const) {
      const response = proxy(request(path, method));
      const what = `${profile} ${method} ${path}`;
      assert.equal(response.status, 404, what);
      assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8', what);
      assert.equal(await response.text(), 'Not found.', what);
    }
    // A path that only starts the same is any other path.
    assert.equal(decision(proxy(request('/_portfolios/x'))), 'missing', profile);
    assert.equal(decision(proxy(request('/_next/statics/x'))), 'unlisted', profile);
  }
});
