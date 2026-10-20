import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLive } from './catalog';
import type { Env } from './config';
import { getDeploymentConfig, requireDeploymentConfig, setDeploymentState } from './config-store';
import { runStartup } from './startup';

const EXAMPLE = fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url));

function sourceDir(t: { after: (fn: () => void) => void }, document?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'startup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (document !== undefined) writeFileSync(path.join(dir, 'portfolio.yml'), document);
  return dir;
}

function start(env: Env) {
  return runStartup({
    env,
    cwd: '/srv/app',
    examplePath: EXAMPLE,
    variantSlugs: ['editorial'],
    report: () => {},
    readFile: () => {
      throw new Error('no files in this test');
    },
  });
}

function fatalCodes(result: ReturnType<typeof start>): string[] {
  return result.issues
    .filter((issue) => issue.severity === 'fatal')
    .map((issue) => `${issue.key}:${issue.code}`);
}

const PRODUCTION = { NODE_ENV: 'production', PORTFOLIO_ORIGIN: 'https://jane.test' } as const;

test('read-only starts from a valid source directory', async (t) => {
  const dir = sourceDir(t, 'identity:\n  name: Rowan Test\n');
  const result = start({
    ...PRODUCTION,
    PORTFOLIO_PROFILE: 'read-only',
    PORTFOLIO_SOURCE_DIR: dir,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.profile, 'read-only');
  assert.ok(Object.isFrozen(result.state));
  assert.equal(result.state.config.origin, 'https://jane.test');
  const live = await result.state.catalog.getLive();
  assert.equal(live.unit.portfolio.identity.name, 'Rowan Test');
});

test('owner refuses to start: no authentication provider is registered', (t) => {
  const dir = sourceDir(t, 'identity:\n  name: Rowan Test\n');
  const result = start({ ...PRODUCTION, PORTFOLIO_PROFILE: 'owner', PORTFOLIO_SOURCE_DIR: dir });
  assert.equal(result.ok, false);
  assert.equal(result.profile, 'owner');
  assert.deepEqual(fatalCodes(result), ['PORTFOLIO_PROFILE:auth_provider_missing']);
  assert.match(result.issues[0]!.message, /read-only/);
});

test('owner reports configuration problems before the missing provider', () => {
  const result = start({
    ...PRODUCTION,
    PORTFOLIO_PROFILE: 'owner',
    PORTFOLIO_ORIGIN: 'http://jane.test',
  });
  assert.deepEqual(fatalCodes(result), [
    'PORTFOLIO_ORIGIN:insecure',
    'PORTFOLIO_SOURCE_DIR:required',
  ]);
});

test('demo refuses to start in this build', () => {
  const result = start({ ...PRODUCTION, PORTFOLIO_PROFILE: 'demo' });
  assert.equal(result.ok, false);
  assert.deepEqual(fatalCodes(result), ['PORTFOLIO_PROFILE:profile_unavailable']);
});

test('read-only with a bad document reports the document', (t) => {
  const dir = sourceDir(t, 'identity:\n  name: Rowan Test\nvariant: kinetic-cosmos\n');
  const result = start({
    ...PRODUCTION,
    PORTFOLIO_PROFILE: 'read-only',
    PORTFOLIO_SOURCE_DIR: dir,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(fatalCodes(result), ['PORTFOLIO_SOURCE_DIR:variant_unresolved']);
});

test('warnings from the configuration reach the startup result', (t) => {
  const dir = sourceDir(t, 'identity:\n  name: Rowan Test\n');
  const result = start({
    ...PRODUCTION,
    PORTFOLIO_PROFILE: 'read-only',
    PORTFOLIO_SOURCE_DIR: dir,
    PORTFOLIO_EXTRA: 'x',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.issues.map((issue) => `${issue.severity}:${issue.code}`),
    ['warning:unknown_key'],
  );
});

test('the store hands the frozen state to getLive() and the config readers', async (t) => {
  t.after(() => setDeploymentState(undefined));
  setDeploymentState(undefined);
  assert.equal(getDeploymentConfig(), undefined);
  assert.throws(() => requireDeploymentConfig(), /not loaded/);
  await assert.rejects(getLive(), /not loaded/);

  const dir = sourceDir(t, 'identity:\n  name: Rowan Test\n');
  const result = start({
    ...PRODUCTION,
    PORTFOLIO_PROFILE: 'read-only',
    PORTFOLIO_SOURCE_DIR: dir,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  setDeploymentState(result.state);
  assert.equal(requireDeploymentConfig(), result.state.config);
  assert.equal((await getLive()).unit.portfolio.identity.name, 'Rowan Test');
});
