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
    for (const path of ['/admin', '/variants', '/preview/editorial', '/api/portfolio']) {
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
  // nothing to the 404 page's query.
  assert.deepEqual(rewrites.afterFiles, [
    {
      source: '/(.*)',
      has: [{ type: 'header', key: ROUTE_HEADER, value: 'missing' }],
      destination: '/_not-found',
    },
  ]);
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

test("under a profile with no Studio page, /studio is as unknown as any path: none of Studio's headers, and Next's 404 page for the ones the table lists", (t) => {
  for (const profile of ['demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const path of [
      '/studio',
      '/studio/sign-in',
      '/studio/sign-in?state=failed',
      '/%73tudio',
    ]) {
      const response = proxy(studio(path));
      const what = `${profile} ${path}`;
      // On to Next, marked for next.config.ts's rewrite to the 404 page.
      assert.equal(response.headers.get('x-middleware-next'), '1', what);
      assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), '1', what);
      assert.equal(response.headers.get('x-middleware-request-x-studio-path'), null, what);
      assert.equal(
        response.headers.get('cache-control'),
        'private, no-cache, no-store, max-age=0, must-revalidate',
        what,
      );
      for (const name of [
        'content-security-policy',
        'referrer-policy',
        'cross-origin-resource-policy',
        'x-middleware-request-content-security-policy',
      ]) {
        assert.equal(response.headers.get(name), null, `${what}: ${name}`);
      }
      assert.match(response.headers.get('x-request-id') ?? '', UUID, what);
    }
    // A Studio path the table doesn't list goes on unmarked, as any unknown path does.
    for (const path of ['/studio/nowhere', '/Studio']) {
      const response = proxy(studio(path));
      assert.equal(response.headers.get('x-middleware-next'), '1', path);
      assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), null, path);
      assert.equal(response.headers.get('content-security-policy'), null, path);
    }
  }
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
