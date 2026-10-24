import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPair } from '@portfolio/schema/node';
import type { VariantRegistry } from '@portfolio/variant-contract';
import { REGISTRY } from '~/lib/variants';
import { BUNDLED_SAMPLE_NAMES } from '../lib/sample-identity';
import type { LiveRevision, PublicationUnit } from './catalog-port';
import {
  compose,
  recordingLive,
  refreshingOnCommit,
  STARTUP_REQUIREMENTS,
  type StartupRequirement,
} from './composition';
import { readDeploymentConfig, type ConfigIssue, type Env } from './config';
import {
  liveCaseStudies,
  liveComposition,
  setDeploymentState,
  setLiveCaseStudies,
  setLiveComposition,
  setServable,
} from './config-store';
import { loadedOwnerModules } from './load-trace';
import { listOperations } from './operations';
import { resolveRoute } from './routes';
import { startStartupMedia } from './startup-media';

// The composition root for profiles that never load owner code. Owner with a
// provider, which does, has its own file: the load trace is per process.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};
const PORTFOLIO =
  'schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n';

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
  assert.equal(
    (await composed.state.catalog.getLive()).unit!.portfolio.identity.name,
    'Rowan Test',
  );
  assert.deepEqual(loadedOwnerModules(), []);
  assert.deepEqual(composed.state.degraded, []);
  // No Studio page finds a session here (#2).
  assert.equal(composed.state.pages, undefined);

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
  // A build that registers none; this one registers the password provider.
  const composed = await compose({ ...inputs(config), authProviders: [] });
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
  assert.ok(BUNDLED_SAMPLE_NAMES.includes(live.unit!.portfolio.identity.name));
  assert.match(live.revisionId ?? '', /^sample-/);
  assert.deepEqual(loadedOwnerModules(), []);
  assert.equal(composed.state.pages, undefined);

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

test('the tagged startup rows are named requirements for #2, #3, #4, and #10', () => {
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
      ['auth.limits', '#2', 'owner', 'fatal', 'check'],
      ['data.directory', '#2, #3', 'owner', 'fatal', 'owner check'],
      ['documents.pair', '#4', 'read-only', 'fatal', 'check'],
      ['revision.integrity', '#3', 'owner', 'degraded', 'owner check'],
      ['documents.shape', '#3', 'owner', 'fatal', 'owner check'],
      ['media.renditions', '#10', 'owner', 'degraded', 'owner check'],
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

test("every profile's reader records the composition each live revision renders, as proxy.ts reads it (#6, Slice 2)", async (t) => {
  t.after(() => setLiveComposition(undefined));
  const demo = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'demo',
      PORTFOLIO_ORIGIN: 'https://demo.rowan.test',
    },
    { cwd: '/' },
  );
  assert.ok(demo.ok, JSON.stringify(demo.issues));
  for (const config of [deployment(t, { PORTFOLIO_PROFILE: 'read-only' }), demo.config]) {
    setLiveComposition('stale');
    const composed = await compose(inputs(config));
    assert.equal(composed.ok, true, config.profile);
    if (!composed.ok) continue;
    await composed.state.catalog.getLive();
    // Both pairs select the platform default, Editorial Evidence, which renders (#13).
    assert.equal(liveComposition(), 'editorial-evidence', config.profile);
  }
  // A registered selection records its own id, on every read.
  const registry: VariantRegistry = [
    ...REGISTRY,
    { ...REGISTRY[0]!, manifest: { ...REGISTRY[0]!.manifest, id: 'acme-tiles' } },
  ];
  let variant = 'acme-tiles';
  const live = () => ({ unit: { site: { appearance: { variant } } } }) as unknown as LiveRevision;
  const reader = recordingLive({ getLive: async () => live() }, registry);
  await reader.getLive();
  assert.equal(liveComposition(), 'acme-tiles');
  variant = 'acme-gone';
  await reader.getLive();
  assert.equal(liveComposition(), 'fallback');
  assert.ok(Object.isFrozen(reader));
  // Nothing servable, as an empty or incompatible store answers: no composition.
  for (const state of ['empty', 'incompatible'] as const) {
    setLiveComposition('acme-tiles');
    const none = recordingLive(
      { getLive: async () => ({ state, revisionId: null, unitHash: null, unit: null }) },
      registry,
    );
    assert.equal((await none.getLive()).state, state);
    assert.equal(liveComposition(), undefined, state);
  }
});

/** The example pair's one case study: its signature work, which a visible works section lists. */
const SLUG = 'postmortem-template-kit';

/** Whether the route table serves `/work/<slug>` under read-only, as proxy.ts asks it. */
const routes = (slug: string) => resolveRoute('read-only', `/work/${slug}`).status === 'served';

test('the reader records the slugs /work serves in the same step as the composition, and a background read records them too (#10b)', async (t) => {
  t.after(() => {
    setLiveComposition(undefined);
    setLiveCaseStudies(undefined);
  });
  setLiveCaseStudies(undefined);
  // Before the first read, no slug serves.
  assert.deepEqual([...liveCaseStudies()], []);
  assert.equal(routes(SLUG), false);
  const config = deployment(
    t,
    { PORTFOLIO_PROFILE: 'read-only' },
    {
      // read-only refuses the bundled sample's identity.
      'portfolio.yml': readFileSync(EXAMPLES.portfolio, 'utf8').replace(
        '\n  name: Anamika Devi\n',
        '\n  name: Rowan Test\n',
      ),
      'site.yml': readFileSync(EXAMPLES.site, 'utf8'),
    },
  );
  const composed = await compose(inputs(config));
  assert.ok(composed.ok, JSON.stringify(!composed.ok && composed.issues));
  // register() starts the media derivation in the background, through the
  // composition's reader, as Studio's variantHealth reads through owner's.
  // That read records the set, before any request reads the revision.
  await startStartupMedia({
    profile: 'read-only',
    reader: composed.state.catalog,
    options: {
      fetchRemote: async () => {
        throw new Error('This test fetches nothing.');
      },
    },
  });
  // The example selects the platform default, Editorial Evidence, which renders (#13).
  assert.equal(liveComposition(), 'editorial-evidence');
  assert.deepEqual([...liveCaseStudies()], [SLUG]);
  assert.equal(routes(SLUG), true);
});

test('a publish that drops a case study, or makes its work private, turns its slug missing on the next read, with no restart (#10b)', async (t) => {
  t.after(() => {
    setLiveComposition(undefined);
    setLiveCaseStudies(undefined);
    setServable(true);
  });
  const read = readPair(EXAMPLES);
  assert.ok(read.ok);
  const published = { ...read.pair, snapshots: {} } as unknown as PublicationUnit;
  const withWork = (change: (work: Record<string, unknown>) => Record<string, unknown>) =>
    ({
      ...published,
      portfolio: {
        ...published.portfolio,
        works: published.portfolio.works?.map((work) =>
          work.id === SLUG ? change({ ...work }) : work,
        ),
      },
    }) as unknown as PublicationUnit;
  let unit: PublicationUnit | null = published;
  const live = (): LiveRevision =>
    unit
      ? { state: 'live', revisionId: 'r', unitHash: 'sha256:r', unit }
      : { state: 'empty', revisionId: null, unitHash: null, unit: null };
  const reader = recordingLive({ getLive: async () => live() });
  await reader.getLive();
  assert.equal(routes(SLUG), true);
  // The next revision drops the case study.
  unit = withWork((work) => {
    delete work.caseStudy;
    return work;
  });
  await reader.getLive();
  assert.equal(routes(SLUG), false);
  // A later one brings it back, and another makes the work private.
  unit = published;
  await reader.getLive();
  assert.equal(routes(SLUG), true);
  unit = withWork((work) => ({ ...work, visibility: 'private' }));
  await reader.getLive();
  assert.equal(routes(SLUG), false);
  assert.deepEqual([...liveCaseStudies()], []);
  // A view that won't build, and an empty store, record none either.
  unit = published;
  await reader.getLive();
  unit = { ...published, portfolio: null } as unknown as PublicationUnit;
  await reader.getLive();
  assert.equal(routes(SLUG), false);
  unit = published;
  await reader.getLive();
  unit = null;
  await reader.getLive();
  assert.equal(routes(SLUG), false);
  // The hidden fixture's case studies, a private work's and a public one
  // only a hidden section reaches, record nothing.
  const dir = fileURLToPath(new URL('../../../../tests/fixtures/hidden/', import.meta.url));
  const hidden = readPair({ portfolio: `${dir}portfolio.yml`, site: `${dir}site.yml` });
  assert.ok(hidden.ok);
  unit = { ...hidden.pair, snapshots: {} } as unknown as PublicationUnit;
  await reader.getLive();
  assert.deepEqual([...liveCaseStudies()], []);
  assert.equal(routes('canary-hidden-private-slug'), false);
  assert.equal(routes('canary-hidden-record-slug'), false);
  // And while nothing is servable, the last set serves no slug.
  unit = published;
  await reader.getLive();
  setServable(false);
  assert.equal(routes(SLUG), false);
});

test("a Studio publish that commits reads the live revision once before it answers, and a read that fails doesn't fail the publish (#10b)", async () => {
  let reads = 0;
  let fail = false;
  const reader = {
    async getLive() {
      reads += 1;
      if (fail) throw new Error('storage_unavailable');
      return { state: 'empty' } as never;
    },
  };
  const outcome = (kind: string) => async () => ({ kind, revisionId: 'rev_1' });
  const studio = refreshingOnCommit(
    { publish: outcome('committed'), rollback: outcome('conflict'), recover: outcome('committed') },
    reader,
  );
  assert.deepEqual(await studio.publish(), { kind: 'committed', revisionId: 'rev_1' });
  assert.equal(reads, 1);
  // Nothing committed, nothing to read.
  await studio.rollback();
  assert.equal(reads, 1);
  // The commit stands when the read after it fails.
  fail = true;
  assert.deepEqual(await studio.recover(), { kind: 'committed', revisionId: 'rev_1' });
  assert.equal(reads, 2);
});
