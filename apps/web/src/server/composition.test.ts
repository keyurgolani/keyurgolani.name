import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose, STARTUP_REQUIREMENTS } from './composition';
import { readDeploymentConfig, type Env } from './config';
import { loadedOwnerModules } from './load-trace';

// The composition root for profiles that never load owner code. Owner with a
// provider, which does, has its own file: the load trace is per process.

const EXAMPLE = fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url));

function deployment(t: TestContext, env: Env) {
  const dir = mkdtempSync(path.join(tmpdir(), 'composition-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    path.join(dir, 'portfolio.yml'),
    'schemaVersion: 2\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\n',
  );
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_ORIGIN: 'https://rowan.test',
      PORTFOLIO_SOURCE_DIR: dir,
      ...env,
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  return read.config;
}

function inputs(config: ReturnType<typeof deployment>) {
  return { config, examplePath: EXAMPLE, report: () => {} };
}

test('read-only builds its catalog adapter and loads no owner module', async (t) => {
  const composed = await compose(inputs(deployment(t, { PORTFOLIO_PROFILE: 'read-only' })));
  assert.equal(composed.ok, true);
  if (!composed.ok) return;
  assert.ok(Object.isFrozen(composed.state));
  assert.equal((await composed.state.catalog.getLive()).unit.portfolio.identity.name, 'Rowan Test');
  assert.deepEqual(loadedOwnerModules(), []);

  // Its transport serves no operation.
  const response = await composed.state.dispatch(
    new Request('https://rowan.test/api/studio/config.status'),
    'config.status',
  );
  assert.equal(response.status, 404);
});

test('owner refuses to start with no provider, before it loads owner code', async (t) => {
  const config = deployment(t, { PORTFOLIO_PROFILE: 'owner' });
  const composed = await compose(inputs(config));
  assert.equal(composed.ok, false);
  assert.deepEqual(
    composed.issues.map((issue) => `${issue.key}:${issue.code}`),
    ['PORTFOLIO_PROFILE:auth_provider_missing'],
  );
  assert.deepEqual(loadedOwnerModules(), []);
});

test('demo refuses to start until its sample catalog ships', async () => {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'demo',
      PORTFOLIO_ORIGIN: 'https://demo.rowan.test',
    },
    { cwd: '/' },
  );
  assert.ok(read.ok);
  const composed = await compose(inputs(read.config));
  assert.equal(composed.ok, false);
  assert.deepEqual(
    composed.issues.map((issue) => issue.code),
    ['profile_unavailable'],
  );
  assert.deepEqual(loadedOwnerModules(), []);
});

test('the tagged startup rows are named requirements for #2, #3, and #4', () => {
  assert.deepEqual(
    STARTUP_REQUIREMENTS.map((requirement) => [
      requirement.id,
      requirement.issue,
      requirement.profiles.join(' '),
      requirement.failure,
      requirement.check ? 'implemented' : 'pending',
    ]),
    [
      ['auth.provider', '#1', 'owner', 'fatal', 'implemented'],
      ['auth.secret', '#2', 'owner', 'fatal', 'pending'],
      ['data.directory', '#2, #3', 'owner', 'fatal', 'pending'],
      ['documents.shape', '#3', 'owner', 'fatal', 'pending'],
      ['revision.integrity', '#3', 'owner', 'degraded', 'pending'],
    ],
  );
});
