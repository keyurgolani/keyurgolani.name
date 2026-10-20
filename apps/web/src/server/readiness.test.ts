import test from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from './capabilities';
import type { LiveRevision } from './catalog-port';
import type { DeploymentConfig } from './config';
import type { DeploymentState } from './config-store';
import { capabilityPolicy } from './policy';
import { readiness, type ReadinessProbes } from './readiness';

// Readiness (#1, item 19): its checks, and what the endpoint answers.

function state(
  profile: Profile,
  {
    live = true,
    degraded = [] as string[],
    variant = 'editorial',
  }: { live?: boolean; degraded?: string[]; variant?: string } = {},
): DeploymentState {
  return {
    config: { profile } as DeploymentConfig,
    catalog: {
      getLive: async () => {
        if (!live) throw new Error('canary: /srv/canary/portfolio.yml');
        return { unit: { site: { appearance: { variant } } } } as LiveRevision;
      },
    },
    dispatch: () => assert.fail('readiness runs no operation'),
    degraded,
  };
}

const PROBES: ReadinessProbes = {
  variantLoads: async (variant) => variant === 'editorial',
  loadedOwnerModules: () => [],
};

test('before startup finishes it is 503, starting', async () => {
  assert.deepEqual(await readiness(undefined, PROBES), {
    httpStatus: 503,
    body: { status: 'starting' },
  });
});

test('read-only and demo are ready when the catalog, the variant, and the owner trace check out', async () => {
  for (const profile of ['read-only', 'demo'] as const) {
    assert.deepEqual(await readiness(state(profile), PROBES), {
      httpStatus: 200,
      body: {
        status: 'ready',
        profile,
        capabilities: capabilityPolicy(profile).summary().capabilities,
        checks: [
          { id: 'catalog', status: 'ok' },
          { id: 'packs', status: 'ok' },
          { id: 'owner-modules', status: 'ok' },
        ],
      },
    });
  }
});

test('owner has no owner-modules check: its trace holds owner code by design', async () => {
  const { body } = await readiness(state('owner'), {
    ...PROBES,
    loadedOwnerModules: () => ['server/owner/index'],
  });
  assert.ok(body.status === 'ready');
  assert.deepEqual(
    body.checks.map((check) => check.id),
    ['catalog', 'packs'],
  );
});

test('a failed check is 503, unavailable, and names only the check', async () => {
  const cases: Array<[string, DeploymentState, ReadinessProbes]> = [
    ['packs', state('read-only'), { ...PROBES, variantLoads: async () => false }],
    // The live site's variant, not some default.
    ['packs', state('read-only', { variant: 'kinetic-cosmos' }), PROBES],
    [
      'packs',
      state('read-only'),
      { ...PROBES, variantLoads: () => Promise.reject(new Error('canary')) },
    ],
    ['owner-modules', state('demo'), { ...PROBES, loadedOwnerModules: () => ['server/owner/x'] }],
  ];
  for (const [id, deployment, probes] of cases) {
    const result = await readiness(deployment, probes);
    assert.equal(result.httpStatus, 503, id);
    assert.ok(result.body.status === 'unavailable', id);
    assert.deepEqual(
      result.body.checks.filter((check) => check.status === 'fail').map((check) => check.id),
      [id],
    );
    assert.ok(!JSON.stringify(result.body).includes('canary'));
  }
});

test('a degraded startup requirement is 200, degraded', async () => {
  const result = await readiness(state('owner', { degraded: ['revision.integrity'] }), PROBES);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.status, 'degraded');
  assert.ok(!JSON.stringify(result.body).includes('revision.integrity'));
});

test('with no live revision, there is no variant to load, so packs fails with catalog', async () => {
  const result = await readiness(state('read-only', { live: false }), PROBES);
  assert.equal(result.httpStatus, 503);
  assert.ok(result.body.status === 'unavailable');
  assert.deepEqual(
    result.body.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ['catalog', 'packs'],
  );
  assert.ok(!JSON.stringify(result.body).includes('canary'));
});
