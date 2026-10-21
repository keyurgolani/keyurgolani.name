import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_SAMPLE_NAMES } from './catalog-documents';
import { compose, STARTUP_REQUIREMENTS, type StartupRequirement } from './composition';
import { readDeploymentConfig, type ConfigIssue, type Env } from './config';
import { setDeploymentState } from './config-store';
import { loadedOwnerModules } from './load-trace';
import { listOperations } from './operations';

// The composition root for profiles that never load owner code. Owner with a
// provider, which does, has its own file: the load trace is per process.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};
const PORTFOLIO =
  'schemaVersion: 2\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n';

/** A deployment whose source directory holds `documents`, a valid pair unless a test says. */
function deployment(
  t: TestContext,
  env: Env,
  documents: Record<string, string> = {
    'portfolio.yml': PORTFOLIO,
    'site.yml': readFileSync(EXAMPLES.site, 'utf8'),
  },
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'composition-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(documents)) writeFileSync(path.join(dir, name), text);
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
  return { config, examples: EXAMPLES, report: () => {} };
}

test('read-only builds its catalog adapter and loads no owner module', async (t) => {
  const composed = await compose(inputs(deployment(t, { PORTFOLIO_PROFILE: 'read-only' })));
  assert.equal(composed.ok, true);
  if (!composed.ok) return;
  assert.ok(Object.isFrozen(composed.state));
  assert.equal((await composed.state.catalog.getLive()).unit.portfolio.identity.name, 'Rowan Test');
  assert.deepEqual(loadedOwnerModules(), []);
  assert.deepEqual(composed.state.degraded, []);

  // Its transport serves no operation.
  setDeploymentState(composed.state);
  t.after(() => setDeploymentState(undefined));
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

test('demo builds the bundled sample and loads no owner module', async (t) => {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'demo',
      PORTFOLIO_ORIGIN: 'https://demo.rowan.test',
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  const composed = await compose(inputs(read.config));
  assert.ok(composed.ok, JSON.stringify(composed.issues));
  assert.ok(Object.isFrozen(composed.state));
  const live = await composed.state.catalog.getLive();
  assert.ok(BUNDLED_SAMPLE_NAMES.includes(live.unit.portfolio.identity.name));
  assert.match(live.revisionId, /^sample-/);
  assert.deepEqual(loadedOwnerModules(), []);

  // Its transport answers every registered operation with the 404 envelope.
  setDeploymentState(composed.state);
  t.after(() => setDeploymentState(undefined));
  for (const operation of listOperations()) {
    for (const method of ['GET', 'POST']) {
      const response = await composed.state.dispatch(
        new Request(`https://demo.rowan.test/api/studio/${operation.name}`, { method }),
        operation.name,
      );
      assert.equal(response.status, 404, `${method} ${operation.name}`);
      const { error } = (await response.json()) as { error: { code: string } };
      assert.equal(error.code, 'not_available_in_profile');
      assert.equal(response.headers.get('set-cookie'), null);
    }
  }
});

test('the tagged startup rows are named requirements for #2, #3, and #4', () => {
  assert.deepEqual(
    STARTUP_REQUIREMENTS.map((requirement) => [
      requirement.id,
      requirement.issue,
      requirement.profiles.join(' '),
      requirement.failure,
      requirement.check ? 'check' : requirement.load ? 'owner check' : 'pending',
    ]),
    [
      ['auth.provider', '#1', 'owner', 'fatal', 'check'],
      ['auth.secret', '#2', 'owner', 'fatal', 'owner check'],
      ['data.directory', '#2, #3', 'owner', 'fatal', 'owner check'],
      ['documents.pair', '#4', 'owner read-only', 'fatal', 'check'],
      ['documents.shape', '#3', 'owner', 'fatal', 'pending'],
      ['revision.integrity', '#3', 'owner', 'degraded', 'pending'],
    ],
  );
});

test('documents.pair stops read-only on a blocking record, reported once, and passes warnings', async (t) => {
  const missing = deployment(t, { PORTFOLIO_PROFILE: 'read-only' }, { 'portfolio.yml': PORTFOLIO });
  const stopped = await compose(inputs(missing));
  assert.equal(stopped.ok, false);
  assert.deepEqual(
    stopped.issues.map((issue) => `${issue.severity} ${issue.key}:${issue.code} ${issue.document}`),
    ['fatal PORTFOLIO_SOURCE_DIR:source.missing site'],
  );

  // A warning starts the server, and is logged once.
  const extended = deployment(
    t,
    { PORTFOLIO_PROFILE: 'read-only' },
    {
      'portfolio.yml': PORTFOLIO.replace(
        '  name: Rowan Test',
        "  name: Rowan Test\n  extensions:\n    '@other/x': { a: 1 }",
      ),
      'site.yml': readFileSync(EXAMPLES.site, 'utf8'),
    },
  );
  const started = await compose(inputs(extended));
  assert.ok(started.ok, JSON.stringify(started.issues));
  assert.deepEqual(
    started.issues.map((issue) => `${issue.severity} ${issue.code} ${issue.path}`),
    ['warning extension.unregistered /identity/extensions/@other~1x'],
  );

  // Without the row, the branch still refuses the pair, and says why.
  const bare = await compose({ ...inputs(missing), requirements: [] });
  assert.deepEqual(
    bare.issues.map((issue) => issue.code),
    ['source.missing'],
  );
});

test('only an owner-only requirement loads its check from owner code', () => {
  for (const requirement of STARTUP_REQUIREMENTS) {
    if (requirement.load) assert.deepEqual(requirement.profiles, ['owner'], requirement.id);
  }
});

/** A requirement for read-only whose check finds `issues`. */
function finding(
  failure: StartupRequirement['failure'],
  issues: ConfigIssue[],
): StartupRequirement {
  return {
    id: `test.${failure}`,
    issue: '#1',
    profiles: ['read-only'],
    failure,
    check: async () => issues,
  };
}

const BROKEN: ConfigIssue = {
  severity: 'fatal',
  key: 'PORTFOLIO_SOURCE_DIR',
  code: 'revision_unreadable',
  message: 'test',
};

test('a degraded requirement that fails starts anyway, as a warning, and is listed', async (t) => {
  const config = deployment(t, { PORTFOLIO_PROFILE: 'read-only' });
  const composed = await compose({
    ...inputs(config),
    requirements: [finding('degraded', [BROKEN])],
  });
  assert.ok(composed.ok, JSON.stringify(composed.issues));
  assert.deepEqual(
    composed.issues.map((issue) => `${issue.severity} ${issue.code}`),
    ['warning revision_unreadable'],
  );
  assert.deepEqual(composed.state.degraded, ['test.degraded']);
  assert.ok(Object.isFrozen(composed.state.degraded));
});

test('a fatal requirement that fails stops startup, and its warnings pass', async (t) => {
  const config = deployment(t, { PORTFOLIO_PROFILE: 'read-only' });
  const stopped = await compose({ ...inputs(config), requirements: [finding('fatal', [BROKEN])] });
  assert.equal(stopped.ok, false);
  assert.deepEqual(
    stopped.issues.map((issue) => `${issue.severity} ${issue.code}`),
    ['fatal revision_unreadable'],
  );

  const warned = await compose({
    ...inputs(config),
    requirements: [finding('fatal', [{ ...BROKEN, severity: 'warning' }])],
  });
  assert.ok(warned.ok);
  assert.deepEqual(warned.state.degraded, []);
  assert.deepEqual(
    warned.issues.map((issue) => `${issue.severity} ${issue.code}`),
    ['warning revision_unreadable'],
  );
});

test('a requirement for another profile never runs', async (t) => {
  const config = deployment(t, { PORTFOLIO_PROFILE: 'read-only' });
  const composed = await compose({
    ...inputs(config),
    requirements: [{ ...finding('fatal', [BROKEN]), profiles: ['owner'] }],
  });
  assert.equal(composed.ok, true);
});
