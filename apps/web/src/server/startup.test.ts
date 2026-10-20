import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The schema package's test extension, shared with its own tests.
import { acmePortfolioPhotography } from '../../../../packages/schema/src/__fixtures__/acme-portfolio-photography';
import { getLive } from './catalog';
import type { Env } from './config';
import { getDeploymentConfig, requireDeploymentConfig, setDeploymentState } from './config-store';
import { runStartup, type StartupResult } from './startup';

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};
const VALID =
  'schemaVersion: 2\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n';

/** A source directory holding `document` as portfolio.yml, beside the example site.yml. */
function sourceDir(t: { after: (fn: () => void) => void }, document?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'startup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (document !== undefined) {
    writeFileSync(path.join(dir, 'portfolio.yml'), document);
    copyFileSync(EXAMPLES.site, path.join(dir, 'site.yml'));
  }
  return dir;
}

function start(env: Env) {
  return runStartup({
    env,
    cwd: '/srv/app',
    examples: EXAMPLES,
    report: () => {},
    readFile: () => {
      throw new Error('no files in this test');
    },
  });
}

function fatalCodes(result: StartupResult): string[] {
  return result.issues
    .filter((issue) => issue.severity === 'fatal')
    .map((issue) => `${issue.key}:${issue.code}`);
}

const PRODUCTION = { NODE_ENV: 'production', PORTFOLIO_ORIGIN: 'https://jane.test' } as const;

test('read-only starts from a valid source directory', async (t) => {
  const dir = sourceDir(t, VALID);
  const result = await start({
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

test('owner refuses to start: no authentication provider is registered', async (t) => {
  const dir = sourceDir(t, VALID);
  const result = await start({
    ...PRODUCTION,
    PORTFOLIO_PROFILE: 'owner',
    PORTFOLIO_SOURCE_DIR: dir,
  });
  assert.equal(result.ok, false);
  assert.equal(result.profile, 'owner');
  assert.deepEqual(fatalCodes(result), ['PORTFOLIO_PROFILE:auth_provider_missing']);
  assert.match(result.issues[0]!.message, /read-only/);
});

test('owner reports configuration problems before the missing provider', async () => {
  const result = await start({
    ...PRODUCTION,
    PORTFOLIO_PROFILE: 'owner',
    PORTFOLIO_ORIGIN: 'http://jane.test',
  });
  assert.deepEqual(fatalCodes(result), [
    'PORTFOLIO_ORIGIN:insecure',
    'PORTFOLIO_SOURCE_DIR:required',
  ]);
});

test('demo starts on the bundled sample, and never reads a source directory', async (t) => {
  const result = await start({ ...PRODUCTION, PORTFOLIO_PROFILE: 'demo' });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  if (!result.ok) return;
  assert.equal(result.profile, 'demo');
  const live = await result.state.catalog.getLive();
  assert.equal(live.unit.portfolio.identity.name, 'Anamika Devi');

  const withSource = await start({
    ...PRODUCTION,
    PORTFOLIO_PROFILE: 'demo',
    PORTFOLIO_SOURCE_DIR: sourceDir(t, VALID),
  });
  assert.deepEqual(fatalCodes(withSource), ['PORTFOLIO_SOURCE_DIR:not_in_profile']);
});

test('read-only with an old-format document reports the document as legacy', async (t) => {
  const dir = sourceDir(t, 'identity:\n  name: Rowan Test\nvariant: kinetic-cosmos\n');
  const result = await start({
    ...PRODUCTION,
    PORTFOLIO_PROFILE: 'read-only',
    PORTFOLIO_SOURCE_DIR: dir,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(fatalCodes(result), ['PORTFOLIO_SOURCE_DIR:legacy.document']);
  assert.deepEqual([result.issues[0]?.path, result.issues[0]?.line], ['', 3]);
  assert.match(result.issues[0]!.message, /Run pnpm config:migrate portfolio\.yml/);
  assert.match(result.issues[0]!.remediation ?? '', /--write --out <dir>/);
});

test('warnings from the configuration reach the startup result', async (t) => {
  const dir = sourceDir(t, VALID);
  const result = await start({
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

test('the content extensions reach the document check', async (t) => {
  const dir = sourceDir(
    t,
    VALID.replace(
      '  name: Rowan Test\n',
      "  name: Rowan Test\n  extensions:\n    '@acme/portfolio-photography': { camra: Leica }\n",
    ),
  );
  const env = { ...PRODUCTION, PORTFOLIO_PROFILE: 'read-only', PORTFOLIO_SOURCE_DIR: dir };
  // Unregistered, the entry is kept and warns.
  const unregistered = await start(env);
  assert.equal(unregistered.ok, true);
  assert.deepEqual(
    unregistered.issues.map((issue) => `${issue.severity}:${issue.code}`),
    ['warning:extension.unregistered'],
  );
  // Registered, its fields are checked.
  const registered = await runStartup({
    env,
    cwd: '/srv/app',
    examples: EXAMPLES,
    extensions: [acmePortfolioPhotography],
    report: () => {},
  });
  assert.deepEqual(fatalCodes(registered), ['PORTFOLIO_SOURCE_DIR:schema.invalid']);
  assert.match(registered.issues[0]?.message ?? '', /Did you mean camera\?/);
});

test('the store hands the frozen state to getLive() and the config readers', async (t) => {
  t.after(() => setDeploymentState(undefined));
  setDeploymentState(undefined);
  assert.equal(getDeploymentConfig(), undefined);
  assert.throws(() => requireDeploymentConfig(), /not loaded/);
  await assert.rejects(getLive(), /not loaded/);

  const dir = sourceDir(t, VALID);
  const result = await start({
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
