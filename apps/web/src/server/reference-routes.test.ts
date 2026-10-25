import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { FIXTURE_DIR, fixtureChecks } from '../../scripts/reference-fixture';
import { proxy } from '../proxy';
import { CAPABILITY_MATRIX, type Profile } from './capabilities';
import { readDeploymentConfig } from './config';
import { setDeploymentState, type ServedReference } from './config-store';
import { openReference } from './demo/reference';
import { REFERENCE_PATTERN, segmentFor } from './experience';
import { CONTENT_HEADER } from './route-header';
import { resolveRoute } from './routes';

// The demo's read-only reference in the route table and proxy.ts (#9):
// reference.read is demo's alone, so every other profile answers both
// routes as ones it doesn't serve; under demo a page exists only once a
// reference verified, by its own view's slugs, and never at
// /reference/media, which the renditions' route outranks; the reference
// renders in its own composition; and proxy.ts marks its pages for the
// layout, dropping any copy of that mark a client sends, on every route.

// No top-level await: tsx runs this file as CommonJS.
let opened: Promise<ServedReference> | undefined;
/** The committed fixture, opened once. */
function fixture(): Promise<ServedReference> {
  opened ??= openReference({ dir: FIXTURE_DIR, checks: fixtureChecks() }).then((result) => {
    assert.ok(result.ok, JSON.stringify(result.issues));
    return result.reference;
  });
  return opened;
}

function deploy(t: TestContext, profile: Profile, served?: ServedReference): void {
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
    catalog: { getLive: () => assert.fail('the route table reads no catalog') },
    dispatch: () => assert.fail('the route table runs no operation'),
    degraded: [],
    ...(served ? { reference: served } : {}),
  });
  t.after(() => setDeploymentState(undefined));
}

const PATHS = [
  '/reference',
  '/reference/work/tide-tables',
  '/reference/media',
  '/reference/media/tide-tables-cover/abc/w8-a1.png',
];

test('reference.read is demo’s alone, so owner and read-only answer every reference path as a route they do not serve', async (t) => {
  assert.deepEqual(CAPABILITY_MATRIX['reference.read'], { demo: 'public' });
  for (const profile of ['owner', 'read-only'] as const) {
    deploy(t, profile);
    // The reference's home and its renditions route, which name something
    // under demo, are absent here, as /sample is: the plain 404 to every method.
    for (const path of ['/reference', '/reference/media/tide-tables-cover/abc/w8-a1.png']) {
      assert.equal(resolveRoute(profile, path).status, 'absent', `${profile} ${path}`);
      for (const method of ['GET', 'HEAD', 'POST']) {
        const response = await proxy(new NextRequest(`https://rowan.test${path}`, { method }));
        assert.equal(response.status, 404, `${profile} ${method} ${path}`);
        assert.notEqual(response.headers.get('x-middleware-next'), '1', 'it goes no further');
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
    }
    // A path that names nothing below it, the route file's own included, is
    // missing, as /sample/[[...path]] is: the 404 page to GET, the plain 404 to POST.
    for (const path of ['/reference/[[...path]]', '/reference/no-such-view']) {
      assert.equal(resolveRoute(profile, path).status, 'missing', `${profile} ${path}`);
      assert.equal(
        resolveRoute(profile, path).status,
        resolveRoute(profile, path.replace('/reference', '/sample')).status,
        `${profile} ${path} answers as /sample's counterpart does`,
      );
      const page = await proxy(new NextRequest(`https://rowan.test${path}`));
      assert.equal(
        page.headers.get('x-middleware-next'),
        '1',
        `${profile} GET ${path}: the 404 page`,
      );
      const posted = await proxy(new NextRequest(`https://rowan.test${path}`, { method: 'POST' }));
      assert.equal(posted.status, 404, `${profile} POST ${path}`);
      assert.match(posted.headers.get('content-type') ?? '', /^text\/plain/);
    }
  }
});

test('under demo with no reference, no page exists under /reference, and the renditions route answers its own 404', (t) => {
  deploy(t, 'demo');
  for (const path of ['/reference', '/reference/work/tide-tables', '/reference/media']) {
    assert.equal(resolveRoute('demo', path).status, 'missing', path);
  }
  const media = resolveRoute('demo', '/reference/media/a/b/c.png');
  assert.equal(media.status, 'served');
  assert.equal(media.status === 'served' && media.entry.pattern, '/reference/media/[...path]');
});

test('under demo with a reference, its pages are the ones its view routes, and /reference/media is never a page', async (t) => {
  deploy(t, 'demo', await fixture());
  for (const path of ['/reference', '/reference/work/tide-tables']) {
    const decision = resolveRoute('demo', path);
    assert.equal(decision.status === 'served' && decision.entry.pattern, REFERENCE_PATTERN, path);
  }
  for (const path of [
    '/reference/work/canary-ref-private',
    '/reference/work/no-such-slug',
    '/reference/media',
    '/reference/sample',
    '/reference/studio',
  ]) {
    assert.equal(resolveRoute('demo', path).status, 'missing', path);
  }
  // The renditions' fixed segment outranks the page's catch-all.
  for (const path of PATHS.slice(3)) {
    const decision = resolveRoute('demo', path);
    assert.equal(
      decision.status === 'served' && decision.entry.pattern,
      '/reference/media/[...path]',
    );
  }
});

test('the reference renders in its own site’s composition, or the one its query names, never the sample’s', async (t) => {
  deploy(t, 'demo', await fixture());
  const at = (segments: string[], query = '') =>
    segmentFor({
      profile: 'demo',
      pattern: REFERENCE_PATTERN,
      segments,
      query: new URLSearchParams(query),
    });
  assert.equal(at(['reference']), 'spatial-bento');
  assert.equal(at(['reference'], 'variant=kinetic-cosmos'), 'kinetic-cosmos');
  assert.equal(at(['reference'], 'variant=no-such-variant'), 'spatial-bento');
  deploy(t, 'demo');
  assert.equal(at(['reference']), 'fallback', 'with no reference, nothing of one');
});

test('proxy.ts marks a reference page for the layout, and drops a client’s copy of the mark on every route', async (t) => {
  deploy(t, 'demo', await fixture());
  const send = (path: string, value: string) =>
    proxy(new NextRequest(`https://rowan.test${path}`, { headers: { [CONTENT_HEADER]: value } }));
  const mark = (response: Response) =>
    response.headers.get(`x-middleware-request-${CONTENT_HEADER}`);

  const page = await send('/reference', 'other');
  assert.equal(page.headers.get('x-middleware-next'), '1');
  assert.equal(mark(page), 'reference', 'its own mark, not the client’s');
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/);

  for (const path of [
    '/',
    '/sample',
    '/sample/work/postmortem-template-kit',
    '/reference/media/a/b/c.png',
    '/reference/work/canary-ref-private',
    '/no-such-page',
    '/api/health',
    '/robots.txt',
  ]) {
    const response = await send(path, 'reference');
    assert.equal(mark(response), null, path);
  }
  // Under a profile with no reference, a client's mark goes nowhere either.
  for (const profile of ['owner', 'read-only'] as const) {
    deploy(t, profile);
    for (const path of ['/', '/work/x', '/studio']) {
      assert.equal(mark(await send(path, 'reference')), null, `${profile} ${path}`);
    }
  }
});
