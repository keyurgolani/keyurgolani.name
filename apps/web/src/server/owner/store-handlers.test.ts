import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSessions,
  memoryAuditSink,
  memorySessionStore,
  preflight,
  StoreError,
  type Draft,
  type PublicationOutcome,
  type Store,
} from '@portfolio/core/owner';
import { validatePublicationUnit } from '@portfolio/schema';
import { readDeploymentConfig, type DeploymentConfig } from '../config';
import { setDeploymentState } from '../config-store';
import { createDispatcher, NO_BINDINGS, type StudioBindings } from '../dispatcher';
import { listOperations } from '../operations';
import { errorResult } from '../studio-result';
import { mintSession } from './session-mint';
import { ownerStore, studioStore, type StudioStore } from './store';
import { RETRY_AFTER_SECONDS, storeHandlers } from './store-handlers';

// #3's Studio operations (item 22): what each store outcome answers through
// the dispatcher, with error.details for the owner; the lock before the
// session, never the other way round; Studio acting as the owner only; and
// owner writes that stop while a startup repair still fails.

const ORIGIN = 'https://rowan.test';
const SITE = readFileSync(
  fileURLToPath(new URL('../../../../../site.example.yml', import.meta.url)),
  'utf8',
);
const REVISION = `rev_${'a'.repeat(32)}` as const;
const DRAFT = `drf_${'b'.repeat(32)}` as const;
const HASH = `sha256:${'c'.repeat(64)}` as const;
const SESSION = mintSession();
const CHECKS = {
  validate: (pair: Parameters<typeof validatePublicationUnit>[0]) =>
    validatePublicationUnit(pair, { canonicalOrigin: ORIGIN }),
  appVersion: 'test',
};

function documents(name: string) {
  return {
    portfolio: {
      format: 'yaml' as const,
      sourceText: `schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: ${name}\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n`,
    },
    site: { format: 'yaml' as const, sourceText: SITE },
  };
}

function configFor(dataDir: string): DeploymentConfig {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: '/srv/portfolio',
      PORTFOLIO_DATA_DIR: dataDir,
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  return read.config;
}

/** The owner deployment authorize() reads, for the test. */
function deploy(t: TestContext): void {
  setDeploymentState({
    config: configFor('/srv/data'),
    catalog: { getLive: () => assert.fail('no visitor route here') },
    dispatch: () => assert.fail('tests call their own dispatcher'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
}

/** The registry's dispatcher, with the store's handlers and an owner session on `x-test-session`. */
function dispatcher(studio: StudioStore, bindings: Partial<StudioBindings> = {}) {
  return createDispatcher({
    ...NO_BINDINGS,
    operations: listOperations(),
    handlers: storeHandlers(studio),
    resolveSession: async ({ request }) => ({
      session: request.headers.get('x-test-session') === 'owner' ? SESSION : null,
    }),
    checkOrigin: async ({ request }) => request.headers.get('origin') === ORIGIN,
    ...bindings,
  });
}

function command(name: string, body: unknown) {
  return new Request(`${ORIGIN}/api/studio/${name}`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      'x-test-session': 'owner',
      'x-request-id': 'req-store',
    },
    body: JSON.stringify(body),
  });
}

const PUBLISH = { draftId: DRAFT, draftVersion: 1, expectedLiveRevisionId: REVISION };

/** A StudioStore whose every call answers `outcome`, or throws it. */
function answering(outcome: PublicationOutcome | Error): StudioStore {
  const run = async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return new Proxy({} as StudioStore, { get: () => run });
}

const DRAFT_DOCUMENT = { format: 'yaml', sourceText: 'a: 1\n', model: { a: 1 }, diagnostics: [] };
const DIAGNOSTIC = {
  code: 'schema.invalid',
  severity: 'blocks-preview',
  document: 'portfolio',
  pointer: '/identity',
  message: "A value isn't what the schema expects.",
  remediation: 'Change the value.',
};

test('each store outcome answers its status, and an owner 409 or 422 carries its payload in error.details', async (t) => {
  deploy(t);
  const cases: Array<[PublicationOutcome, number, string, unknown]> = [
    [
      {
        kind: 'conflict',
        code: 'live_conflict',
        liveRevisionId: REVISION,
        baseHash: null,
        liveHash: HASH,
        draftHash: HASH,
      },
      409,
      'live_conflict',
      { liveRevisionId: REVISION, baseHash: null, liveHash: HASH, draftHash: HASH },
    ],
    [
      {
        kind: 'conflict',
        code: 'draft_conflict',
        draftId: DRAFT,
        version: 3,
        documents: { portfolio: DRAFT_DOCUMENT, site: DRAFT_DOCUMENT },
      } as PublicationOutcome,
      409,
      'draft_conflict',
      {
        draftId: DRAFT,
        version: 3,
        documents: { portfolio: DRAFT_DOCUMENT, site: DRAFT_DOCUMENT },
      },
    ],
    [
      {
        kind: 'rejected',
        code: 'validation_failed',
        diagnostics: [DIAGNOSTIC],
      } as PublicationOutcome,
      422,
      'validation_failed',
      { diagnostics: [DIAGNOSTIC] },
    ],
    [
      { kind: 'rejected', code: 'asset_missing', diagnostics: [], blobs: [HASH] },
      422,
      'asset_missing',
      { blobs: [HASH] },
    ],
    [
      { kind: 'rejected', code: 'nothing_to_publish', diagnostics: [] },
      409,
      'nothing_to_publish',
      undefined,
    ],
    [{ kind: 'rejected', code: 'not_found', diagnostics: [] }, 404, 'not_found', undefined],
    // A key from another request, and a lock another holder took.
    [
      { kind: 'rejected', code: 'idempotency_conflict', diagnostics: [] },
      422,
      'idempotency_conflict',
      undefined,
    ],
    [{ kind: 'rejected', code: 'lock_lost', diagnostics: [] }, 503, 'lock_lost', undefined],
  ];
  for (const [outcome, status, code, details] of cases) {
    const response = await dispatcher(answering(outcome))(command('publish', PUBLISH), 'publish');
    assert.equal(response.status, status, code);
    // Nothing moved after lock_lost, so it says when to try again, as lock_timeout does.
    assert.equal(
      response.headers.get('retry-after'),
      code === 'lock_lost' ? String(RETRY_AFTER_SECONDS) : null,
      code,
    );
    const { error } = (await response.json()) as { error: Record<string, unknown> };
    assert.equal(error.code, code);
    assert.deepEqual(error.details, details, code);
  }

  // rollback's own: revision_incompatible, with the reason and the CLI command.
  const incompatible = await dispatcher(
    answering({
      kind: 'rejected',
      code: 'revision_incompatible',
      diagnostics: [],
      reason: 'schema.version',
      command: `rollback --to ${REVISION}`,
    }),
  )(command('rollback', { targetRevisionId: REVISION, expectedLiveRevisionId: null }), 'rollback');
  assert.equal(incompatible.status, 422);
  assert.deepEqual(((await incompatible.json()) as { error: { details: unknown } }).error.details, {
    reason: 'schema.version',
    command: `rollback --to ${REVISION}`,
    diagnostics: [],
  });
});

test('a StoreError answers its code alone, 503 with Retry-After for the lock, and its message and cause stay out', async (t) => {
  deploy(t);
  const logged = t.mock.method(console, 'log', () => {});
  const canary = new Error('canary: EACCES /srv/canary/data/publication/live.json');
  for (const [code, status] of [
    ['lock_timeout', 503],
    ['storage_unavailable', 503],
    ['storage_full', 507],
  ] as const) {
    const error = new StoreError(code, 'canary: /srv/canary/data', { cause: canary });
    const response = await dispatcher(answering(error))(command('publish', PUBLISH), 'publish');
    assert.equal(response.status, status, code);
    assert.equal(
      response.headers.get('retry-after'),
      code === 'lock_timeout' ? String(RETRY_AFTER_SECONDS) : null,
    );
    const text = await response.text();
    assert.ok(!text.includes('canary'), text);
    const { error: body } = JSON.parse(text) as { error: Record<string, unknown> };
    assert.deepEqual(Object.keys(body), ['code', 'message', 'requestId']);
    assert.equal(body.code, code);
  }
  // Anything else is a 500, logged with the request and not the error.
  const response = await dispatcher(answering(canary))(command('publish', PUBLISH), 'publish');
  assert.equal(response.status, 500);
  for (const call of logged.mock.calls) assert.ok(!String(call.arguments[0]).includes('canary'));
});

test('a query that the store fails answers storage_unavailable, and a missing revision 404', async (t) => {
  deploy(t);
  const failing = dispatcher(answering(new StoreError('storage_unavailable', 'canary')));
  const listed = await failing(
    new Request(`${ORIGIN}/api/studio/revision.list`, { headers: { 'x-test-session': 'owner' } }),
    'revision.list',
  );
  assert.equal(listed.status, 503);
  const missing = dispatcher({ ...answering(new Error('unused')), revision: async () => null });
  const got = await missing(
    new Request(`${ORIGIN}/api/studio/revision.get?revisionId=${REVISION}`, {
      headers: { 'x-test-session': 'owner' },
    }),
    'revision.get',
  );
  assert.equal(got.status, 404);
});

interface Seeded {
  readonly dataDir: string;
  readonly owner: ReturnType<typeof ownerStore>;
  readonly store: Store;
  readonly live: string;
}

/** An owner store with one revision published, in a directory of its own. */
async function seeded(t: TestContext): Promise<Seeded> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'store-handlers-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const owner = ownerStore({
    config: configFor(dataDir),
    checks: CHECKS,
    setServable: () => {},
  });
  t.after(() => owner.release());
  assert.deepEqual(await owner.checkDirectory(), []);
  const created = await owner.store.drafts.create({ documents: documents('Rowan First') }, 'owner');
  assert.ok(created.kind === 'saved');
  const published = await owner.store.publication.publish(
    { draftId: created.draft.draftId, draftVersion: 1, expectedLiveRevisionId: null },
    'operator',
  );
  assert.ok(published.kind === 'committed');
  return { dataDir, owner, store: owner.store, live: published.revisionId };
}

/** #2's sessions over memory, and a commitWithSession() like the provider's. */
async function sessions() {
  const made = createSessions({
    store: memorySessionStore(),
    audit: memoryAuditSink(),
    fingerprint: 'test-fingerprint',
  });
  const { token, record } = await made.issue({ uaFamily: 'firefox' });
  const commitWithSession: StudioBindings['commitWithSession'] = async (_context, commit) => {
    const holding = await made.holding(token, (hold) => commit(hold));
    return holding.status === 'valid'
      ? { ok: true, value: holding.value }
      : {
          ok: false,
          result: errorResult('authentication_required', {
            headers: { 'set-cookie': '__Host-studio_session=; Max-Age=0; Path=/; Secure' },
          }),
        };
  };
  return { sessions: made, digest: record.digest, commitWithSession };
}

async function workingDraft(store: Store, name: string): Promise<Draft> {
  const working = await store.drafts.getWorking();
  const created = await store.drafts.create(
    { documents: documents(name), ...(working ? { expectedVersion: working.version } : {}) },
    'owner',
  );
  assert.ok(created.kind === 'saved');
  return created.draft;
}

test('a pointer move takes the publication lock first, then the session, and holds the session for the move alone', async (t) => {
  deploy(t);
  const { store, owner, live, dataDir } = await seeded(t);
  const held = await sessions();
  const lockFile = path.join(dataDir, 'publication', 'lock');
  const seen: string[] = [];
  const dispatch = dispatcher(owner.studio, {
    commitWithSession: async (context, commit) => {
      // The store holds the publication lock by the time it asks for the session.
      seen.push(existsSync(lockFile) ? 'lock held' : 'no lock');
      return held.commitWithSession(context, async (hold) => {
        // Inside the hold: the pointer hasn't moved yet, and nothing else runs.
        seen.push(
          readFileSync(path.join(dataDir, 'publication', 'live.json'), 'utf8').includes(live)
            ? 'before the move'
            : 'moved early',
        );
        return commit(hold);
      });
    },
  });
  const draft = await workingDraft(store, 'Rowan Second');
  const response = await dispatch(
    command('publish', {
      draftId: draft.draftId,
      draftVersion: draft.version,
      expectedLiveRevisionId: live,
    }),
    'publish',
  );
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const { data } = JSON.parse(text) as { data: { revisionId: string; seq: number } };
  assert.equal(data.seq, 2);
  assert.deepEqual(seen, ['lock held', 'before the move']);
  assert.equal((await store.publication.status()).liveRevisionId, data.revisionId);
});

test('a publish whose session ended before the move answers what commitWithSession() does, and moves nothing', async (t) => {
  deploy(t);
  const { store, owner, live, dataDir } = await seeded(t);
  const held = await sessions();
  const dispatch = dispatcher(owner.studio, { commitWithSession: held.commitWithSession });
  const draft = await workingDraft(store, 'Rowan Second');
  const pointer = readFileSync(path.join(dataDir, 'publication', 'live.json'), 'utf8');
  const events = readdirSync(path.join(dataDir, 'publication', 'events'));
  // The session ends while the publish waits for nothing but its hold.
  await held.sessions.end(held.digest, 'logout');
  const response = await dispatch(
    command('publish', {
      draftId: draft.draftId,
      draftVersion: draft.version,
      expectedLiveRevisionId: live,
    }),
    'publish',
  );
  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    'authentication_required',
  );
  assert.equal(readFileSync(path.join(dataDir, 'publication', 'live.json'), 'utf8'), pointer);
  assert.deepEqual(readdirSync(path.join(dataDir, 'publication', 'events')), events);
  assert.equal((await store.publication.status()).liveRevisionId, live);
});

test('Studio acts as the owner only: every call names the owner, and a pointer move needs the hold', async (t) => {
  const actors: unknown[] = [];
  const record =
    (answer: unknown) =>
    async (...args: unknown[]) => {
      actors.push(args[1]);
      return answer;
    };
  const fake = {
    drafts: {
      // A save reads the draft first, for the media document it has (#10).
      get: async () => null,
      create: record({ kind: 'saved' }),
      save: record({ kind: 'saved' }),
      applyEdits: record({ kind: 'saved' }),
      rebase: record({ kind: 'saved' }),
      decideChanges: record({ kind: 'saved' }),
      discard: record({ kind: 'discarded' }),
    },
    publication: {
      publish: record({ kind: 'committed' }),
      rollback: record({ kind: 'committed' }),
      recover: record({ kind: 'committed' }),
    },
  } as unknown as Store;
  const studio = studioStore(fake, {} as never, async () => {});
  const holdSession = async () => ({ ok: false as const });
  await studio.createDraft({});
  await studio.saveDraft({ draftId: DRAFT, expectedVersion: 1, documents: documents('x') });
  await studio.applyEdits({ draftId: DRAFT, expectedVersion: 1, edits: [] });
  await studio.rebaseDraft({
    draftId: DRAFT,
    expectedVersion: 1,
    documents: documents('x'),
    baseRevisionId: null,
  });
  await studio.decideChanges({
    draftId: DRAFT,
    expectedVersion: 1,
    changeIds: [`dch_${'0'.repeat(32)}`],
    decision: 'accepted',
  });
  await studio.discardDraft({ draftId: DRAFT });
  await studio.publish(PUBLISH as never, { holdSession });
  await studio.rollback(
    { targetRevisionId: REVISION as never, expectedLiveRevisionId: null },
    { holdSession },
  );
  await studio.recover({ expectedLiveRevisionId: null }, { holdSession });
  assert.deepEqual(actors, Array(9).fill('owner'));
  for (const move of [studio.publish, studio.rollback, studio.recover]) {
    await assert.rejects(() => move(PUBLISH as never, {} as never), /holds the owner's session/);
  }
  t.diagnostic('no Studio call can name the operator');
});

test('with no GitHub token a refresh writes nothing and answers the draft as it is, with token_unset, never an error (#10)', async () => {
  let writes = 0;
  const draft = { draftId: DRAFT, version: 3, documents: {} };
  const fake = {
    drafts: {
      get: async () => draft,
      refreshSources: async () => {
        writes += 1;
        return { kind: 'saved', draft };
      },
    },
  } as unknown as Store;
  // No adapter, as a deployment with no GITHUB_TOKEN builds one that refreshes nothing.
  const studio = studioStore(fake, {} as never, async () => {});
  const outcome = await studio.refreshSources({ draftId: DRAFT, expectedVersion: 3 });
  assert.deepEqual(outcome, { kind: 'saved', draft, findings: [{ code: 'token_unset' }] });
  const stale = await studio.refreshSources({ draftId: DRAFT, expectedVersion: 2 });
  assert.equal(stale.kind === 'conflict' && stale.code, 'draft_conflict');
  assert.equal(writes, 0);
});

test("no app code outside the owner store's wrapper names the operator, so only the CLI acts as one", () => {
  const src = fileURLToPath(new URL('../../', import.meta.url));
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const code = readFileSync(file, 'utf8')
          .split('\n')
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
        if (code.some((line) => /['"`]operator['"`]/.test(line)))
          found.push(path.relative(src, file));
      }
    }
  };
  walk(src);
  // The registry's output schemas name the actors a revision or an event records.
  assert.deepEqual(found.sort(), ['server/store-schemas.ts']);
  const schemas = readFileSync(path.join(src, 'server/store-schemas.ts'), 'utf8');
  assert.equal(schemas.match(/['"]operator['"]/g)?.length, 1);
  assert.match(schemas, /const Actor = z\.enum\(\['owner', 'operator'\]\);/);
});

test('while a startup repair still fails, owner writes stop with store.writes.stopped, reads and visitors go on, and the next write after a fix finishes it', async (t) => {
  deploy(t);
  const logged = t.mock.method(console, 'log', () => {});
  const { owner, dataDir, store } = await seeded(t);
  await workingDraft(store, 'Rowan Draft');
  // A staging directory a crash left, which repair can't remove while its
  // contents can't be listed.
  const staging = path.join(dataDir, 'revisions', `.staging-${REVISION}`);
  mkdirSync(path.join(staging, 'documents'), { recursive: true });
  chmodSync(staging, 0o000);
  t.after(() => {
    if (existsSync(staging)) chmodSync(staging, 0o700);
  });
  const issues = await owner.checkIntegrity();
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ['store_repair_failed'],
  );
  // Visitors are still served.
  assert.equal((await owner.reader.getLive()).state, 'live');
  // Reads go on; writes stop, and say why.
  assert.ok(await owner.studio.getWorking());
  await assert.rejects(
    () => owner.studio.createDraft({}),
    (error: unknown) => error instanceof StoreError && error.code === 'storage_unavailable',
  );
  const lines = logged.mock.calls.map(
    (call) => JSON.parse(String(call.arguments[0])) as Record<string, unknown>,
  );
  assert.ok(
    lines.some(
      (line) => line.event === 'store.writes.stopped' && line.code === 'storage_unavailable',
    ),
  );
  assert.ok(lines.every((line) => !JSON.stringify(line).includes(dataDir)));
  // Once the directory is fixed, the next write finishes the repair first.
  chmodSync(staging, 0o700);
  const working = await owner.studio.getWorking();
  const created = await owner.studio.createDraft({ expectedVersion: working!.version });
  assert.equal(created.kind, 'saved');
  assert.equal(existsSync(staging), false);
  assert.ok(
    logged.mock.calls.some((call) => String(call.arguments[0]).includes('"store.repair.finished"')),
  );
});

/** Waits for `done`, up to 10 s. */
async function until(done: () => boolean): Promise<void> {
  for (const started = Date.now(); !done();) {
    assert.ok(Date.now() - started < 10_000, 'still waiting after 10 s');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('with the lock busy through startup, owner starts and serves, and its writes wait until the claim and the repair are done in the background', async (t) => {
  deploy(t);
  const logged = t.mock.method(console, 'log', () => {});
  const dataDir = mkdtempSync(path.join(tmpdir(), 'store-handlers-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const owner = ownerStore({
    config: configFor(dataDir),
    checks: CHECKS,
    setServable: () => {},
    timing: { lockWaitMs: 50, claimRetryMs: [20, 40] },
  });
  t.after(() => owner.release());
  // A live revision the CLI published, and then the lock it holds through
  // a backup: its record, from another host.
  assert.equal(await preflight({ dataDir }), null);
  const first = await owner.store.drafts.create({ documents: documents('Rowan First') }, 'owner');
  assert.ok(first.kind === 'saved');
  const published = await owner.store.publication.publish(
    { draftId: first.draft.draftId, draftVersion: 1, expectedLiveRevisionId: null },
    'operator',
  );
  assert.equal(published.kind, 'committed');
  const lock = path.join(dataDir, 'publication', 'lock');
  const cli = { pid: 1, startTime: 'x', hostname: 'another-host', holder: 'cli:backup' };
  writeFileSync(lock, JSON.stringify({ ...cli, at: new Date().toISOString(), nonce: 'cli' }));
  const issues = await owner.checkDirectory();
  assert.deepEqual(
    issues.map((issue) => [issue.severity, issue.code]),
    [['warning', 'data_dir_unclaimed']],
  );
  assert.deepEqual(await owner.checkIntegrity(), []);
  const server = path.join(dataDir, 'publication', 'server.json');
  assert.equal(existsSync(server), false);
  assert.deepEqual(owner.writes(), { state: 'stopped', code: 'data_dir_unclaimed' });
  // Visitors are served, and a write waits, saying why.
  assert.equal((await owner.reader.getLive()).state, 'live');
  await assert.rejects(
    () => owner.studio.createDraft({}),
    (error: unknown) => error instanceof StoreError && error.code === 'lock_timeout',
  );
  // The backup ends: the retry claims the directory, finishes the repair, and writes go on.
  rmSync(lock);
  await until(() => owner.writes().state === 'open');
  assert.equal(existsSync(server), true);
  assert.equal((await owner.studio.createDraft({})).kind, 'saved');
  const events = logged.mock.calls.map(
    (call) => (JSON.parse(String(call.arguments[0])) as { event: string; code?: string }).event,
  );
  for (const event of [
    'store.server.claim_waiting',
    'store.writes.stopped',
    'store.server.claimed',
  ]) {
    assert.ok(events.includes(event), event);
  }
  assert.ok(events.includes('store.repair.finished'));
});

test("with something other than a regular file at publication/lock, startup's claim warns data_dir_claim_failed and logs claim_failed with its code, never the busy lock's line", async (t) => {
  deploy(t);
  const logged = t.mock.method(console, 'log', () => {});
  const dataDir = mkdtempSync(path.join(tmpdir(), 'store-handlers-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const owner = ownerStore({
    config: configFor(dataDir),
    checks: CHECKS,
    setServable: () => {},
    timing: { lockWaitMs: 50, claimRetryMs: [20, 40] },
  });
  t.after(() => owner.release());
  assert.equal(await preflight({ dataDir }), null);
  // A link at the lock's name that leads nowhere: no wait ends it.
  const lock = path.join(dataDir, 'publication', 'lock');
  symlinkSync(path.join(dataDir, 'publication', 'nowhere'), lock);
  const issues = await owner.checkDirectory();
  assert.deepEqual(
    issues.map((issue) => [issue.severity, issue.code]),
    [['warning', 'data_dir_claim_failed']],
  );
  assert.doesNotMatch(issues[0]!.message, /busy|backup/);
  assert.deepEqual(await owner.checkIntegrity(), []);
  assert.deepEqual(owner.writes(), { state: 'stopped', code: 'data_dir_unclaimed' });
  const lines = () =>
    logged.mock.calls.map(
      (call) => JSON.parse(String(call.arguments[0])) as { event: string; code?: string },
    );
  // The retry says the same, once more at least, until the link goes.
  await until(
    () => lines().filter((line) => line.event === 'store.server.claim_failed').length >= 2,
  );
  rmSync(lock);
  await until(() => owner.writes().state === 'open');
  const claims = lines().filter((line) => line.event.startsWith('store.server.claim'));
  assert.ok(claims.length >= 3, JSON.stringify(claims));
  for (const line of claims.slice(0, -1)) {
    assert.deepEqual([line.event, line.code], ['store.server.claim_failed', 'storage_unavailable']);
  }
  assert.equal(claims.at(-1)!.event, 'store.server.claimed');
});

test('a write after another server took the claim answers data_dir_in_use, and claims the directory again once that server stopped', async (t) => {
  deploy(t);
  t.mock.method(console, 'log', () => {});
  const dataDir = mkdtempSync(path.join(tmpdir(), 'store-handlers-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const owner = ownerStore({
    config: configFor(dataDir),
    checks: CHECKS,
    setServable: () => {},
    timing: { claimRefreshMs: 20 },
  });
  t.after(() => owner.release());
  assert.deepEqual(await owner.checkDirectory(), []);
  assert.deepEqual(await owner.checkIntegrity(), []);
  // A live revision, as the CLI publishes one, for Studio's draft.create to start from.
  const first = await owner.store.drafts.create({ documents: documents('Rowan First') }, 'owner');
  assert.ok(first.kind === 'saved');
  const published = await owner.store.publication.publish(
    { draftId: first.draft.draftId, draftVersion: 1, expectedLiveRevisionId: null },
    'operator',
  );
  assert.equal(published.kind, 'committed');
  // Another server's fresh claim, in a process that runs.
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], {
    stdio: 'ignore',
  });
  t.after(() => other.kill('SIGKILL'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const server = path.join(dataDir, 'publication', 'server.json');
  const theirs = {
    pid: other.pid,
    startTime: null,
    hostname: hostname(),
    at: new Date().toISOString(),
    nonce: 'theirs',
  };
  writeFileSync(server, JSON.stringify(theirs));
  await until(() => owner.writes().state === 'stopped');
  assert.deepEqual(owner.writes(), { state: 'stopped', code: 'data_dir_in_use' });
  const dispatch = dispatcher(owner.studio);
  const create = {};
  const refused = await dispatch(command('draft.create', create), 'draft.create');
  assert.equal(refused.status, 503);
  assert.equal(
    ((await refused.json()) as { error: { code: string } }).error.code,
    'data_dir_in_use',
  );
  assert.equal(JSON.parse(readFileSync(server, 'utf8')).nonce, 'theirs');
  // That server stopped refreshing: the next write claims the directory again, and goes through.
  const old = (Date.now() - 60_000) / 1000;
  utimesSync(server, old, old);
  const created = await dispatch(command('draft.create', create), 'draft.create');
  assert.equal(created.status, 200, await created.clone().text());
  assert.notEqual(JSON.parse(readFileSync(server, 'utf8')).nonce, 'theirs');
  assert.deepEqual(owner.writes(), { state: 'open' });
});

test("owner opens the store at the data directory's real path, whatever spelling PORTFOLIO_DATA_DIR uses", (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'store-handlers-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const linked = `${dataDir}-link`;
  symlinkSync(dataDir, linked);
  t.after(() => rmSync(linked, { force: true }));
  const owner = ownerStore({
    config: configFor(path.join(linked, '.', '')),
    checks: CHECKS,
    setServable: () => {},
  });
  assert.equal(owner.store.paths.root, realpathSync(dataDir));
});

test("owner starts degraded, never stopped, over a live manifest a reader can't walk or a log it can't list", async (t) => {
  deploy(t);
  t.mock.method(console, 'log', () => {});
  for (const spoil of ['rendering', 'log'] as const) {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'store-handlers-'));
    t.after(() => rmSync(dataDir, { recursive: true, force: true }));
    const owner = ownerStore({
      config: configFor(dataDir),
      checks: CHECKS,
      setServable: () => {},
      // Walks every field, as apps/web's renderDrift does.
      renderDrift: (rendering) => [
        ...rendering.packs.map((pack) => ({
          kind: 'pack' as const,
          id: pack.id,
          revision: pack.version,
          build: null,
        })),
        ...Object.keys(rendering.contracts).map((id) => ({
          kind: 'contract' as const,
          id,
          revision: rendering.contracts[id]!,
          build: null,
        })),
      ],
    });
    t.after(() => owner.release());
    assert.deepEqual(await owner.checkDirectory(), []);
    const ids: string[] = [];
    for (const name of ['Rowan One', 'Rowan Two']) {
      const working = await owner.store.drafts.getWorking();
      const created = await owner.store.drafts.create(
        { documents: documents(name), ...(working ? { expectedVersion: working.version } : {}) },
        'owner',
      );
      assert.ok(created.kind === 'saved');
      const published = await owner.store.publication.publish(
        {
          draftId: created.draft.draftId,
          draftVersion: created.draft.version,
          expectedLiveRevisionId: (ids.at(-1) ?? null) as never,
        },
        'operator',
      );
      assert.ok(published.kind === 'committed');
      ids.push(published.revisionId);
    }
    if (spoil === 'rendering') {
      // The live manifest's rendering lacks its contracts.
      const file = path.join(dataDir, 'revisions', ids[1]!, 'manifest.json');
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      delete manifest.rendering.contracts;
      writeFileSync(file, JSON.stringify(manifest));
    } else {
      // The live revision damaged, and the log, which the last known good's walk reads, unlistable.
      writeFileSync(
        path.join(dataDir, 'revisions', ids[1]!, 'documents', 'portfolio.yml'),
        'x: 1\n',
      );
      chmodSync(path.join(dataDir, 'publication', 'events'), 0o000);
      t.after(() => {
        if (existsSync(dataDir)) chmodSync(path.join(dataDir, 'publication', 'events'), 0o700);
      });
    }
    const issues = await owner.checkIntegrity();
    assert.deepEqual(
      issues.map((issue) => issue.code),
      // Repair lists the log too, so with it unlistable repair fails as well.
      spoil === 'rendering' ? ['revision_damaged'] : ['store_repair_failed', 'revision_unservable'],
      spoil,
    );
    if (spoil === 'log') chmodSync(path.join(dataDir, 'publication', 'events'), 0o700);
  }
});
