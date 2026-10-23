import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { fixtureFlags } from '../scripts/fixture-gate';
import { PROFILES, type Profile } from './server/capabilities';
import { readDeploymentConfig } from './server/config';
import type { CatalogReader, LiveRevision } from './server/catalog-port';
import {
  getDeploymentState,
  RECHECK_MS,
  setDeploymentState,
  setLiveComposition,
  setServable,
} from './server/config-store';
import type { PreviewGrantsPort } from './server/preview-port';
import { readiness } from './server/readiness';
import { EXPERIENCE_HEADER } from './server/route-header';
import { ROUTE_HEADER } from './server/routes';
import { PREVIEW_STATUS_DOCUMENT } from './preview/status';
import { COMPILED_MODE } from './server/compiled-mode';
import { PORTFOLIO_FILES } from './server/portfolio-files';
import { previewCsp } from './server/preview-headers';
import { studioCsp } from './server/studio-headers';

// proxy.ts: 404 early for what the profile doesn't serve, a fresh request ID
// on everything else, noindex on every demo response, 503 before register()
// has stored the deployment, with readiness's own body for /api/ready, a
// static 503 page for visitor pages while the catalog can't serve (#5), and
// the route table's decision on every request it passes on, so next.config.ts
// sends a path no route renders to the app's 404 page (#5, Slice 4). A
// visitor page's GET or HEAD goes on marked with its composition's
// experience segment, which next.config.ts rewrites it to, and any other
// method to it is a 405 (#6, Slice 2).

function deploy(
  t: TestContext,
  profile: Profile,
  previews?: PreviewGrantsPort,
  env: Record<string, string> = {},
): void {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: profile,
      PORTFOLIO_ORIGIN: 'https://rowan.test',
      ...(profile === 'demo' ? {} : { PORTFOLIO_SOURCE_DIR: '/srv/config' }),
      ...env,
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  setDeploymentState({
    config: read.config,
    catalog: { getLive: () => assert.fail('the proxy reads no catalog') },
    dispatch: () => assert.fail('the proxy runs no operation'),
    degraded: [],
    ...(previews ? { previews } : {}),
  });
  t.after(() => setDeploymentState(undefined));
}

/** A grant the fake owner port finds active, and one it never minted (#7). */
const ACTIVE = 'AAAAAAAAAAAAAAAAAAAAAA';
const ENDED = 'BBBBBBBBBBBBBBBBBBBBBB';

/** The owner composition's grant port, as proxy.ts sees it: it admits ACTIVE alone, and counts each check. */
function grantsPort(admitted = new Set([ACTIVE])) {
  const checked: string[] = [];
  const port: PreviewGrantsPort = {
    admit: async (grant) => {
      checked.push(grant);
      return admitted.has(grant);
    },
    open: () => assert.fail('proxy.ts opens no grant'),
    channel: () => assert.fail("proxy.ts reads no grant's channel"),
    previewable: () => assert.fail('proxy.ts offers nothing to preview'),
  };
  return { port, checked };
}

/**
 * The marks only proxy.ts may set, as a client would send them: each test's
 * request carries them, so a mark that leaks through fails it.
 */
const CLIENT_MARKS = {
  'x-request-id': 'client-chosen',
  [ROUTE_HEADER]: 'client-chosen',
  [EXPERIENCE_HEADER]: 'acme-chosen',
};

function request(path: string, method = 'GET'): NextRequest {
  return new NextRequest(`https://rowan.test${path}`, { method, headers: CLIENT_MARKS });
}

/** Whether the request goes on to Next. proxy.ts rewrites none itself (#6, Slice 2). */
const onward = (response: Response) => {
  assert.equal(response.headers.get('x-middleware-rewrite'), null, 'proxy.ts rewrites nothing');
  return response.headers.get('x-middleware-next') === '1';
};

/** The route table's decision as the request Next routes carries it, or null when it goes no further. */
const decision = (response: Response) =>
  onward(response) ? response.headers.get(`x-middleware-request-${ROUTE_HEADER}`) : null;

/**
 * The experience segment the request Next routes names, which next.config.ts
 * rewrites it to (#6, Slice 2), or null when it names none or goes no further.
 */
const segment = (response: Response) =>
  onward(response) ? response.headers.get(`x-middleware-request-${EXPERIENCE_HEADER}`) : null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('before register() stores the deployment, every request is 503', async () => {
  setDeploymentState(undefined);
  const response = await proxy(request('/'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('x-request-id') ?? '', UUID);
});

test('before startup, /api/ready answers with the starting body readiness documents', async () => {
  setDeploymentState(undefined);
  const response = await proxy(request('/api/ready'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('x-request-id') ?? '', UUID);
  const starting = await readiness(undefined, {
    variantHealth: () => assert.fail('nothing loads before startup'),
    loadedOwnerModules: () => [],
  });
  assert.deepEqual(await response.json(), starting.body);
});

test('a served path passes through with a fresh request ID, whatever the client sent', async (t) => {
  deploy(t, 'read-only');
  for (const path of ['/', '/feed.xml', '/api/studio/config.status', '/_next/static/a.js']) {
    const response = await proxy(request(path));
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
    // The home page goes on marked with its experience segment (#6, Slice 2).
    assert.equal(segment(response), path === '/' ? 'fallback' : null, path);
    const id = response.headers.get('x-request-id') ?? '';
    assert.match(id, UUID, path);
    // The id the route handler sees on the request is the same fresh one.
    assert.equal(response.headers.get('x-middleware-request-x-request-id'), id, path);
    assert.match(response.headers.get('x-middleware-override-headers') ?? '', /x-request-id/);
    // So is the table's decision, in place of the one the client sent.
    assert.equal(decision(response), path.startsWith('/_next/') ? 'unlisted' : 'served', path);
  }
  const first = (await proxy(request('/'))).headers.get('x-request-id');
  const second = (await proxy(request('/'))).headers.get('x-request-id');
  assert.notEqual(first, second);
});

test('retired routes are 404 in every profile, and only their exact paths', async (t) => {
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const path of ['/admin', '/variants', '/api/portfolio']) {
      const response = await proxy(request(path));
      assert.equal(response.status, 404, `${profile} ${path}`);
      assert.equal(await response.text(), 'Not found.');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('x-request-id') ?? '', UUID);
    }
    // A path below one names nothing: a file in public/, or else the app's 404 page.
    assert.equal(decision(await proxy(request('/variants/kinetic-cosmos/a.png'))), 'missing');
  }
});

test('next.config.ts sends a request marked missing to the 404 page, after public/', async () => {
  const { default: config } = await import('../next.config');
  const rewrites = await config.rewrites?.();
  assert.ok(rewrites && !Array.isArray(rewrites), 'rewrites in phases');
  // afterFiles: Next has looked in public/ first. An unnamed group adds
  // nothing to the 404 page's query. The router prefetch rule for /_next/
  // follows it, and then the experience segments' rule (#6, Slice 2), which
  // headers.test.ts checks.
  assert.deepEqual(rewrites.afterFiles?.[0], {
    source: '/(.*)',
    has: [{ type: 'header', key: ROUTE_HEADER, value: 'missing' }],
    destination: '/_not-found',
  });
  assert.equal(rewrites.afterFiles?.length, 3);
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
        const response = await proxy(request(path, method));
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
        const response = await proxy(request(path, method));
        assert.equal(response.status, 404, `${profile} ${method} ${path.slice(0, 40)}`);
        assert.equal(decision(response), null);
        assert.equal(await response.text(), 'Not found.');
      }
    }
  }
});

test('under demo, a /sample path or ?variant= that names nothing is missing too', async (t) => {
  deploy(t, 'demo');
  for (const path of [
    '/sample?variant=fallback',
    '/sample?variant=canary-variant',
    '/sample?variant=',
    '/sample/nowhere',
    '/sample/work/x',
  ]) {
    assert.equal(decision(await proxy(request(path))), 'missing', path);
  }
  assert.equal(decision(await proxy(request('/sample'))), 'served');
});

test("a route outside the profile's matrix is 404 early", async (t) => {
  deploy(t, 'demo');
  assert.equal((await proxy(request('/feed.xml'))).status, 404);
  assert.equal(segment(await proxy(request('/'))), 'fallback');
});

test('under demo every response asks crawlers not to index it, and elsewhere none does', async (t) => {
  const paths = ['/', '/sample', '/feed.xml', '/admin', '/_next/static/chunks/app.js', '/nowhere'];
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    await t.test(profile, async (t) => {
      deploy(t, profile);
      for (const path of paths) {
        const tag = (await proxy(request(path))).headers.get('x-robots-tag');
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
    const response = await proxy(request(path));
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
    assert.equal((await proxy(request(path))).headers.get('x-middleware-next'), '1', path);
  }
  assert.equal((await proxy(request('/admin'))).status, 404);
  // A path no route renders is the 404 page, whatever the catalog's state.
  assert.equal(decision(await proxy(request('/nowhere'))), 'missing');
  // Servable again, the page goes on to its experience segment.
  setServable(true);
  assert.equal(segment(await proxy(request('/'))), 'fallback');
});

test('demo serves /sample, a visitor page, under the same rule', async (t) => {
  deploy(t, 'demo');
  setServable(false);
  t.after(() => setServable(true));
  assert.equal((await proxy(request('/sample'))).status, 503);
  assert.equal((await proxy(request('/sample'))).headers.get('x-robots-tag'), 'noindex');
});

/** The deployment deploy() stored, reading `catalog` in place of the one that fails. */
function reading(catalog: CatalogReader): void {
  const state = getDeploymentState();
  assert.ok(state, 'deploy() first');
  setDeploymentState({ ...state, catalog });
}

const NOTHING_SERVES: LiveRevision = {
  state: 'incompatible',
  revisionId: null,
  unitHash: null,
  unit: null,
};

/**
 * A catalog that, as owner's reader does, sets the servable flag on every
 * read: to what `servable()` says, once `ready` settles. It counts reads.
 */
function ownerCatalog(servable: () => boolean, ready: Promise<unknown> = Promise.resolve()) {
  const reads = { count: 0 };
  const catalog: CatalogReader = {
    getLive: async () => {
      reads.count += 1;
      await ready;
      setServable(servable());
      // proxy.ts goes by the flag, never by what this returns.
      return NOTHING_SERVES;
    },
  };
  return { catalog, reads };
}

/** A response's status, its headers but the request ID, and its body. */
async function shape(response: Response) {
  const headers = [...response.headers].filter(([name]) => name !== 'x-request-id');
  return { status: response.status, headers, body: await response.text() };
}

/** Lets every promise that can settle now settle. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

test('while nothing serves, a visitor page asks the catalog once more before the 503, and goes on to Next once it serves (#3)', async (t) => {
  deploy(t, 'owner');
  setServable(false);
  t.after(() => setServable(true));
  let up = false;
  const { catalog, reads } = ownerCatalog(() => up);
  reading(catalog);
  for (const path of ['/', '/feed.xml']) {
    const down = await proxy(request(path));
    assert.equal(down.status, 503, path);
    assert.match(await down.text(), /<h1>Temporarily unavailable<\/h1>/, path);
  }
  assert.equal(reads.count, 2);
  // Another process publishes: the next request's read finds it, and that request goes on.
  up = true;
  const back = await proxy(request('/'));
  assert.equal(back.headers.get('x-middleware-next'), '1');
  assert.equal(decision(back), 'served');
  assert.equal(reads.count, 3);
  // Servable now, the requests after it read nothing.
  assert.equal(decision(await proxy(request('/feed.xml'))), 'served');
  assert.equal(reads.count, 3);
});

test('a catalog read that takes longer than RECHECK_MS gets the same 503 at RECHECK_MS, and so does one that throws, at once (#3)', async (t) => {
  deploy(t, 'owner');
  setServable(false);
  t.after(() => setServable(true));
  reading(ownerCatalog(() => false).catalog);
  const today = await shape(await proxy(request('/')));
  assert.equal(today.status, 503);

  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: () => void;
  const slow = ownerCatalog(
    () => true,
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  reading(slow.catalog);
  let answered = false;
  const answer = proxy(request('/')).finally(() => {
    answered = true;
  });
  await settled();
  t.mock.timers.tick(RECHECK_MS - 1);
  await settled();
  assert.equal(answered, false);
  t.mock.timers.tick(1);
  await settled();
  assert.equal(answered, true);
  assert.deepEqual(await shape(await answer), today);
  // The read goes on, and once it ends the flag lets the next request through.
  finish();
  await settled();
  assert.equal(decision(await proxy(request('/'))), 'served');
  assert.equal(slow.reads.count, 1);
  t.mock.timers.reset();

  const failing: Array<CatalogReader['getLive']> = [
    () => {
      throw new Error('EIO: the disk');
    },
    async () => {
      throw new Error('EIO: the disk');
    },
  ];
  for (const getLive of failing) {
    setServable(false);
    reading({ getLive });
    const response = await proxy(request('/'));
    assert.deepEqual(await shape(response), today);
  }
});

test('requests that come while the catalog reads again wait on that one read (#3)', async (t) => {
  deploy(t, 'owner');
  setServable(false);
  t.after(() => setServable(true));
  let up = true;
  let release!: () => void;
  const { catalog, reads } = ownerCatalog(
    () => up,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  reading(catalog);
  const answers = ['/', '/feed.xml', '/', '/sitemap.xml', '/robots.txt'].map((path) =>
    proxy(request(path)),
  );
  await settled();
  assert.equal(reads.count, 1);
  release();
  for (const response of await Promise.all(answers)) assert.equal(decision(response), 'served');
  assert.equal(reads.count, 1);
  // Nothing serves again later: the next request reads again, once.
  up = false;
  setServable(false);
  assert.equal((await proxy(request('/'))).status, 503);
  assert.equal(reads.count, 2);
});

test('a request while the catalog serves never reads it, in every profile (#3)', async (t) => {
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    const { catalog, reads } = ownerCatalog(() => true);
    reading(catalog);
    for (const path of [
      '/',
      '/sample',
      '/feed.xml',
      '/sitemap.xml',
      '/robots.txt',
      '/opengraph-image-12o0cb',
      '/api/ready',
      '/studio/sign-in',
      '/_next/static/a.js',
      '/nowhere',
    ]) {
      await proxy(request(path));
    }
    assert.equal(reads.count, 0, profile);
  }
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

test('every /studio response gets a nonce CSP of its own, which the page Next renders reads too', async (t) => {
  deploy(t, 'owner');
  const nonces = new Set<string>();
  for (const path of ['/studio/sign-in', '/studio/sign-in', '/studio/sign-in?state=failed']) {
    const response = await proxy(studio(path));
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
    assert.equal((await proxy(studio(path))).headers.get('content-security-policy'), null, path);
  }
});

test("under owner every /studio response, in any case or percent-encoding, gets Studio's CSP, Referrer-Policy, and Cross-Origin-Resource-Policy, redirects and 404s included", async (t) => {
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
    const response = await proxy(studio(path));
    assert.match(response.headers.get('content-security-policy') ?? '', STUDIO_CSP, path);
    assert.equal(response.headers.get('referrer-policy'), 'same-origin', path);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin', path);
  }
  // /studio with no session cookie is proxy.ts's own 303.
  assert.equal((await proxy(studio('/studio'))).status, 303);
  assert.equal((await proxy(studio('/%73tudio'))).status, 303);
  // Outside /studio, none of them.
  for (const path of ['/', '/studios', '/sample', '/api/studio/auth.session']) {
    const response = await proxy(studio(path));
    assert.equal(response.headers.get('referrer-policy'), null, path);
    assert.equal(response.headers.get('cross-origin-resource-policy'), null, path);
  }
});

test("under owner the plain 404 for a missing /studio path, to a method but GET or HEAD, keeps Studio's headers (#5, Slice 4)", async (t) => {
  deploy(t, 'owner');
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await proxy(studio('/studio/nowhere', {}, method));
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
        const response = await proxy(studio(path, {}, method));
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
        const response = await proxy(studio(path, {}, method));
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
      const unknown = await proxy(studio('/no-such-page', {}, method));
      for (const path of [...LISTED_STUDIO_PATHS, ...UNLISTED_STUDIO_PATHS]) {
        const response = await proxy(studio(path, {}, method));
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

test('a route no profile of this build serves, as the appearance fixtures are without APPEARANCE_FIXTURES=1, is as unknown as any path in every profile (#19, Slice 3)', async (t) => {
  // The page and its spellings the table reads as the page, which go to the
  // 404 page ahead of Next's file check, and paths beside it, which go on
  // marked missing, as /no-such-page does.
  const listed = [
    '/_fixtures/appearance',
    '/%5Ffixtures/appearance',
    '/_fixtures/%61ppearance',
    '/_fixtures%2Fappearance',
  ];
  const beside = ['/_FIXTURES/appearance', '/_fixtures/appearance/x', '/_fixtures'];
  for (const profile of PROFILES) {
    deploy(t, profile);
    // What this run's environment asked registry generation for, never the code under test.
    if (fixtureFlags(process.env).appearance) {
      // A build made with the flag serves the page, to anyone, in every profile.
      assert.equal(decision(await proxy(request('/_fixtures/appearance'))), 'served', profile);
      continue;
    }
    for (const method of ['GET', 'HEAD']) {
      const unknown = await proxy(request('/no-such-page', method));
      assert.equal(decision(unknown), 'missing');
      for (const path of listed) {
        const response = await proxy(request(path, method));
        const what = `${profile} ${method} ${path}`;
        assert.equal(response.headers.get('x-middleware-next'), '1', what);
        assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), '1', what);
        assert.equal(decision(response), null, what);
        assert.equal(response.headers.get('cache-control'), UNKNOWN_PATH_CACHE_CONTROL, what);
        assert.equal(response.headers.get('x-robots-tag'), unknown.headers.get('x-robots-tag'));
      }
      for (const path of beside) {
        const response = await proxy(request(path, method));
        const what = `${profile} ${method} ${path}`;
        assert.equal(decision(response), 'missing', what);
        for (const name of [
          'cache-control',
          'x-robots-tag',
          'x-middleware-request-x-portfolio-not-found',
        ]) {
          assert.equal(response.headers.get(name), unknown.headers.get(name), `${what}: ${name}`);
        }
      }
    }
    // Any other method gets the plain 404 /no-such-page gets.
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const unknown = await proxy(request('/no-such-page', method));
      for (const path of [...listed, ...beside]) {
        const response = await proxy(request(path, method));
        const what = `${profile} ${method} ${path}`;
        assert.equal(response.status, 404, what);
        assert.equal(await response.text(), 'Not found.', what);
        for (const name of ['content-type', 'cache-control', 'x-robots-tag']) {
          assert.equal(response.headers.get(name), unknown.headers.get(name), `${what}: ${name}`);
        }
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
        const response = await proxy(request(path, method));
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
        const response = await proxy(request(path, method));
        assert.equal(response.status, 404, `${profile} ${method} ${path}`);
        assert.equal(await response.text(), 'Not found.');
      }
    }
  }
  // A route the profile doesn't serve is its plain 404 in either spelling.
  deploy(t, 'demo');
  for (const path of ['/feed.xml', '/%66eed.xml']) {
    const response = await proxy(request(path));
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), 'Not found.', path);
  }
  // A dynamic segment spelled encoded is still the route's: Next decodes it.
  deploy(t, 'read-only');
  assert.equal(decision(await proxy(request('/api/studio/%63onfig.status'))), 'served');
});

test("under owner a Studio page spelled with a fixed segment percent-encoded is the 404 page with Studio's headers, its request carrying the policy for the page's nonce", async (t) => {
  deploy(t, 'owner');
  const cookie = { cookie: '__Host-studio_session=anything' };
  for (const [path, headers] of [
    ['/%73tudio/sign-in', {}],
    ['/studio/%73ign-in', {}],
    ['/%73tudio', cookie],
  ] as const) {
    const response = await proxy(studio(path, headers));
    assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), '1', path);
    const csp = response.headers.get('content-security-policy') ?? '';
    assert.match(csp, STUDIO_CSP, path);
    assert.equal(response.headers.get('x-middleware-request-content-security-policy'), csp, path);
    assert.equal(response.headers.get('referrer-policy'), 'same-origin', path);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin', path);
    assert.equal(response.headers.get('x-middleware-request-x-studio-path'), null, path);
  }
  // A page for a session, asked for with no session cookie, is the 303 first.
  assert.equal((await proxy(studio('/%73tudio'))).status, 303);
  // Any other method is the plain 404, which keeps Studio's headers.
  const posted = await proxy(studio('/%73tudio/sign-in', {}, 'POST'));
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
        const response = await proxy(request(path, method));
        const what = `${profile} ${method} ${path}`;
        assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), '1', what);
        assert.equal(decision(response), null, what);
        assert.equal(response.headers.get('cache-control'), UNKNOWN_PATH_CACHE_CONTROL, what);
      }
      const posted = await proxy(request(path, 'POST'));
      assert.equal(posted.status, 404, `${profile} POST ${path}`);
      assert.equal(await posted.text(), 'Not found.');
    }
  }
  // Under owner, a Studio one carries Studio's policy on the request, for the page's nonce.
  deploy(t, 'owner');
  const page = await proxy(studio('/studio%2Fsign-in'));
  const csp = page.headers.get('content-security-policy') ?? '';
  assert.match(csp, STUDIO_CSP);
  assert.equal(page.headers.get('x-middleware-request-content-security-policy'), csp);
  // A path that names nothing and no route file goes on marked missing, for the afterFiles rewrite.
  assert.equal(decision(await proxy(request('/work%2Fx'))), 'missing');
});

test('a Studio page learns the path asked for from proxy.ts alone, never from the client', async (t) => {
  deploy(t, 'owner');
  const forged = { 'x-studio-path': '/studio/elsewhere' };
  const asked = await proxy(studio('/studio/sign-in?returnTo=%2Fstudio', forged));
  assert.equal(
    asked.headers.get('x-middleware-request-x-studio-path'),
    '/studio/sign-in?returnTo=%2Fstudio',
  );
  // Outside /studio a client's header is dropped before the route sees it.
  const outside = await proxy(studio('/', forged));
  assert.equal(outside.headers.get('x-middleware-request-x-studio-path'), null);
  assert.doesNotMatch(outside.headers.get('x-middleware-override-headers') ?? '', /x-studio-path/);
  // So is a client's 404 mark, on every path it reaches the app on.
  for (const path of ['/', '/studio/sign-in']) {
    const marked = await proxy(studio(path, { 'x-portfolio-not-found': '1' }));
    assert.equal(marked.headers.get('x-middleware-request-x-portfolio-not-found'), null, path);
    assert.doesNotMatch(
      marked.headers.get('x-middleware-override-headers') ?? '',
      /x-portfolio-not-found/,
      path,
    );
  }
});

test('under owner a Studio page for a session, asked for with no session cookie, is a 303 to sign-in, kept to GET and HEAD', async (t) => {
  deploy(t, 'owner');
  for (const method of ['GET', 'HEAD']) {
    const response = await proxy(studio('/studio', {}, method));
    assert.equal(response.status, 303, method);
    assert.equal(response.headers.get('location'), 'https://rowan.test/studio/sign-in', method);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy') ?? '', STUDIO_CSP);
    assert.match(response.headers.get('x-request-id') ?? '', UUID);
  }
  // Where the owner was going comes along, made safe, on the canonical origin.
  const deep = await proxy(studio('/studio?tab=drafts', { host: 'attacker.test' }));
  assert.equal(
    deep.headers.get('location'),
    'https://rowan.test/studio/sign-in?returnTo=%2Fstudio%3Ftab%3Ddrafts',
  );
  // With any cookie of the session's name, or for sign-in itself, the page decides.
  assert.equal(
    (await proxy(studio('/studio', { cookie: '__Host-studio_session=anything' }))).headers.get(
      'x-middleware-next',
    ),
    '1',
  );
  assert.equal((await proxy(studio('/studio/sign-in'))).headers.get('x-middleware-next'), '1');
  // A cookie of another name is no session cookie.
  assert.equal((await proxy(studio('/studio', { cookie: 'studio_session=anything' }))).status, 303);
  // Another method goes on to the page, which answers it.
  assert.equal((await proxy(studio('/studio', {}, 'POST'))).headers.get('x-middleware-next'), '1');
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
    deploy(t, profile, profile === 'owner' ? grantsPort().port : undefined);
    const nonces = new Set<string>();
    for (const path of PREVIEW_PATHS) {
      // Under demo and read-only no grant route is served, so each is a path
      // no route matches: on to Next's 404 page for GET and HEAD. The dev
      // fixture route, which the table lists and only `next dev` serves, goes
      // there through the beforeFiles rewrite. Under owner, with no grant
      // active, each is the status document (Slice 2).
      for (const method of ['GET', 'HEAD']) {
        const response = await proxy(request(path, method));
        const what = `${profile} ${method} ${path}`;
        const csp = response.headers.get('content-security-policy') ?? '';
        const nonce = previewPolicy('https://rowan.test').exec(csp)?.[1];
        assert.ok(nonce, `${what}: ${csp}`);
        nonces.add(nonce);
        assert.deepEqual(previewHeaderProblems(response), [], what);
        assert.equal(response.headers.get('x-middleware-request-x-studio-path'), null, what);
        if (profile === 'owner') {
          assert.equal(response.status, 404, what);
          assert.equal(decision(response), null, what);
          assert.equal(await response.text(), PREVIEW_STATUS_DOCUMENT, what);
          continue;
        }
        // A path the table calls missing, or a grant route the profile
        // doesn't serve, marked for the 404 page as Studio's are (#2).
        assert.ok(
          decision(response) === 'missing' ||
            response.headers.get('x-middleware-request-x-portfolio-not-found') === '1',
          what,
        );
        // On the request too, so Next puts the nonce on the page's scripts and styles.
        assert.equal(
          response.headers.get('x-middleware-request-content-security-policy'),
          csp,
          what,
        );
      }
      // Any other method is the plain 404, or under owner the status
      // document, under the same headers.
      for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
        const response = await proxy(request(path, method));
        const what = `${profile} ${method} ${path}`;
        assert.equal(response.status, 404, what);
        assert.equal(
          await response.text(),
          profile === 'owner' ? PREVIEW_STATUS_DOCUMENT : 'Not found.',
          what,
        );
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

test('a preview request reaches Next without its Cookie header, so no preview route reads a session or a preference (#7)', async (t) => {
  const cookie = '__Host-studio_session=anything; studio_session=anything; theme=dark';
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile, profile === 'owner' ? grantsPort().port : undefined);
    // Under owner only an active grant's frame load goes on to Next; every
    // other preview request is answered here, and never reaches a route.
    const paths =
      profile === 'owner'
        ? [`/preview/${ACTIVE}`, `/preview/${ACTIVE}?displayMode=dark`]
        : PREVIEW_PATHS;
    for (const path of paths) {
      const response = await proxy(
        new NextRequest(`https://rowan.test${path}`, {
          headers: { cookie, 'sec-fetch-dest': 'iframe' },
        }),
      );
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
      const response = await proxy(
        new NextRequest(`https://rowan.test${path}`, { headers: { cookie } }),
      );
      assert.equal(
        response.headers.get('x-middleware-request-cookie'),
        cookie,
        `${profile} ${path}`,
      );
    }
  }
});

/** A request with Fetch Metadata's destination, as a browser sends it, and a session cookie. */
function loaded(path: string, destination: string | null, method = 'GET'): NextRequest {
  return new NextRequest(`https://rowan.test${path}`, {
    method,
    headers: {
      cookie: 'studio_session=anything',
      ...(destination === null ? {} : { 'sec-fetch-dest': destination }),
    },
  });
}

/** What proxy.ts answers for itself with the status document: never on to Next. */
async function assertStatusDocument(response: Response, what: string) {
  assert.equal(response.status, 404, what);
  assert.equal(response.headers.get('x-middleware-next'), null, what);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8', what);
  assert.equal(response.headers.get('set-cookie'), null, what);
  assert.match(
    response.headers.get('content-security-policy') ?? '',
    previewPolicy('https://rowan.test'),
    what,
  );
  assert.deepEqual(previewHeaderProblems(response), [], what);
  assert.equal(await response.text(), PREVIEW_STATUS_DOCUMENT, what);
}

test('under owner a grant path goes on to Next only as an iframe document load, or an asset load of an image, video, audio, track, or font, for a grant the owner composition finds active (#7)', async (t) => {
  const { port, checked } = grantsPort();
  deploy(t, 'owner', port);
  const asset = (grant: string) => `/preview-assets/${grant}/a1/${'0'.repeat(64)}/large.webp`;
  const admitted: [string, string, string][] = [
    [`/preview/${ACTIVE}`, 'iframe', 'GET'],
    [`/preview/${ACTIVE}`, 'iframe', 'HEAD'],
    ...['image', 'video', 'audio', 'track', 'font'].map(
      (destination) => [asset(ACTIVE), destination, 'GET'] as [string, string, string],
    ),
  ];
  for (const [path, destination, method] of admitted) {
    const response = await proxy(loaded(path, destination, method));
    const what = `${method} ${path} as ${destination}`;
    assert.equal(decision(response), 'served', what);
    // Without its cookie, and with the CSP's nonce on the request.
    assert.equal(response.headers.get('x-middleware-request-cookie'), null, what);
    assert.equal(
      response.headers.get('x-middleware-request-content-security-policy'),
      response.headers.get('content-security-policy'),
      what,
    );
    assert.deepEqual(previewHeaderProblems(response), [], what);
  }
  checked.length = 0;

  // A top-level load, a wrong destination, or no Fetch Metadata at all:
  // turned away before the grant is even read.
  const misdirected: [string, string | null][] = [
    ...[null, 'document', 'empty', 'image', 'script', 'style', 'object', 'embed', 'frame'].map(
      (destination) => [`/preview/${ACTIVE}`, destination] as [string, string | null],
    ),
    ...[null, 'document', 'iframe', 'empty', 'script', 'style'].map(
      (destination) => [asset(ACTIVE), destination] as [string, string | null],
    ),
  ];
  for (const [path, destination] of misdirected) {
    await assertStatusDocument(await proxy(loaded(path, destination)), `${path} as ${destination}`);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    await assertStatusDocument(await proxy(loaded(`/preview/${ACTIVE}`, 'iframe', method)), method);
  }
  // Spelled so Next routes it elsewhere: not a grant path to Next.
  await assertStatusDocument(await proxy(loaded(`/%70review/${ACTIVE}`, 'iframe')), 'encoded');
  assert.deepEqual(checked, [], 'none of those asked about the grant');

  // A grant that isn't active, or that names none.
  for (const grant of [ENDED, 'local', 'x', `${ACTIVE}x`]) {
    await assertStatusDocument(await proxy(loaded(`/preview/${grant}`, 'iframe')), grant);
    await assertStatusDocument(await proxy(loaded(asset(grant), 'image')), `${grant} asset`);
  }
  assert.deepEqual(checked, [ENDED, ENDED, 'local', 'local', 'x', 'x', `${ACTIVE}x`, `${ACTIVE}x`]);
});

test('a grant path never goes to sign-in, and the status document is the one answer for every reason it turns a request away (#7)', async (t) => {
  deploy(t, 'owner', grantsPort().port);
  const shape = async (response: Response) => ({
    status: response.status,
    location: response.headers.get('location'),
    type: response.headers.get('content-type'),
    cache: response.headers.get('cache-control'),
    body: await response.text(),
  });
  const reasons = [
    loaded(`/preview/${ENDED}`, 'iframe'),
    loaded(`/preview/${ACTIVE}`, 'document'),
    loaded(`/preview/${ACTIVE}`, null),
    loaded(`/preview/${ACTIVE}`, 'iframe', 'POST'),
    loaded(`/preview/${ACTIVE}/no-such-view`, 'iframe'),
    loaded('/preview', 'iframe'),
    loaded(`/preview-assets/${ENDED}/x`, 'image'),
    new NextRequest(`https://rowan.test/preview/${ENDED}`),
  ];
  const answers = await Promise.all(reasons.map(async (each) => shape(await proxy(each))));
  for (const answer of answers) assert.deepEqual(answer, answers[0]);
  assert.equal(answers[0]!.status, 404);
  assert.equal(answers[0]!.location, null);
  assert.equal(answers[0]!.cache, 'private, no-store');
});

test('a port that fails to check a grant admits nothing (#7)', async (t) => {
  deploy(t, 'owner', {
    admit: () => Promise.reject(new Error('the data directory is gone')),
    open: () => assert.fail('proxy.ts opens no grant'),
    channel: () => assert.fail("proxy.ts reads no grant's channel"),
    previewable: () => assert.fail('proxy.ts offers nothing to preview'),
  });
  await assertStatusDocument(await proxy(loaded(`/preview/${ACTIVE}`, 'iframe')), 'failed check');
});

test('a trailing slash is a 308 to the path without it, under the headers its path gets: a preview path, grant or not, gets private, no-store (#7)', async (t) => {
  const { port, checked } = grantsPort();
  deploy(t, 'owner', port);
  const redirect = async (path: string, to: string) => {
    const response = await proxy(loaded(path, 'iframe'));
    assert.equal(response.status, 308, path);
    assert.equal(response.headers.get('location'), `https://rowan.test${to}`, path);
    assert.equal(response.headers.get('x-middleware-next'), null, path);
    assert.match(response.headers.get('x-request-id') ?? '', UUID, path);
    return response;
  };
  for (const [path, to] of [
    [`/preview/${ACTIVE}/`, `/preview/${ACTIVE}`],
    [`/preview/${ENDED}/`, `/preview/${ENDED}`],
    [`/preview/${ACTIVE}/work/x/?displayMode=dark`, `/preview/${ACTIVE}/work/x?displayMode=dark`],
    [`/preview-assets/${ACTIVE}/a/b/`, `/preview-assets/${ACTIVE}/a/b`],
    ['/preview/', '/preview'],
  ]) {
    const response = await redirect(path!, to!);
    assert.deepEqual(previewHeaderProblems(response), [], path);
    assert.match(
      response.headers.get('content-security-policy') ?? '',
      previewPolicy('https://rowan.test'),
    );
  }
  assert.deepEqual(checked, [], 'the 308 never depends on a grant');
  // Elsewhere, the 308 Next sent, with that path's own headers.
  const work = await redirect('/work/x/?a=1', '/work/x?a=1');
  assert.equal(work.headers.get('cache-control'), null);
  assert.equal(work.headers.get('content-security-policy'), null);
  const studio = await redirect('/studio/', '/studio');
  assert.match(studio.headers.get('content-security-policy') ?? '', STUDIO_CSP);
  assert.equal(segment(await proxy(request('/'))), 'fallback');
  // Under a profile with no grant route, a preview path's 308 is the same.
  deploy(t, 'demo');
  const demo = await redirect('/preview/x/', '/preview/x');
  assert.deepEqual(previewHeaderProblems(demo), [], 'demo');
});

test("before startup a preview path's 503 keeps the preview's headers, and nothing may frame it (#7)", async () => {
  setDeploymentState(undefined);
  for (const path of ['/preview/editorial', '/preview-assets/g/x.png', '/%70review']) {
    const response = await proxy(request(path));
    assert.equal(response.status, 503, path);
    assert.match(response.headers.get('content-security-policy') ?? '', previewPolicy("'none'"));
    assert.deepEqual(previewHeaderProblems(response), [], path);
  }
  const other = await proxy(request('/'));
  assert.equal(other.headers.get('content-security-policy'), null);
  assert.equal(other.headers.get('cache-control'), 'no-store');
});

test("no response outside /preview and /preview-assets gets the preview's headers, and Studio's stay Studio's (#7)", async (t) => {
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const path of ['/', '/sample', '/previews', '/preview-asset', '/api/health', '/nowhere']) {
      const response = await proxy(request(path));
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
    (await proxy(studio('/studio/sign-in'))).headers.get('content-security-policy') ?? '',
    STUDIO_CSP,
  );
});

test('under the prefixes next.config.ts lets any origin read, only a GET or HEAD of a build asset, or of exactly a file the registry wrote under /_portfolio/, goes on to Next, and the rest is the plain 404, never a page (#7)', async (t) => {
  // #19's compiled packs, which the registry writes into public/_portfolio/pack/.
  const written = [...PORTFOLIO_FILES];
  const pack = written.find((file) => /^\/_portfolio\/pack\/_[^/]+\.css$/.test(file))!;
  assert.ok(pack, 'the platform stylesheet is among the files the registry wrote');
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const method of ['GET', 'HEAD']) {
      const asset = await proxy(request('/_next/static/chunks/app.js', method));
      assert.equal(asset.headers.get('x-middleware-next'), '1', `${profile} ${method}`);
      assert.equal(decision(asset), 'unlisted', `${profile} ${method}`);
      for (const file of [...written, pack.replace('/pack/', '/pack/./')]) {
        const response = await proxy(request(file, method));
        const what = `${profile} ${method} ${file}`;
        assert.equal(response.headers.get('x-middleware-next'), '1', what);
        assert.equal(decision(response), 'missing', what);
      }
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
      // A file the registry never wrote there, and every other spelling of
      // one it did: encoded, in another case, or through an encoded slash.
      ['/_portfolio/pack/0123456789ab.css', 'GET'],
      ['/_portfolio/pack/0123456789ab.css', 'HEAD'],
      [pack.replace('/_portfolio/', '/_PORTFOLIO/'), 'GET'],
      [pack.replace('/_portfolio/', '/%5Fportfolio/'), 'GET'],
      [pack.replace('/pack/', '/PACK/'), 'GET'],
      [pack.replace('/pack/_', '/pack/%5F'), 'GET'],
      [pack.replace(/css$/, 'CSS'), 'GET'],
      [pack.replace('/pack/', '/pack/..%2Fpack/'), 'GET'],
      [pack.replace('/pack/', '/pack%2F'), 'HEAD'],
      // A trailing slash gets the 404 too, never a 308 naming the file.
      [`${pack}/`, 'GET'],
      ['/_portfolio/', 'GET'],
      ['/_next/static/chunks/app.js/', 'GET'],
      [pack, 'POST'],
      [pack, 'OPTIONS'],
    ] as const) {
      const response = await proxy(request(path, method));
      const what = `${profile} ${method} ${path}`;
      assert.equal(response.status, 404, what);
      assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8', what);
      assert.equal(await response.text(), 'Not found.', what);
    }
    // A path that only starts the same is any other path.
    assert.equal(decision(await proxy(request('/_portfolios/x'))), 'missing', profile);
    assert.equal(decision(await proxy(request('/_next/statics/x'))), 'unlisted', profile);
  }
});

/** A visitor page's request, with the client's own marks and Next's router headers, say. */
function visitor(path: string, method = 'GET', headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://rowan.test${path}`, {
    method,
    headers: { ...CLIENT_MARKS, ...headers },
  });
}

test("a visitor page's GET or HEAD goes on marked with the experience segment of the live composition, from memory alone (#6, Slice 2)", async (t) => {
  t.after(() => setLiveComposition(undefined));
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    // deploy()'s catalog fails the test if anything reads it.
    deploy(t, profile);
    for (const live of [undefined, 'fallback', 'acme-gone']) {
      setLiveComposition(live);
      for (const method of ['GET', 'HEAD']) {
        const what = `${profile} ${method} with ${live}`;
        const home = await proxy(visitor('/?utm=x', method));
        // Only the fallback composition is registered here: any other id is its.
        assert.equal(segment(home), 'fallback', what);
        assert.equal(decision(home), 'served', what);
        assert.match(home.headers.get('x-request-id') ?? '', UUID, what);
        assert.equal(
          home.headers.get('x-middleware-request-x-request-id'),
          home.headers.get('x-request-id'),
          what,
        );
        assert.equal(home.headers.get('x-robots-tag'), profile === 'demo' ? 'noindex' : null);
      }
    }
  }
  // Next's own requests for a page, its RSC payload and a prefetch of it, are
  // marked the same. next.config.ts sends a prefetch with no RSC header to
  // the 404 page before it reads the mark (headers.test.ts).
  deploy(t, 'read-only');
  const router: Record<string, string>[] = [
    { rsc: '1' },
    { rsc: '1', 'next-router-prefetch': '1' },
    { 'next-router-prefetch': '1' },
  ];
  for (const headers of router) {
    assert.equal(segment(await proxy(visitor('/', 'GET', headers))), 'fallback');
  }
  // Under demo, /sample and everything below it.
  deploy(t, 'demo');
  assert.equal(segment(await proxy(visitor('/sample'))), 'fallback');
  // A ?variant= that names nothing registered is a path no route matches, as before.
  assert.equal(segment(await proxy(visitor('/sample?variant=acme-gone'))), null);
  assert.equal(decision(await proxy(visitor('/sample?variant=acme-gone'))), 'missing');
});

test("only proxy.ts names an experience segment: a client's own mark goes no further, on any path, to any method, in every profile (#6, Slice 2)", async (t) => {
  const paths = [
    '/',
    '/no-such-page',
    '/feed.xml',
    '/studio',
    '/api/health',
    '/api/studio/config.status',
    '/_next/static/a.js',
    '/_experience/fallback',
    '/preview/x',
  ];
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const path of paths) {
      for (const method of ['GET', 'HEAD', 'POST']) {
        const what = `${profile} ${method} ${path}`;
        // visitor() sends CLIENT_MARKS, a well-formed id of the client's choosing among them.
        const response = await proxy(visitor(path, method));
        const page = path === '/' && method !== 'POST';
        assert.equal(segment(response), page ? 'fallback' : null, what);
        if (!onward(response)) continue;
        // Next drops each request header the override list leaves out.
        const kept = (response.headers.get('x-middleware-override-headers') ?? '').split(',');
        assert.equal(kept.includes(EXPERIENCE_HEADER), page, what);
      }
    }
  }
});

test('any other method to a visitor page is a plain 405 with the methods it takes, under the headers the path gets, in every profile (#6, Slice 2)', async (t) => {
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    const pages = profile === 'demo' ? ['/', '/sample'] : ['/'];
    for (const path of pages) {
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
        const what = `${profile} ${method} ${path}`;
        const response = await proxy(visitor(path, method));
        assert.equal(response.status, 405, what);
        assert.equal(response.headers.get('allow'), 'GET, HEAD', what);
        assert.equal(response.headers.get('cache-control'), 'no-store', what);
        assert.match(response.headers.get('content-type') ?? '', /^text\/plain/, what);
        assert.match(response.headers.get('x-request-id') ?? '', UUID, what);
        assert.equal(response.headers.get('x-robots-tag'), profile === 'demo' ? 'noindex' : null);
        assert.equal(segment(response), null, what);
        assert.equal(decision(response), null, what);
        assert.equal(await response.text(), 'Method not allowed.', what);
      }
    }
  }
  // While the catalog can't serve, the 503 comes first, as for every method before.
  deploy(t, 'read-only');
  setServable(false);
  t.after(() => setServable(true));
  assert.equal((await proxy(visitor('/', 'POST'))).status, 503);
});

test("a request for an experience segment's own path, in any spelling and to any method, is a path no route matches (#6, Slice 2)", async (t) => {
  for (const profile of ['owner', 'demo', 'read-only'] as const) {
    deploy(t, profile);
    for (const path of [
      '/_experience',
      '/_experience/fallback',
      '/_experience/fallback/work/tide-tables',
      '/_experience/fallback?_rsc=probe',
      '/%5Fexperience/fallback',
      '/_EXPERIENCE/fallback',
      '/_experience%2Ffallback',
      '/_experience/fallback.rsc',
      '/_experience/acme-gone/sample',
    ]) {
      for (const method of ['GET', 'HEAD']) {
        const response = await proxy(visitor(path, method));
        assert.equal(segment(response), null, `${profile} ${method} ${path}`);
        assert.equal(decision(response), 'missing', `${profile} ${method} ${path}`);
      }
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
        const response = await proxy(visitor(path, method));
        assert.equal(response.status, 404, `${profile} ${method} ${path}`);
        assert.equal(await response.text(), 'Not found.');
      }
    }
    // The segment's route file spelled out goes ahead of Next's file check, as any route file's does.
    for (const path of [
      '/_experience/fallback/[[...route]]',
      '/_experience/fallback/%5B%5B...route%5D%5D',
    ]) {
      const response = await proxy(visitor(path));
      assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), '1', path);
      assert.equal(segment(response), null, path);
    }
  }
});

/** A request for `path` that came to `host`, as its Host header names it. */
function toHost(
  host: string,
  path: string,
  method = 'GET',
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`https://rowan.test${path}`, { method, headers: { ...headers, host } });
}

const PREVIEW_HOST = 'preview.rowan.test';

/** What the preview origin turns away: every path but a frame's and what it loads. */
const OFF_PREVIEW = [
  '/',
  '/studio',
  '/studio/sign-in',
  '/studio/preview',
  '/%73tudio',
  '/api/studio/auth.session',
  '/api/health',
  '/api/ready',
  '/sample',
  '/robots.txt',
  '/sitemap.xml',
  '/feed.xml',
  '/favicon.ico',
  '/_next/image?url=%2Fx.png&w=64&q=75',
  '/work/tide-tables',
  '/no-such-page',
  '/previews',
  '/preview-assetsx/x',
  '/_nextx/static/x',
  '/_portfolios/x',
];

test('on the preview origin only a frame and what it loads go on, and every other path gets what a path no route matches gets, by the Host header alone (#7, Slice 4)', async (t) => {
  const { port } = grantsPort();
  deploy(t, 'owner', port, { PORTFOLIO_PREVIEW_ORIGIN: `https://${PREVIEW_HOST}` });
  for (const host of [PREVIEW_HOST, 'PREVIEW.Rowan.TEST', `${PREVIEW_HOST}:443`]) {
    for (const method of ['GET', 'HEAD']) {
      for (const path of OFF_PREVIEW) {
        const response = await proxy(toHost(host, path, method));
        const what = `${host} ${method} ${path}`;
        assert.equal(response.headers.get('x-middleware-next'), '1', what);
        assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), '1', what);
        assert.equal(response.headers.get('cache-control'), UNKNOWN_PATH_CACHE_CONTROL, what);
        noStudioHeaders(response, what);
      }
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      for (const path of OFF_PREVIEW) {
        const response = await proxy(toHost(host, path, method));
        const what = `${host} ${method} ${path}`;
        assert.equal(response.status, 404, what);
        assert.equal(await response.text(), 'Not found.', what);
        noStudioHeaders(response, what);
      }
    }
  }
  // A frame's document, its assets, and the build's files go on there as
  // they do on the deployment's own origin, in any spelling.
  const asFrame = { 'sec-fetch-dest': 'iframe' };
  const frame = await proxy(toHost(PREVIEW_HOST, `/preview/${ACTIVE}`, 'GET', asFrame));
  assert.equal(frame.headers.get('x-middleware-next'), '1');
  assert.equal(frame.headers.get('x-middleware-request-x-portfolio-not-found'), null);
  assert.match(
    frame.headers.get('content-security-policy') ?? '',
    /frame-ancestors https:\/\/rowan\.test$/,
  );
  for (const path of [
    `/preview/${ACTIVE}`,
    `/PREVIEW/${ACTIVE}`,
    `/%70review/${ACTIVE}`,
    `/preview/${ENDED}`,
    '/preview',
    '/preview-assets/AAAAAAAAAAAAAAAAAAAAAA/media/x.png',
    '/_next/static/chunks/app.js',
    '/_NEXT/static/chunks/app.js',
    '/_portfolio/pack/0123456789ab.css',
  ]) {
    for (const method of ['GET', 'POST']) {
      const there = await proxy(toHost(PREVIEW_HOST, path, method, asFrame));
      const here = await proxy(toHost('rowan.test', path, method, asFrame));
      const what = `${method} ${path}`;
      assert.equal(there.status, here.status, what);
      assert.equal(decision(there), decision(here), what);
      assert.equal(
        there.headers.get('x-middleware-request-x-portfolio-not-found'),
        here.headers.get('x-middleware-request-x-portfolio-not-found'),
        what,
      );
    }
  }
  // The deployment's own host, in any case or with its default port, gets
  // the site: Studio keeps its headers, and frames its own origin and the
  // preview origin alone.
  for (const host of ['rowan.test', 'ROWAN.test', 'rowan.test:443']) {
    const own = await proxy(toHost(host, '/studio/sign-in'));
    assert.equal(own.headers.get('x-middleware-next'), '1', host);
    assert.equal(own.headers.get('x-middleware-request-x-portfolio-not-found'), null, host);
    assert.match(
      own.headers.get('content-security-policy') ?? '',
      /; frame-src 'self' https:\/\/preview\.rowan\.test; frame-ancestors 'none';/,
      host,
    );
  }
  // Any other host, such as one a proxy in front rewrote, or the preview
  // host on another port, fails closed: the health checks, and the plain
  // 404 for everything else, the site, Studio, and the preview included.
  for (const host of [
    `${PREVIEW_HOST}:8443`,
    'elsewhere.test',
    '127.0.0.1:3000',
    'rowan.test:8443',
  ]) {
    for (const path of ['/api/health', '/api/ready']) {
      const health = await proxy(toHost(host, path));
      assert.equal(health.headers.get('x-middleware-next'), '1', `${host} ${path}`);
    }
    for (const [path, method] of [
      ['/', 'GET'],
      ['/studio/sign-in', 'GET'],
      ['/api/studio/auth.session', 'GET'],
      ['/api/studio/auth.login', 'POST'],
      [`/preview/${ACTIVE}`, 'GET'],
      ['/_next/static/chunks/app.js', 'GET'],
      ['/no-such-page', 'GET'],
    ] as const) {
      const response = await proxy(toHost(host, path, method, { 'sec-fetch-dest': 'iframe' }));
      const what = `${host} ${method} ${path}`;
      assert.equal(response.status, 404, what);
      assert.equal(await response.text(), 'Not found.', what);
      assert.equal(response.headers.get('x-middleware-next'), null, what);
    }
  }
  // No Host header at all is another host too.
  const bare = new NextRequest('https://rowan.test/studio/sign-in');
  bare.headers.delete('host');
  assert.equal((await proxy(bare)).status, 404);
});

test('without a preview origin a Host header changes nothing, and Studio frames its own origin alone (#7, Slice 4)', async (t) => {
  deploy(t, 'owner');
  for (const host of [PREVIEW_HOST, 'rowan.test']) {
    const response = await proxy(toHost(host, '/studio/sign-in'));
    assert.match(response.headers.get('content-security-policy') ?? '', STUDIO_CSP, host);
    assert.equal(response.headers.get('x-middleware-request-x-portfolio-not-found'), null, host);
  }
});

test("a Content-Security-Policy or Content-Security-Policy-Report-Only header the client sends never reaches Next: the proxy's own goes on in its place, or none, in every profile (#7)", async (t) => {
  for (const profile of PROFILES) {
    deploy(t, profile);
    for (const path of ['/', '/no-such-page', '/studio/sign-in']) {
      const response = await proxy(
        new NextRequest(`https://rowan.test${path}`, {
          headers: {
            'content-security-policy': "script-src 'nonce-clientchosen'",
            'content-security-policy-report-only': "default-src 'none'",
          },
        }),
      );
      const what = `${profile} ${path}`;
      assert.equal(response.headers.get('x-middleware-next'), '1', what);
      const passed = (response.headers.get('x-middleware-override-headers') ?? '').split(',');
      assert.ok(passed.includes('x-request-id'), what);
      assert.ok(!passed.includes('content-security-policy-report-only'), what);
      const policy = response.headers.get('x-middleware-request-content-security-policy');
      if (profile === 'owner' && path === '/studio/sign-in') {
        // Studio's own policy, with its own nonce, the one its response sends.
        assert.equal(policy, response.headers.get('content-security-policy'), what);
        assert.doesNotMatch(policy ?? '', /clientchosen/, what);
      } else {
        assert.ok(!passed.includes('content-security-policy'), what);
        assert.equal(policy, null, what);
      }
    }
  }
});

test('a production build keeps its strict preview and Studio policies under a server started with NODE_ENV=development: they relax only for the mode the code was compiled in (#7)', async (t) => {
  // These tests run compiled as production, as a build is.
  assert.equal(COMPILED_MODE, 'production');
  const runtime = readDeploymentConfig(
    {
      NODE_ENV: 'development',
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: 'https://rowan.test',
      PORTFOLIO_SOURCE_DIR: '/srv/config',
    },
    { cwd: '/' },
  );
  assert.ok(runtime.ok && runtime.config.mode === 'development');
  const { port } = grantsPort();
  deploy(t, 'owner', port, { NODE_ENV: 'development' });
  const studio = await proxy(request('/studio/sign-in'));
  const preview = await proxy(
    new NextRequest(`https://rowan.test/preview/${ACTIVE}`, {
      headers: { 'sec-fetch-dest': 'iframe' },
    }),
  );
  for (const [what, response] of [
    ['Studio', studio],
    ['the preview', preview],
  ] as const) {
    const policy = response.headers.get('content-security-policy') ?? '';
    assert.match(policy, /script-src [^;]*'nonce-/, what);
    assert.doesNotMatch(policy, /'unsafe-eval'/, what);
  }
  const previewPolicy = preview.headers.get('content-security-policy') ?? '';
  assert.match(previewPolicy, /style-src 'self' 'nonce-/);
  assert.match(previewPolicy, /connect-src 'none'/);
  // The policies themselves relax for next dev, the mode the proxy passes there.
  assert.match(
    previewCsp('n', { mode: 'development' }),
    /'unsafe-eval'.*'unsafe-inline'.*connect-src 'self'/,
  );
  assert.match(studioCsp('n', 'development'), /'unsafe-eval'/);
});
