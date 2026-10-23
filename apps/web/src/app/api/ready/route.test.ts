import test from 'node:test';
import assert from 'node:assert/strict';
import { setDeploymentState } from '~/server/config-store';
import { readiness } from '~/server/readiness';
import { GET } from './route';

// Before register() stores the deployment, the route's guard answers for it,
// with readiness's own `starting` body, as proxy.ts does (#1, item 19).

test('before startup, /api/ready is 503 with the starting body and no-store', async () => {
  setDeploymentState(undefined);
  const response = await GET(new Request('https://rowan.test/api/ready'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  const starting = await readiness(undefined, {
    variantHealth: () => assert.fail('nothing loads before startup'),
    appearanceHealth: () => assert.fail('nothing is told before startup'),
    loadedOwnerModules: () => [],
  });
  assert.deepEqual(await response.json(), starting.body);
});
