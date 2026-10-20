import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogReader } from '~/server/catalog-port';
import { readDeploymentConfig } from '~/server/config';
import { setDeploymentState } from '~/server/config-store';
import { GET } from './route';

// When the feed can't be built, the response body stays fixed, plus the
// request ID proxy.ts set. The log names the failure and the request, and
// never the cause, which can carry a path.

function deploy(t: TestContext, getLive: CatalogReader['getLive']): void {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'read-only',
      PORTFOLIO_ORIGIN: 'https://rowan.test',
      PORTFOLIO_SOURCE_DIR: '/srv/canary-config',
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  setDeploymentState({
    config: read.config,
    catalog: { getLive },
    dispatch: () => assert.fail('the feed runs no operation'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
}

const request = () =>
  new Request('https://rowan.test/feed.xml', { headers: { 'x-request-id': 'req-0001' } });

test('a catalog that fails gives a fixed 500 and logs the request, not the cause', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  deploy(t, () =>
    Promise.reject(
      new Error('canary: /srv/canary-config/portfolio.yml: /identity/name is required'),
    ),
  );
  const response = await GET(request());
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Feed unavailable. Request ID: req-0001');
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(logged.mock.callCount(), 1);
  const line = String(logged.mock.calls[0]!.arguments[0]);
  assert.ok(!line.includes('canary'), line);
  assert.deepEqual(
    Object.entries(JSON.parse(line)).filter(([field]) => field !== 'ts'),
    [
      ['level', 'error'],
      ['event', 'feed.failed'],
      ['route', '/feed.xml'],
      ['requestId', 'req-0001'],
    ],
  );
});

test('a server with no deployment state serves no feed', async () => {
  setDeploymentState(undefined);
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
