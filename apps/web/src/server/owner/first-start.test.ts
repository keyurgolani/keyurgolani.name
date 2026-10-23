import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UnitChecks } from '@portfolio/core';
import { mountedSource, openStore, preflight, type RevisionId } from '@portfolio/core/owner';
import { readPairBytes } from '@portfolio/schema/node';
import { liveContext } from '~/lib/variants';
import { compose, type AuthProviderFactory, type CompositionInput } from '../composition';
import { readDeploymentConfig, type ConfigIssue, type DeploymentConfig } from '../config';
import { isServable, setDeploymentState } from '../config-store';
import { deploymentUnitChecks } from '../register';
import { check } from './first-start';
import { ownerStore } from './store';

// Owner's first start and the mounted pair after it (#3, item 24). An empty
// store imports the pair as revision 1, by the operator, through the
// startup hook and the server claim. The import is a publish: a pair that
// can't go live stops that start, and so does one a publish refuses, such
// as a site whose variant this build doesn't register, every site's until
// #13. A busy lock never stops it: the import waits for the claim while
// visitors get 503. Once a revision exists, the mounted pair is import input,
// and its findings only warn. A store with history but no live.json is never
// imported over, and one with revisions but no history imports beside them.

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const EXAMPLES = {
  portfolio: path.join(REPO, 'portfolio.example.yml'),
  site: path.join(REPO, 'site.example.yml'),
};
const FIXTURES = path.join(REPO, 'packages', 'schema', 'src', '__fixtures__');
const ORIGIN = 'https://rowan.test';
const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
// Nothing here signs in with a password, so a hash of the right shape will do.
const HASH = `$scrypt$ln=17,r=8,p=1$${base64(randomBytes(16))}$${base64(randomBytes(32))}`;
// The browser harness's portfolio, in whatever schema version this tree is on.
const PORTFOLIO = readFileSync(path.join(REPO, 'tests', 'fixtures', 'portfolio.yml'), 'utf8');
const SITE = readFileSync(EXAMPLES.site, 'utf8');
const PAIR = { 'portfolio.yml': PORTFOLIO, 'site.yml': SITE };
const DESCRIPTION = '  description: Fixture portfolio for the browser harness.\n';

/** The portfolio with `marker` in its meta description: other bytes, the same shape. */
function edited(marker: string): string {
  assert.ok(PORTFOLIO.includes(DESCRIPTION), 'the fixture portfolio has its meta description');
  return PORTFOLIO.replace(DESCRIPTION, `  description: Fixture portfolio, ${marker}.\n`);
}

/** #2's provider as a double: `x-test-session: owner` has a session, and a command from ORIGIN passes. */
const PROVIDER: AuthProviderFactory = {
  name: 'test-double',
  load: async ({ config, mintSession }) => {
    const session = mintSession();
    return {
      resolveSession: async ({ request }) => ({
        session: request.headers.get('x-test-session') === 'owner' ? session : null,
      }),
      checkOrigin: async ({ request }) => request.headers.get('origin') === config.origin,
      touchSession: async () => {},
    };
  },
};

interface Site {
  readonly sourceDir: string;
  readonly dataDir: string;
  readonly config: DeploymentConfig;
}

/** An owner deployment: PORTFOLIO_SOURCE_DIR holding `files`, and an empty data directory. */
function deployment(
  t: TestContext,
  files: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>> = {},
): Site {
  const root = mkdtempSync(path.join(tmpdir(), 'first-start-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'config');
  const dataDir = path.join(root, 'data');
  mkdirSync(sourceDir);
  mkdirSync(dataDir, { mode: 0o700 });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(sourceDir, name), text);
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: sourceDir,
      PORTFOLIO_DATA_DIR: dataDir,
      PORTFOLIO_AUTH_PASSWORD_HASH: HASH,
      ...env,
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  return { sourceDir, dataDir, config: read.config };
}

/** One of #4's fixture directories, by its path under __fixtures__. */
function fixture(name: string): Record<string, string> {
  const dir = path.join(FIXTURES, name);
  return Object.fromEntries(
    readdirSync(dir)
      .filter((file) => !file.startsWith('.'))
      .map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
  );
}

/**
 * The build's checks, in a build that registers the site's variant. Until
 * #13 this one registers none a site can select, so a publish here takes
 * the pair as serving does, and keeps the build's rendering and snapshots.
 */
function registered(origin: string): UnitChecks {
  const checks = deploymentUnitChecks(origin);
  return { ...checks, validate: checks.validateLive! };
}

/** Owner's startup as register() runs it, with the live context, in a build that registers the site's variant. */
async function start(t: TestContext, site: Site, overrides: Partial<CompositionInput> = {}) {
  const { catalog, extensions, validators } = liveContext();
  const composed = await compose({
    config: site.config,
    examples: EXAMPLES,
    catalog,
    extensions,
    validators,
    report: () => {},
    authProviders: [PROVIDER],
    unitChecks: registered,
    ...overrides,
  });
  if (composed.ok) {
    t.after(() => composed.state.release?.());
    // As register() does.
    setDeploymentState(composed.state);
    t.after(() => setDeploymentState(undefined));
  }
  return composed;
}

/** The events in the data directory's log, in seq order. */
function eventsIn(dataDir: string): Record<string, unknown>[] {
  const dir = path.join(dataDir, 'publication', 'events');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^[1-9][0-9]*\.json$/.test(name))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .map(
      (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as Record<string, unknown>,
    );
}

const livePath = (dataDir: string) => path.join(dataDir, 'publication', 'live.json');

/** The sourceHash an import of the pair in `dir` records. */
function mountedHash(dir: string): string {
  const read = readPairBytes(dir);
  assert.ok(read.ok, JSON.stringify(read));
  return mountedSource(read.files).sourceHash;
}

const findings = (issues: readonly ConfigIssue[]) =>
  issues.map((issue) => `${issue.severity} ${issue.code}`);

/** Every JSON line the mocked console.log was given. */
function logLines(logged: { mock: { calls: { arguments: unknown[] }[] } }) {
  return logged.mock.calls.flatMap((call) => {
    try {
      return [JSON.parse(String(call.arguments[0])) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

/** Waits for `done`, up to 10 s. */
async function until(done: () => boolean | Promise<boolean>): Promise<void> {
  for (const started = Date.now(); !(await done());) {
    assert.ok(Date.now() - started < 10_000, 'still waiting after 10 s');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * The store beside the server, as the CLI opens one. This build registers no
 * variant a site can select, so a publish here is checked as served, as a
 * build that registers the site's variant would check it.
 */
function sideStore(site: Site) {
  return openStore({ dataDir: site.dataDir, checks: registered(ORIGIN) });
}

test('an empty store imports the mounted pair at first start as revision 1, by the operator, and serves it', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  const site = deployment(t, PAIR);
  const composed = await start(t, site);
  assert.ok(composed.ok, JSON.stringify(composed.issues));
  assert.ok(composed.issues.every((issue) => issue.severity !== 'fatal'));
  const live = await composed.state.catalog.getLive();
  assert.equal(live.state, 'live');
  assert.match(String(live.revisionId), /^rev_[0-9a-f]{32}$/);
  assert.equal(isServable(), true);
  assert.deepEqual(
    eventsIn(site.dataDir).map((event) => [
      event.seq,
      event.type,
      event.actor,
      event.revisionId,
      event.previousRevisionId,
      event.sourceHash,
    ]),
    [[1, 'import', 'operator', live.revisionId, null, mountedHash(site.sourceDir)]],
  );
  assert.ok(
    logLines(logged).some(
      (line) =>
        line.event === 'store.import.first_start' &&
        line.revisionId === live.revisionId &&
        line.seq === 1,
    ),
  );
  // The next start finds a revision live, and imports nothing more.
  const again = await start(t, site);
  assert.ok(again.ok, JSON.stringify(again.ok ? [] : again.issues));
  assert.equal(eventsIn(site.dataDir).length, 1);
});

test("a pair that can't go live stops a first start: a missing document, an invalid one, the old format, or the bundled sample in production", async (t) => {
  t.mock.method(console, 'log', () => {});
  const cases: [string, Record<string, string>][] = [
    ['source.missing', fixture('startup/site-only')],
    ['schema.invalid', fixture('invalid/schema.invalid')],
    ['legacy.document', fixture('startup/legacy-only')],
    [
      'sample_identity',
      { 'portfolio.yml': readFileSync(EXAMPLES.portfolio, 'utf8'), 'site.yml': SITE },
    ],
  ];
  for (const [code, files] of cases) {
    const site = deployment(t, files);
    const composed = await start(t, site);
    assert.equal(composed.ok, false, code);
    assert.ok(
      findings(composed.issues).includes(`fatal ${code}`),
      `${code}: ${findings(composed.issues)}`,
    );
    assert.equal(existsSync(livePath(site.dataDir)), false, code);
    assert.deepEqual(eventsIn(site.dataDir), [], code);
  }
});

test("with this build's registry, a site whose variant it doesn't register stops a first start, as it stops portfolio-store import, even with the lock busy", async (t) => {
  t.mock.method(console, 'log', () => {});
  const site = deployment(t, PAIR);
  const composed = await start(t, site, { unitChecks: deploymentUnitChecks });
  assert.equal(composed.ok, false);
  const issues = composed.ok ? [] : composed.issues;
  // The publish's record, with the field and the fix, in place of startup's warning.
  const variant = issues.filter((issue) => issue.code === 'variant.unavailable');
  assert.equal(variant.length, 1, JSON.stringify(variant));
  assert.equal(variant[0]?.severity, 'fatal');
  assert.equal(variant[0]?.path, '/appearance/variant');
  assert.match(variant[0]?.remediation ?? '', /pnpm --filter @portfolio\/web add/);
  assert.ok(findings(issues).includes('fatal store_import_failed'));
  assert.equal(existsSync(livePath(site.dataDir)), false);
  assert.deepEqual(eventsIn(site.dataDir), []);

  // With the CLI holding the lock, it stops at once, without waiting for it.
  const busy = deployment(t, PAIR);
  const owner = ownerStore({
    config: busy.config,
    checks: deploymentUnitChecks(ORIGIN),
    setServable: () => {},
    timing: { lockWaitMs: 50, claimRetryMs: [20, 40] },
  });
  t.after(() => owner.release());
  assert.equal(await preflight({ dataDir: busy.dataDir }), null);
  const cli = { pid: 1, startTime: 'x', hostname: 'another-host', holder: 'cli:backup' };
  writeFileSync(
    path.join(busy.dataDir, 'publication', 'lock'),
    JSON.stringify({ ...cli, at: new Date().toISOString(), nonce: 'cli' }),
  );
  assert.deepEqual(findings(await owner.checkDirectory()), ['warning data_dir_unclaimed']);
  assert.deepEqual(await owner.checkIntegrity(), []);
  const refused = findings(await check({ documents: { ok: true, issues: [] }, owner }));
  assert.ok(refused.includes('fatal variant.unavailable'), String(refused));
  assert.ok(refused.includes('fatal store_import_failed'), String(refused));
  assert.equal(refused.includes('warning store_import_waiting'), false);
});

test('next dev imports the bundled examples into an empty store when the source directory holds neither document', async (t) => {
  t.mock.method(console, 'log', () => {});
  const site = deployment(t, {}, { NODE_ENV: 'development' });
  const composed = await start(t, site);
  assert.ok(composed.ok, JSON.stringify(composed.ok ? [] : composed.issues));
  assert.equal((await composed.state.catalog.getLive()).state, 'live');
  const examples = mountedSource({
    portfolio: { name: 'portfolio.example.yml', bytes: readFileSync(EXAMPLES.portfolio) },
    site: { name: 'site.example.yml', bytes: readFileSync(EXAMPLES.site) },
  });
  assert.deepEqual(
    eventsIn(site.dataDir).map((event) => [event.type, event.sourceHash]),
    [['import', examples.sourceHash]],
  );

  // Production takes neither document as a missing pair.
  const production = deployment(t, {});
  const refused = await start(t, production);
  assert.equal(refused.ok, false);
  assert.deepEqual(eventsIn(production.dataDir), []);
});

test('with the lock busy at first start, owner starts, visitors get 503 until the background import commits, and nothing stops it', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  const site = deployment(t, PAIR);
  let servable: boolean | undefined;
  const owner = ownerStore({
    config: site.config,
    checks: registered(ORIGIN),
    setServable: (value) => {
      servable = value;
    },
    timing: { lockWaitMs: 50, claimRetryMs: [20, 40] },
  });
  t.after(() => owner.release());
  // The CLI holds the lock through a backup: its record, from another host.
  assert.equal(await preflight({ dataDir: site.dataDir }), null);
  const lock = path.join(site.dataDir, 'publication', 'lock');
  const cli = { pid: 1, startTime: 'x', hostname: 'another-host', holder: 'cli:backup' };
  writeFileSync(lock, JSON.stringify({ ...cli, at: new Date().toISOString(), nonce: 'cli' }));

  assert.deepEqual(findings(await owner.checkDirectory()), ['warning data_dir_unclaimed']);
  assert.deepEqual(await owner.checkIntegrity(), []);
  const documents = { ok: true, issues: [] };
  assert.deepEqual(findings(await check({ documents, owner })), ['warning store_import_waiting']);
  assert.equal(servable, false);
  assert.equal((await owner.reader.getLive()).state, 'empty');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    existsSync(livePath(site.dataDir)),
    false,
    'nothing imported while the lock is held',
  );

  // The backup ends: the background claim imports the pair, and visitors are served.
  rmSync(lock);
  await until(() => servable === true);
  const live = await owner.reader.getLive();
  assert.equal(live.state, 'live');
  assert.deepEqual(
    eventsIn(site.dataDir).map((event) => [event.seq, event.type, event.actor, event.revisionId]),
    [[1, 'import', 'operator', live.revisionId]],
  );
  const events = logLines(logged).map((line) => line.event);
  for (const event of [
    'store.server.claim_waiting',
    'store.server.claimed',
    'store.import.first_start',
  ]) {
    assert.ok(events.includes(event), event);
  }
  assert.deepEqual(owner.writes(), { state: 'open' });
});

test('a lock the CLI takes between the claim and the import makes the import wait, and the background claim brings it in', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  const site = deployment(t, PAIR);
  let servable: boolean | undefined;
  const owner = ownerStore({
    config: site.config,
    checks: registered(ORIGIN),
    setServable: (value) => {
      servable = value;
    },
    timing: { lockWaitMs: 50, claimRetryMs: [20, 40] },
  });
  t.after(() => owner.release());
  assert.deepEqual(await owner.checkDirectory(), []);
  assert.deepEqual(await owner.checkIntegrity(), []);
  const lock = path.join(site.dataDir, 'publication', 'lock');
  const cli = { pid: 1, startTime: 'x', hostname: 'another-host', holder: 'cli:import' };
  writeFileSync(lock, JSON.stringify({ ...cli, at: new Date().toISOString(), nonce: 'cli' }));
  assert.deepEqual(findings(await check({ documents: { ok: true, issues: [] }, owner })), [
    'warning store_import_waiting',
  ]);
  assert.equal(servable, false);
  // The background import finds the lock busy too, and keeps trying.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(
    existsSync(livePath(site.dataDir)),
    false,
    'nothing imported while the lock is held',
  );
  rmSync(lock);
  await until(() => servable === true);
  assert.equal(eventsIn(site.dataDir).length, 1);
  // The claim was this server's all along: no second store.server.claimed.
  assert.equal(logLines(logged).filter((line) => line.event === 'store.server.claimed').length, 0);
});

test('a pair that went away while the import waited is logged, and the store stays empty', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  const site = deployment(t, PAIR);
  const owner = ownerStore({
    config: site.config,
    checks: registered(ORIGIN),
    setServable: () => {},
    timing: { lockWaitMs: 50, claimRetryMs: [20, 40] },
  });
  t.after(() => owner.release());
  assert.equal(await preflight({ dataDir: site.dataDir }), null);
  const lock = path.join(site.dataDir, 'publication', 'lock');
  const cli = { pid: 1, startTime: 'x', hostname: 'another-host', holder: 'cli:backup' };
  writeFileSync(lock, JSON.stringify({ ...cli, at: new Date().toISOString(), nonce: 'cli' }));
  await owner.checkDirectory();
  await owner.checkIntegrity();
  await check({ documents: { ok: true, issues: [] }, owner });
  rmSync(path.join(site.sourceDir, 'site.yml'));
  rmSync(lock);
  const failed = () =>
    logLines(logged).filter(
      (line) => line.event === 'store.import.failed' && line.code === 'source_unreadable',
    ).length;
  await until(() => failed() === 1);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(failed(), 1, 'it tries once, and stops');
  assert.equal((await owner.reader.getLive()).state, 'empty');
  assert.deepEqual(eventsIn(site.dataDir), []);
  assert.deepEqual(owner.writes(), { state: 'open' });
});

test('a store that has published but lost its live.json is never imported over, and a staging directory a crash left is repaired first', async (t) => {
  t.mock.method(console, 'log', () => {});
  // A first start, and then its pointer gone: the last known good serves.
  const lost = deployment(t, PAIR);
  const first = await start(t, lost);
  assert.ok(first.ok);
  const imported = (await first.state.catalog.getLive()).revisionId;
  const before = eventsIn(lost.dataDir);
  rmSync(livePath(lost.dataDir));
  const again = await start(t, lost);
  assert.ok(again.ok, JSON.stringify(again.ok ? [] : again.issues));
  assert.ok(findings(again.issues).includes('warning revision_damaged'));
  const served = await again.state.catalog.getLive();
  assert.deepEqual([served.state, served.revisionId], ['degraded', imported]);
  assert.deepEqual(eventsIn(lost.dataDir), before);
  assert.equal(existsSync(livePath(lost.dataDir)), false);

  // What a crash mid-import leaves, startup's repair removes, and the import goes on.
  const crashed = deployment(t, PAIR);
  assert.equal(await preflight({ dataDir: crashed.dataDir }), null);
  const staging = path.join(crashed.dataDir, 'revisions', `.staging-rev_${'b'.repeat(32)}`);
  mkdirSync(staging);
  const repaired = await start(t, crashed);
  assert.ok(repaired.ok, JSON.stringify(repaired.ok ? [] : repaired.issues));
  assert.equal(existsSync(staging), false);
  assert.deepEqual(
    eventsIn(crashed.dataDir).map((event) => event.type),
    ['import'],
  );
});

test('a store with revision directories but no live.json and no events imports the mounted pair as a new revision at first start, and leaves every old one byte for byte', async (t) => {
  t.mock.method(console, 'log', () => {});
  // Revisions with no pointer and no log, as a first publish that failed
  // before its pointer leaves one, or a store whose live.json and events/
  // were both lost: no history, so the store is empty.
  const site = deployment(t, PAIR);
  assert.equal(await preflight({ dataDir: site.dataDir }), null);
  const side = sideStore(site);
  const old: string[] = [];
  for (const marker of ['one', 'two']) {
    const created = await side.drafts.create(
      {
        documents: {
          portfolio: { format: 'yaml', sourceText: edited(marker) },
          site: { format: 'yaml', sourceText: SITE },
        },
      },
      'owner',
    );
    assert.ok(created.kind === 'saved', JSON.stringify(created));
    const published = await side.publication.publish(
      {
        draftId: created.draft.draftId,
        draftVersion: created.draft.version,
        expectedLiveRevisionId: (old.at(-1) ?? null) as RevisionId | null,
      },
      'operator',
    );
    assert.ok(published.kind === 'committed', JSON.stringify(published));
    old.push(published.revisionId);
  }
  rmSync(livePath(site.dataDir));
  rmSync(path.join(site.dataDir, 'publication', 'events'), { recursive: true });
  mkdirSync(path.join(site.dataDir, 'publication', 'events'), { mode: 0o700 });
  const revisions = path.join(site.dataDir, 'revisions');
  const bytes = () =>
    Object.fromEntries(
      old.map((id) => [
        id,
        readdirSync(path.join(revisions, id), { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const file = path.join(entry.parentPath, entry.name);
            return [path.relative(revisions, file), readFileSync(file).toString('base64')];
          })
          .sort(),
      ]),
    );
  const before = bytes();

  const started = await start(t, site);
  assert.ok(started.ok, JSON.stringify(started.ok ? [] : started.issues));
  const live = await started.state.catalog.getLive();
  assert.equal(live.state, 'live');
  assert.ok(!old.includes(String(live.revisionId)), 'a new revision, not an old one');
  assert.deepEqual(
    eventsIn(site.dataDir).map((event) => [event.seq, event.type, event.revisionId]),
    [[1, 'import', live.revisionId]],
  );
  assert.deepEqual(bytes(), before, 'every old revision directory stays as it was');
  assert.deepEqual(
    readdirSync(revisions)
      .filter((name) => name.startsWith('rev_'))
      .sort(),
    [...old, String(live.revisionId)].sort(),
  );
});

test("once a revision is live, the pair's startup findings only warn, and the store serves what it did", async (t) => {
  t.mock.method(console, 'log', () => {});
  const site = deployment(t, PAIR);
  const first = await start(t, site);
  assert.ok(first.ok);
  const live = (await first.state.catalog.getLive()).revisionId;
  const portfolio = path.join(site.sourceDir, 'portfolio.yml');
  for (const [code, change] of [
    ['source.missing', () => rmSync(path.join(site.sourceDir, 'site.yml'))],
    [
      'schema.invalid',
      () => {
        copyFileSync(path.join(FIXTURES, 'invalid', 'schema.invalid', 'portfolio.yml'), portfolio);
        writeFileSync(path.join(site.sourceDir, 'site.yml'), SITE);
      },
    ],
    [
      'legacy.document',
      () => {
        copyFileSync(path.join(FIXTURES, 'startup', 'legacy-only', 'portfolio.yml'), portfolio);
        rmSync(path.join(site.sourceDir, 'site.yml'));
      },
    ],
  ] as const) {
    change();
    const composed = await start(t, site);
    assert.ok(composed.ok, `${code}: ${JSON.stringify(composed.ok ? [] : composed.issues)}`);
    assert.ok(
      findings(composed.issues).includes(`warning ${code}`),
      `${code}: ${findings(composed.issues)}`,
    );
    assert.ok(
      composed.issues.every((issue) => issue.severity !== 'fatal'),
      code,
    );
    const served = await composed.state.catalog.getLive();
    assert.deepEqual([served.state, served.revisionId], ['live', live], code);
    assert.equal(eventsIn(site.dataDir).length, 1, code);
  }
});
