import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import type { Profile } from './server/capabilities';
import { readDeploymentConfig } from './server/config';
import { setDeploymentState } from './server/config-store';
import { readiness } from './server/readiness';

// proxy.ts: 404 early for what the profile doesn't serve, a fresh request ID
// on everything else, noindex on every demo response, and 503 before
// register() has stored the deployment, with readiness's own body for
// /api/ready.

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

function request(path: string): NextRequest {
  return new NextRequest(`https://rowan.test${path}`, {
    headers: { 'x-request-id': 'client-chosen' },
  });
}

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
    variantLoads: () => assert.fail('nothing loads before startup'),
    loadedOwnerModules: () => [],
  });
  assert.deepEqual(await response.json(), starting.body);
});

test('a served path passes through with a fresh request ID, whatever the client sent', (t) => {
  deploy(t, 'read-only');
  for (const path of [
    '/',
    '/feed.xml',
    '/api/studio/config.status',
    '/variants/kinetic-cosmos/a.png',
  ]) {
    const response = proxy(request(path));
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
    const id = response.headers.get('x-request-id') ?? '';
    assert.match(id, UUID, path);
    // The id the route handler sees on the request is the same fresh one.
    assert.equal(response.headers.get('x-middleware-request-x-request-id'), id, path);
    assert.match(response.headers.get('x-middleware-override-headers') ?? '', /x-request-id/);
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
    assert.equal(
      proxy(request('/variants/kinetic-cosmos/a.png')).headers.get('x-middleware-next'),
      '1',
    );
  }
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

test('build assets and optimized images go through the proxy too', async () => {
  // No matcher, so no demo response goes out without its X-Robots-Tag.
  const exported = (await import('./proxy')) as Record<string, unknown>;
  assert.equal(exported.config, undefined);
});
