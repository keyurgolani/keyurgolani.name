import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogReader } from '~/server/catalog-port';
import { readDeploymentConfig } from '~/server/config';
import { setDeploymentState } from '~/server/config-store';
import { GET } from './route';

// When the feed can't be built, the response body stays fixed. The cause
// goes to the server log, never to the visitor.

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
  setDeploymentState({ config: read.config, catalog: { getLive } });
  t.after(() => setDeploymentState(undefined));
}

async function assertFixedFailure(response: Response): Promise<void> {
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Feed unavailable.');
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

test('a catalog that fails gives a fixed 500 and logs the cause', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  deploy(t, () =>
    Promise.reject(
      new Error('canary: /srv/canary-config/portfolio.yml: /identity/name is required'),
    ),
  );
  await assertFixedFailure(await GET());
  assert.equal(logged.mock.callCount(), 1);
});

test('a server with no deployment state gives the same 500', async (t) => {
  t.mock.method(console, 'error', () => {});
  setDeploymentState(undefined);
  await assertFixedFailure(await GET());
});
