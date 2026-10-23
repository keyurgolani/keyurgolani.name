import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatePublicationUnit } from '@portfolio/schema';
import type { Profile } from './capabilities';
import type { LiveRevision } from './catalog-port';
import { readDeploymentConfig, type DeploymentConfig } from './config';
import type { DeploymentState } from './config-store';
import { ownerStore, PROBE_INTERVAL_MS } from './owner/store';
import { capabilityPolicy } from './policy';
import { readiness, type ReadinessProbes } from './readiness';

// Readiness (#1, item 19): its checks, and what the endpoint answers.

function state(
  profile: Profile,
  {
    live = true,
    degraded = [] as string[],
    variant = 'acme-ocean',
    serving = 'live' as LiveRevision['state'],
  }: {
    live?: boolean;
    degraded?: string[];
    variant?: string;
    serving?: LiveRevision['state'];
  } = {},
): DeploymentState {
  return {
    config: { profile } as DeploymentConfig,
    catalog: {
      getLive: async () => {
        if (!live) throw new Error('canary: /srv/canary/portfolio.yml');
        if (serving === 'incompatible' || serving === 'empty') {
          return { state: serving, revisionId: null, unitHash: null, unit: null };
        }
        return {
          state: serving,
          revisionId: `rev_${'c'.repeat(32)}`,
          unitHash: `sha256:${'c'.repeat(64)}`,
          unit: { site: { appearance: { variant } } },
        } as LiveRevision;
      },
    },
    dispatch: () => assert.fail('readiness runs no operation'),
    degraded,
  };
}

/** A build that registers acme-ocean: any other selection falls back. */
const PROBES: ReadinessProbes = {
  variantHealth: async (variant) =>
    variant === 'acme-ocean'
      ? { status: 'ok', requested: variant, rendered: variant }
      : { status: 'degraded', requested: variant, rendered: 'fallback' },
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
    // The module that renders doesn't load.
    [
      'packs',
      state('read-only'),
      { ...PROBES, variantHealth: () => Promise.reject(new Error('canary')) },
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

test("the fallback standing in for the site's variant is 200, degraded, with packs degraded", async () => {
  // The live site's variant, not some default: this build doesn't register it.
  const result = await readiness(state('read-only', { variant: 'canary-variant' }), PROBES);
  assert.equal(result.httpStatus, 200);
  assert.ok(result.body.status === 'degraded');
  assert.deepEqual(result.body.checks, [
    { id: 'catalog', status: 'ok' },
    { id: 'packs', status: 'degraded' },
    { id: 'owner-modules', status: 'ok' },
  ]);
  // It names neither variant.
  assert.ok(!JSON.stringify(result.body).includes('canary-variant'));
  assert.ok(!JSON.stringify(result.body).includes('fallback'));
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

test('the catalog check follows the serving state alone, and never names the revision', async () => {
  const cases: Array<[LiveRevision['state'], 'ok' | 'degraded' | 'fail', 200 | 503]> = [
    ['live', 'ok', 200],
    // The last known good serves in place of the live revision.
    ['degraded', 'degraded', 200],
    // Nothing servable: no variant to load either.
    ['incompatible', 'fail', 503],
    ['empty', 'fail', 503],
  ];
  for (const profile of ['read-only', 'owner'] as const) {
    for (const [serving, status, httpStatus] of cases) {
      const result = await readiness(state(profile, { serving }), PROBES);
      assert.equal(result.httpStatus, httpStatus, `${profile} ${serving}`);
      assert.ok(result.body.status !== 'starting');
      assert.deepEqual(result.body.checks.slice(0, 2), [
        { id: 'catalog', status },
        { id: 'packs', status: status === 'fail' ? 'fail' : 'ok' },
      ]);
      assert.equal(
        result.body.status,
        status === 'fail' ? 'unavailable' : status === 'degraded' ? 'degraded' : 'ready',
      );
      assert.ok(!JSON.stringify(result.body).includes('rev_'), serving);
      assert.ok(!JSON.stringify(result.body).includes('sha256'), serving);
    }
  }
});

test("owner's readiness lists data-directory, and runs its probe at most every 30 s", async (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'readiness-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: 'https://rowan.test',
      PORTFOLIO_SOURCE_DIR: '/srv/portfolio',
      PORTFOLIO_DATA_DIR: dataDir,
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  let clock = Date.parse('2026-10-22T09:00:00.000Z');
  const owner = ownerStore({
    config: read.config,
    checks: {
      validate: (pair) => validatePublicationUnit(pair, { canonicalOrigin: 'https://rowan.test' }),
      appVersion: 'test',
    },
    setServable: () => {},
    now: () => clock,
  });
  // Each run of the probe is a promise of its own.
  const runs = new Set<Promise<boolean>>();
  const deployment: DeploymentState = {
    ...state('owner'),
    dataDirectory: () => {
      const run = owner.probe();
      runs.add(run);
      return run;
    },
  };
  const first = await readiness(deployment, PROBES);
  assert.deepEqual(first.body.status === 'starting' ? [] : first.body.checks, [
    { id: 'catalog', status: 'ok' },
    { id: 'packs', status: 'ok' },
    { id: 'data-directory', status: 'ok' },
  ]);
  // Within 30 s, the probe that ran answers again.
  clock += PROBE_INTERVAL_MS - 1;
  await readiness(deployment, PROBES);
  await readiness(deployment, PROBES);
  assert.equal(runs.size, 1);
  // 30 s on, it runs again.
  clock += 1;
  await readiness(deployment, PROBES);
  assert.equal(runs.size, 2);
});
