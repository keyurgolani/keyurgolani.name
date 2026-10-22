import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PORTFOLIO_SCHEMA_VERSION } from '@portfolio/schema';
import { memoryAuditSink } from '../audit/sink';
import type { SessionHold } from '../auth/sessions';
import { onStoreEvent, type StoreError, type StoreEvent, type StoreLogEntry } from './common';
import { nodeFs, type FsPort } from './fs-port';
import { newRevisionId, type RevisionId } from './layout';
import { readEvents, readLive } from './pointer';
import { IDEMPOTENCY_WINDOW, type HeldMove } from './publication';
import { manifestFor, readManifest, readRevision, writeRevision } from './revisions';
import { openStore, type Store } from './store';
import { checkUnit, sha256 } from './unit';
import {
  commentedVariant,
  contentVariant,
  filesUnder,
  invalidInput,
  mediaDocument,
  newStore,
  owned,
  ownerSession,
  pairInput,
  publishInput,
  testChecks,
} from './test-support/fixtures';

async function draftOf(store: Store, input = pairInput('engineering')) {
  const working = await store.drafts.getWorking();
  const created = await store.drafts.create(
    { documents: input, ...(working ? { expectedVersion: working.version } : {}) },
    'owner',
  );
  assert.equal(created.kind, 'saved');
  return created.kind === 'saved' ? created.draft : assert.fail();
}

test('a publish writes one complete revision, moves the pointer, records the event, and closes the draft', async (t) => {
  const audit = memoryAuditSink();
  const logs: StoreLogEntry[] = [];
  const store = await newStore(t, { audit, log: (entry) => logs.push(entry) });
  const events: StoreEvent[] = [];
  t.after(onStoreEvent((event) => events.push(event)));
  const draft = await draftOf(store);
  assert.equal(draft.baseRevisionId, null);

  const outcome = await owned(store).publish(
    {
      draftId: draft.draftId,
      draftVersion: draft.version,
      expectedLiveRevisionId: null,
      idempotencyKey: 'first-publish',
    },
    'owner',
    { requestId: 'req-1' },
  );
  assert.equal(outcome.kind, 'committed');
  if (outcome.kind !== 'committed') return;
  assert.equal(outcome.seq, 1);

  const live = await readLive(nodeFs, store.paths);
  assert.equal(live?.revisionId, outcome.revisionId);
  assert.equal(live?.event.type, 'publish');
  const manifest = await readManifest(nodeFs, store.paths, outcome.revisionId);
  assert.ok(manifest);
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.parentRevisionId, null);
  assert.equal(manifest.createdBy, 'owner');
  assert.ok(!Number.isNaN(Date.parse(manifest.createdAt)));
  assert.deepEqual(manifest.source, { kind: 'draft', draftId: draft.draftId, draftVersion: 1 });
  assert.equal(manifest.appVersion, '0.0.0-test');
  assert.equal(manifest.documents.portfolio.schemaVersion, PORTFOLIO_SCHEMA_VERSION);
  assert.equal(manifest.documents.portfolio.format, 'yaml');
  assert.equal(manifest.documents.portfolio.file, 'portfolio.yml');
  assert.equal(
    manifest.documents.portfolio.sourceHash,
    sha256(pairInput('engineering').portfolio.sourceText),
  );
  assert.equal(manifest.unitHash, live?.unitHash);
  assert.deepEqual(manifest.rendering.variant, { id: 'missing-variant', version: '1.0.0' });
  assert.deepEqual(Object.keys(manifest.snapshots), ['controls']);
  assert.deepEqual(manifest.blobs, []);
  assert.deepEqual(filesUnder(store.paths.revision(outcome.revisionId)), [
    'documents/portfolio.model.json',
    'documents/portfolio.yml',
    'documents/site.model.json',
    'documents/site.yml',
    'manifest.json',
    'snapshots/controls.json',
  ]);
  // The text as written, comments and all.
  assert.equal(
    readFileSync(
      path.join(store.paths.revision(outcome.revisionId), 'documents/portfolio.yml'),
      'utf8',
    ),
    pairInput('engineering').portfolio.sourceText,
  );

  const [event] = await readEvents(nodeFs, store.paths);
  assert.deepEqual(
    { ...event, at: undefined },
    {
      seq: 1,
      type: 'publish',
      revisionId: outcome.revisionId,
      previousRevisionId: null,
      actor: 'owner',
      at: undefined,
      idempotencyKey: 'first-publish',
    },
  );
  assert.equal(await store.drafts.getWorking(), null);
  assert.deepEqual(
    audit.records.map((record) => [record.type, record.actor, record.outcome, record.refs]),
    [
      [
        'published',
        'owner',
        'success',
        { seq: 1, revisionId: outcome.revisionId, requestId: 'req-1' },
      ],
    ],
  );
  assert.ok(
    events.some(
      (e) => e.name === 'published' && e.revisionId === outcome.revisionId && e.seq === 1,
    ),
  );
  const committed = logs.find((entry) => entry.event === 'store.publish.committed');
  assert.equal(committed?.revisionId, outcome.revisionId);
  assert.equal(committed?.seq, 1);
  assert.equal(typeof committed?.durationMs, 'number');
  assert.equal((await store.publication.status()).state, 'live');
});

test('a draft that does not validate saves with its diagnostics but fails to publish with validation_failed, and nothing moves', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const before = filesUnder(store.paths.root).filter((file) => !file.startsWith('drafts/'));
  const created = await store.drafts.create(
    { documents: invalidInput('id.duplicate'), expectedVersion: undefined },
    'owner',
  );
  assert.equal(created.kind, 'saved');
  if (created.kind !== 'saved') return;
  const found = Object.values(created.draft.documents).flatMap((document) => document.diagnostics);
  assert.ok(found.some((diagnostic) => diagnostic.code === 'id.duplicate'));

  const outcome = await owned(store).publish(
    {
      draftId: created.draft.draftId,
      draftVersion: created.draft.version,
      expectedLiveRevisionId: first,
    },
    'owner',
  );
  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.kind === 'rejected' && outcome.code, 'validation_failed');
  assert.ok(
    outcome.kind === 'rejected' &&
      outcome.diagnostics.some((diagnostic) => diagnostic.code === 'id.duplicate'),
  );
  assert.deepEqual(
    filesUnder(store.paths.root).filter((file) => !file.startsWith('drafts/')),
    before,
  );
  assert.equal((await readLive(nodeFs, store.paths))?.revisionId, first);
  assert.ok(await store.drafts.get(created.draft.draftId));
});

test('nothing_to_publish when every document and the unitHash match live; a comment alone is something', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const same = await draftOf(store);
  assert.equal(same.baseRevisionId, first);
  const outcome = await owned(store).publish(
    { draftId: same.draftId, draftVersion: same.version, expectedLiveRevisionId: first },
    'owner',
  );
  assert.equal(outcome.kind === 'rejected' && outcome.code, 'nothing_to_publish');

  const commented = await store.drafts.save(
    {
      draftId: same.draftId,
      expectedVersion: same.version,
      documents: commentedVariant(pairInput('engineering'), 'a note'),
    },
    'owner',
  );
  assert.equal(commented.kind, 'saved');
  const next = await owned(store).publish(
    { draftId: same.draftId, draftVersion: same.version + 1, expectedLiveRevisionId: first },
    'owner',
  );
  assert.equal(next.kind, 'committed');
  if (next.kind !== 'committed') return;
  const [a, b] = await Promise.all([
    readManifest(nodeFs, store.paths, first),
    readManifest(nodeFs, store.paths, next.revisionId),
  ]);
  assert.equal(a?.unitHash, b?.unitHash);
  assert.notEqual(a?.documents.portfolio.sourceHash, b?.documents.portfolio.sourceHash);
  assert.equal(b?.parentRevisionId, first);
});

test('a stale expectation or a draft whose base is no longer live returns live_conflict with the hashes', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const draft = await draftOf(store, contentVariant(pairInput('engineering'), 'draft'));
  // Another tab publishes meanwhile.
  const second = await owned(store).publish(
    { draftId: draft.draftId, draftVersion: draft.version, expectedLiveRevisionId: first },
    'owner',
  );
  assert.equal(second.kind, 'committed');
  const stale = await draftOf(store, contentVariant(pairInput('engineering'), 'stale'));
  const conflict = await owned(store).publish(
    { draftId: stale.draftId, draftVersion: stale.version, expectedLiveRevisionId: first },
    'owner',
  );
  assert.equal(conflict.kind, 'conflict');
  if (conflict.kind !== 'conflict' || conflict.code !== 'live_conflict') return assert.fail();
  const live = await readLive(nodeFs, store.paths);
  assert.equal(conflict.liveRevisionId, live?.revisionId);
  assert.equal(conflict.liveHash, live?.unitHash);
  assert.equal(
    conflict.baseHash,
    (await readManifest(nodeFs, store.paths, stale.baseRevisionId!))?.unitHash,
  );
  const expectedDraftHash = checkUnit(
    contentVariant(pairInput('engineering'), 'stale'),
    testChecks(),
  );
  assert.equal(conflict.draftHash, expectedDraftHash.ok ? expectedDraftHash.unit.unitHash : null);
});

test('a stale draftVersion returns draft_conflict with the current version and documents', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const draft = await draftOf(store, contentVariant(pairInput('engineering'), 'one'));
  const saved = await store.drafts.save(
    {
      draftId: draft.draftId,
      expectedVersion: draft.version,
      documents: contentVariant(pairInput('engineering'), 'two'),
    },
    'owner',
  );
  assert.equal(saved.kind, 'saved');
  const outcome = await owned(store).publish(
    { draftId: draft.draftId, draftVersion: draft.version, expectedLiveRevisionId: first },
    'owner',
  );
  assert.equal(outcome.kind, 'conflict');
  if (outcome.kind !== 'conflict' || outcome.code !== 'draft_conflict') return assert.fail();
  assert.equal(outcome.version, draft.version + 1);
  assert.match(outcome.documents.portfolio.sourceText, /version two/);
  assert.equal((await readLive(nodeFs, store.paths))?.revisionId, first);
});

test('a repeated idempotency key returns the original outcome, within the last 100 events', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const draft = await draftOf(store, contentVariant(pairInput('engineering'), 'two'));
  const input = {
    draftId: draft.draftId,
    draftVersion: draft.version,
    expectedLiveRevisionId: first,
    idempotencyKey: 'publish-two',
  };
  const outcome = await owned(store).publish(input, 'owner');
  assert.equal(outcome.kind, 'committed');
  // The retry finds its draft gone and live moved, and still gets what it got.
  assert.deepEqual(await owned(store).publish(input, 'owner'), outcome);
  const rollback = {
    targetRevisionId: first,
    expectedLiveRevisionId: outcome.kind === 'committed' ? outcome.revisionId : first,
    idempotencyKey: 'back-1',
  };
  const rolled = await owned(store).rollback(rollback, 'owner');
  assert.equal(rolled.kind, 'committed');
  assert.deepEqual(await owned(store).rollback(rollback, 'owner'), rolled);
  // With another event since, the retry still finds its own, further back.
  assert.deepEqual(await owned(store).publish(input, 'owner'), outcome);
  assert.equal((await readEvents(nodeFs, store.paths)).length, 3);
  assert.throws(
    () => store.publication.rollback({ ...rollback, idempotencyKey: 'not a key' }, 'operator'),
    /Not an idempotency key/,
  );

  // Past the window, a key is new again: live.get answers what happened.
  let live = rolled.kind === 'committed' ? rolled.revisionId : first;
  const second = outcome.kind === 'committed' ? outcome.revisionId : first;
  for (let index = 0; index < IDEMPOTENCY_WINDOW; index++) {
    const target = live === first ? second : first;
    const moved = await owned(store).rollback(
      { targetRevisionId: target, expectedLiveRevisionId: live },
      'owner',
    );
    assert.equal(moved.kind, 'committed');
    live = target;
  }
  const late = await owned(store).publish(input, 'owner');
  assert.equal(late.kind === 'rejected' && late.code, 'not_found');
});

test("a key on another request's event is idempotency_conflict, and nothing moves", async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const draft = await draftOf(store, contentVariant(pairInput('engineering'), 'two'));
  const published = await owned(store).publish(
    {
      draftId: draft.draftId,
      draftVersion: draft.version,
      expectedLiveRevisionId: first,
      idempotencyKey: 'publish-1',
    },
    'owner',
  );
  const second = published.kind === 'committed' ? published.revisionId : assert.fail();
  const rolled = await owned(store).rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second, idempotencyKey: 'rollback-1' },
    'owner',
  );
  assert.equal(rolled.kind, 'committed');
  const next = await draftOf(store, contentVariant(pairInput('engineering'), 'three'));
  const live = readFileSync(store.paths.live, 'utf8');
  const revisions = await nodeFs.readdir(store.paths.revisions);
  const publishNext = { draftId: next.draftId, draftVersion: next.version };
  const others = {
    "a publish with a rollback's key": () =>
      owned(store).publish(
        { ...publishNext, expectedLiveRevisionId: first, idempotencyKey: 'rollback-1' },
        'owner',
      ),
    'a publish of another draft': () =>
      owned(store).publish(
        { ...publishNext, expectedLiveRevisionId: first, idempotencyKey: 'publish-1' },
        'owner',
      ),
    'a rollback to another target': () =>
      owned(store).rollback(
        { targetRevisionId: second, expectedLiveRevisionId: first, idempotencyKey: 'rollback-1' },
        'owner',
      ),
    'a rollback from another revision': () =>
      owned(store).rollback(
        { targetRevisionId: first, expectedLiveRevisionId: first, idempotencyKey: 'rollback-1' },
        'owner',
      ),
    "a recover with a rollback's key": () =>
      owned(store).recover(
        { expectedLiveRevisionId: first, idempotencyKey: 'rollback-1' },
        'owner',
      ),
    "a rollback with a publish's key": () =>
      owned(store).rollback(
        { targetRevisionId: second, expectedLiveRevisionId: first, idempotencyKey: 'publish-1' },
        'operator',
      ),
  };
  for (const [what, request] of Object.entries(others)) {
    const outcome = await request();
    assert.equal(outcome.kind === 'rejected' && outcome.code, 'idempotency_conflict', what);
  }
  // Nothing moved, nothing was written, and the draft is still there.
  assert.equal(readFileSync(store.paths.live, 'utf8'), live);
  assert.equal((await readEvents(nodeFs, store.paths)).length, 3);
  assert.deepEqual(await nodeFs.readdir(store.paths.revisions), revisions);
  assert.equal((await store.drafts.getWorking())?.version, next.version);
  // The same request with a key of its own commits.
  const own = await owned(store).publish(
    { ...publishNext, expectedLiveRevisionId: first, idempotencyKey: 'publish-2' },
    'owner',
  );
  assert.equal(own.kind, 'committed');
});

test('rollback moves the pointer to an existing revision through the same commit point, keeps the replaced one, and leaves every draft unchanged', async (t) => {
  const audit = memoryAuditSink();
  const store = await newStore(t, { audit });
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const draft = await draftOf(store, contentVariant(pairInput('engineering'), 'three'));
  const draftFile = readFileSync(store.paths.draft(draft.draftId));
  const revisionsBefore = filesUnder(store.paths.revisions);

  const outcome = await owned(store).rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second, reason: 'Back to the first' },
    'owner',
  );
  assert.equal(outcome.kind, 'committed');
  if (outcome.kind !== 'committed') return;
  assert.deepEqual(outcome, { kind: 'committed', revisionId: first, seq: 3 });
  const live = await readLive(nodeFs, store.paths);
  assert.equal(live?.revisionId, first);
  assert.equal(live?.unitHash, (await readManifest(nodeFs, store.paths, first))?.unitHash);
  const events = await readEvents(nodeFs, store.paths);
  assert.deepEqual(
    events.map((event) => [event.seq, event.type, event.revisionId, event.previousRevisionId]),
    [
      [1, 'publish', first, null],
      [2, 'publish', second, first],
      [3, 'rollback', first, second],
    ],
  );
  assert.equal(events[2]?.reason, 'Back to the first');
  // No revision was copied or changed, and the draft is byte for byte the same.
  assert.deepEqual(filesUnder(store.paths.revisions), revisionsBefore);
  assert.deepEqual(readFileSync(store.paths.draft(draft.draftId)), draftFile);
  assert.equal(audit.records.at(-1)?.type, 'rolled_back');

  // The draft's base isn't live any more, so publishing it is a conflict until it's rebased.
  const publish = await owned(store).publish(
    { draftId: draft.draftId, draftVersion: draft.version, expectedLiveRevisionId: first },
    'owner',
  );
  assert.equal(publish.kind === 'conflict' && publish.code, 'live_conflict');
  const rebased = await store.drafts.rebase(
    {
      draftId: draft.draftId,
      expectedVersion: draft.version,
      documents: contentVariant(pairInput('engineering'), 'three'),
      baseRevisionId: first,
    },
    'owner',
  );
  assert.equal(rebased.kind, 'saved');
  const republish = await owned(store).publish(
    { draftId: draft.draftId, draftVersion: draft.version + 1, expectedLiveRevisionId: first },
    'owner',
  );
  assert.equal(republish.kind, 'committed');
});

test('rollback checks the live revision, its target, and refuses one that is gone, damaged, live, or incompatible', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));

  const stale = await owned(store).rollback(
    { targetRevisionId: first, expectedLiveRevisionId: first },
    'owner',
  );
  assert.equal(stale.kind === 'conflict' && stale.code, 'live_conflict');
  if (stale.kind === 'conflict' && stale.code === 'live_conflict') {
    assert.equal(stale.liveRevisionId, second);
    assert.equal('draftHash' in stale, false);
  }
  const missing = await owned(store).rollback(
    { targetRevisionId: newRevisionId(), expectedLiveRevisionId: second },
    'owner',
  );
  assert.equal(missing.kind === 'rejected' && missing.code, 'not_found');
  const same = await owned(store).rollback(
    { targetRevisionId: second, expectedLiveRevisionId: second },
    'owner',
  );
  assert.equal(same.kind === 'rejected' && same.code, 'nothing_to_publish');

  // A revision from an older schema, written by a build that took it: one the
  // migration reads (#10), and one no step does. Neither is damage.
  for (const [version, code] of [
    [PORTFOLIO_SCHEMA_VERSION - 1, 'schema.outdated'],
    [1, 'schema.version'],
  ] as const) {
    const old = await writeOlderSchemaRevision(store, version);
    const incompatible = await owned(store).rollback(
      { targetRevisionId: old, expectedLiveRevisionId: second },
      'owner',
    );
    assert.equal(incompatible.kind, 'rejected', code);
    if (incompatible.kind !== 'rejected') return;
    assert.equal(incompatible.code, 'revision_incompatible');
    assert.equal(incompatible.reason, code);
    assert.equal(incompatible.command, `rollback --to ${old}`);
    assert.ok(incompatible.diagnostics.some((diagnostic) => diagnostic.code === code));
  }

  // A damaged one: a document's bytes no longer match its hash.
  writeFileSync(
    path.join(store.paths.revision(first), 'documents/portfolio.yml'),
    'changed: true\n',
  );
  const damaged = await owned(store).rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second },
    'owner',
  );
  assert.equal(damaged.kind === 'rejected' && damaged.code, 'revision_incompatible');
  assert.equal(damaged.kind === 'rejected' && damaged.reason, 'damaged:hash_mismatch');
  assert.equal((await readLive(nodeFs, store.paths))?.revisionId, second);
});

test('a revision whose manifest names another unitHash is damaged, though each document matches its own', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const file = path.join(store.paths.revision(first), 'manifest.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...manifest, unitHash: sha256('another unit') }));
  assert.deepEqual(await readRevision(nodeFs, store.paths, first), {
    ok: false,
    damage: 'hash_mismatch',
  });
  const damaged = await owned(store).rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second },
    'owner',
  );
  assert.equal(damaged.kind === 'rejected' && damaged.reason, 'damaged:hash_mismatch');
  assert.equal((await readLive(nodeFs, store.paths))?.revisionId, second);
});

/** Writes a revision whose portfolio is schema version 1, as an older build would have. */
async function writeOlderSchemaRevision(store: Store, version: number): Promise<RevisionId> {
  const input = pairInput('engineering');
  const current = `schemaVersion: ${PORTFOLIO_SCHEMA_VERSION}`;
  const older = {
    ...input,
    portfolio: {
      ...input.portfolio,
      sourceText: input.portfolio.sourceText.replace(current, `schemaVersion: ${version}`),
    },
  };
  // The older build's validator took it.
  const lenient = testChecks({
    validate: (pair) => {
      const result = testChecks().validate({
        ...pair,
        portfolio: {
          ...pair.portfolio,
          text: pair.portfolio.text.replace(`schemaVersion: ${version}`, current),
        },
      });
      return result;
    },
  });
  const checked = checkUnit(older, lenient);
  assert.ok(checked.ok);
  const revisionId = newRevisionId();
  const manifest = manifestFor(
    checked.unit,
    {
      revisionId,
      parentRevisionId: null,
      createdAt: new Date().toISOString(),
      createdBy: 'operator',
      source: { kind: 'import', sourceHash: sha256('older') },
    },
    lenient,
    checked.rendering,
  );
  await store.lock.withLock('test', () =>
    writeRevision(nodeFs, store.paths, { manifest, unit: checked.unit }, 'test'),
  );
  return revisionId;
}

test('a damaged live revision is served as the last known good in state degraded, recover moves the pointer there, and the pointer is never rewritten before that', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  rmSync(path.join(store.paths.revision(second), 'snapshots/controls.json'));
  const pointer = readFileSync(store.paths.live);

  const status = await store.publication.status();
  assert.deepEqual(
    { ...status },
    {
      state: 'degraded',
      liveRevisionId: second,
      servingRevisionId: first,
      seq: 2,
      unitHash: (await readLive(nodeFs, store.paths))?.unitHash,
      reason: 'damaged:missing',
    },
  );
  assert.deepEqual(readFileSync(store.paths.live), pointer);
  assert.equal(await store.publication.lastKnownGood(), first);

  const recovered = await owned(store).recover(
    { expectedLiveRevisionId: second, reason: 'The live revision lost a file' },
    'operator',
  );
  assert.deepEqual(recovered, { kind: 'committed', revisionId: first, seq: 3 });
  const [, , event] = await readEvents(nodeFs, store.paths);
  assert.equal(event?.type, 'recover');
  assert.equal(event?.actor, 'operator');
  assert.equal((await store.publication.status()).state, 'live');
  const again = await owned(store).recover({ expectedLiveRevisionId: first }, 'operator');
  assert.equal(again.kind === 'rejected' && again.code, 'nothing_to_publish');
});

test('with no servable revision the state is incompatible, and before the first one it is empty', async (t) => {
  const store = await newStore(t);
  assert.deepEqual(
    { ...(await store.publication.status()) },
    { state: 'empty', liveRevisionId: null, servingRevisionId: null, seq: null, unitHash: null },
  );
  const first = await publishInput(store, pairInput('engineering'));
  writeFileSync(path.join(store.paths.revision(first), 'manifest.json'), '{');
  const status = await store.publication.status();
  assert.equal(status.state, 'incompatible');
  assert.equal(status.servingRevisionId, null);
  assert.equal(status.reason, 'damaged:parse_failure');
  const recover = await owned(store).recover({ expectedLiveRevisionId: first }, 'operator');
  assert.equal(recover.kind === 'rejected' && recover.code, 'not_found');
});

test('history, the revision list, and a revision read back what happened, in seq order', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  await owned(store).rollback({ targetRevisionId: first, expectedLiveRevisionId: second }, 'owner');
  const history = await store.publication.history();
  assert.deepEqual(
    history.map((event) => event.seq),
    [1, 2, 3],
  );
  const list = await store.publication.revisions();
  assert.deepEqual(
    list.map(({ revisionId, seq, compatible, createdBy }) => ({
      revisionId,
      seq,
      compatible,
      createdBy,
    })),
    [
      { revisionId: first, seq: 3, compatible: true, createdBy: 'owner' },
      { revisionId: second, seq: 2, compatible: true, createdBy: 'owner' },
    ],
  );
  const detail = await store.publication.revision(second);
  assert.equal(detail?.manifest.revisionId, second);
  assert.match(detail?.documents.portfolio?.sourceText ?? '', /version two/);
  assert.equal(
    (detail?.documents.portfolio?.model as { meta?: { description?: string } }).meta?.description,
    'A portfolio, version two.',
  );
  assert.equal(await store.publication.revision('rev_nope' as RevisionId), null);
});

test('a publish whose media references a blob the AssetStore lacks fails with asset_missing, and one it holds goes live with the blob in the manifest', async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const stored = await store.assets.put(Buffer.from('a picture'), 'image/png');
  const absent = sha256('not stored');
  // The draft itself refuses a reference to a missing blob, so a blob that
  // goes missing after the save is the case left for publish.
  const draft = await draftOf(store, {
    ...pairInput('engineering'),
    media: mediaDocument([stored.sha256]),
  });
  rmSync(store.paths.blob(stored.sha256));
  const live = (await store.publication.status()).liveRevisionId;
  const missing = await owned(store).publish(
    { draftId: draft.draftId, draftVersion: draft.version, expectedLiveRevisionId: live },
    'owner',
  );
  assert.equal(missing.kind === 'rejected' && missing.code, 'asset_missing');
  assert.deepEqual(missing.kind === 'rejected' && missing.blobs, [stored.sha256]);

  await store.assets.put(Buffer.from('a picture'), 'image/png');
  const published = await owned(store).publish(
    { draftId: draft.draftId, draftVersion: draft.version, expectedLiveRevisionId: live },
    'owner',
  );
  assert.equal(published.kind, 'committed');
  if (published.kind !== 'committed') return;
  const manifest = await readManifest(nodeFs, store.paths, published.revisionId);
  assert.deepEqual(manifest?.blobs, [stored.sha256]);
  assert.ok(manifest?.documents.media);
  assert.notEqual(absent, stored.sha256);
});

test('startup repair deletes staging directories, writes a missing event file from live.json, and deletes the draft the live revision came from', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const draft = await draftOf(store, contentVariant(pairInput('engineering'), 'two'));
  const draftText = readFileSync(store.paths.draft(draft.draftId), 'utf8');
  const outcome = await owned(store).publish(
    { draftId: draft.draftId, draftVersion: draft.version, expectedLiveRevisionId: first },
    'owner',
  );
  assert.equal(outcome.kind, 'committed');
  // As a crash after the commit would leave it: no event file, the draft still there,
  // and another publish's staging directory.
  rmSync(store.paths.event(2));
  writeFileSync(store.paths.draft(draft.draftId), draftText);
  const staging = store.paths.staging(newRevisionId());
  await nodeFs.mkdir(path.join(staging, 'documents'), 'test');

  const report = await store.publication.repair();
  assert.deepEqual(report, {
    stagingRemoved: 1,
    tempsRemoved: 0,
    eventWritten: true,
    eventsAside: 0,
    draftRemoved: true,
  });
  assert.equal((await readEvents(nodeFs, store.paths)).length, 2);
  assert.equal(await store.drafts.getWorking(), null);
  assert.deepEqual(await store.publication.repair(), {
    stagingRemoved: 0,
    tempsRemoved: 0,
    eventWritten: false,
    eventsAside: 0,
    draftRemoved: false,
  });
});

test('a reopened store reads the same state', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const reopened = openStore({ dataDir: store.paths.root, checks: testChecks() });
  assert.equal((await reopened.publication.status()).liveRevisionId, first);
  assert.equal((await reopened.publication.history()).length, 1);
});

test('a publish whose session ends before the pointer moves leaves the live revision unchanged', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const draft = await draftOf(store, contentVariant(pairInput('engineering'), 'two'));
  const input = {
    draftId: draft.draftId,
    draftVersion: draft.version,
    expectedLiveRevisionId: first,
  };
  const unchanged = async (what: string) => {
    assert.equal((await readLive(nodeFs, store.paths))?.revisionId, first, what);
    assert.equal((await store.drafts.getWorking())?.version, draft.version, what);
    // The revision written for the move never went live, so it's gone again.
    assert.deepEqual(await nodeFs.readdir(store.paths.revisions), [first], what);
  };

  // Ended before the publish began.
  const before = await ownerSession();
  assert.ok(await before.sessions.end(before.digest, 'logout'));
  const refused = await store.publication.publish(input, 'owner', {
    holdSession: before.holdSession,
  });
  assert.equal(refused.kind === 'rejected' && refused.code, 'session_ended');
  await unchanged('ended before');

  // Ended while the publish validated and staged its revision, before the move.
  const during = await ownerSession();
  const ending: FsPort = {
    ...nodeFs,
    async writeFile(file, data, point, options) {
      if (point === 'publish.staging.manifest.write') {
        await during.sessions.end(during.digest, 'logout');
      }
      return nodeFs.writeFile(file, data, point, options);
    },
  };
  const midway = openStore({ dataDir: store.paths.root, checks: testChecks(), fs: ending });
  const stopped = await midway.publication.publish(input, 'owner', {
    holdSession: during.holdSession,
  });
  assert.equal(stopped.kind === 'rejected' && stopped.code, 'session_ended');
  await unchanged('ended midway');

  // No way to hold the session, or a move that runs without the hold.
  await assert.rejects(async () => store.publication.publish(input, 'owner'), TypeError);
  await assert.rejects(
    async () =>
      store.publication.publish(input, 'owner', {
        holdSession: async (move) => ({
          ok: true,
          value: await move({ sessionRef: '00000000' } as never),
        }),
      }),
    /isn't held through the pointer move/,
  );
  await unchanged('no hold');

  // A logout that comes while the pointer moves waits for the move, so the
  // move is the session's last act.
  const held = await ownerSession();
  const order: string[] = [];
  let logout: Promise<boolean> | undefined;
  const watching: FsPort = {
    ...nodeFs,
    async rename(from, to, point) {
      if (point === 'publish.live.rename') {
        logout = held.sessions.end(held.digest, 'logout').then((existed) => {
          order.push('logout');
          return existed;
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await nodeFs.rename(from, to, point);
      if (point === 'publish.live.rename') order.push('moved');
    },
  };
  const watched = openStore({ dataDir: store.paths.root, checks: testChecks(), fs: watching });
  const committed = await watched.publication.publish(input, 'owner', {
    holdSession: held.holdSession,
  });
  assert.equal(committed.kind, 'committed');
  assert.equal(await logout, true);
  assert.deepEqual(order, ['moved', 'logout']);
  assert.notEqual((await readLive(nodeFs, store.paths))?.revisionId, first);
});

test("the owner's rollback and recover hold the session for the move too, and the operator's CLI needs none", async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  await assert.rejects(
    async () =>
      store.publication.rollback(
        { targetRevisionId: first, expectedLiveRevisionId: second },
        'owner',
      ),
    TypeError,
  );
  await assert.rejects(
    async () =>
      store.publication.recover(
        { targetRevisionId: first, expectedLiveRevisionId: second },
        'owner',
      ),
    TypeError,
  );
  const ended = await ownerSession();
  await ended.sessions.end(ended.digest, 'logout');
  const refused = await store.publication.rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second },
    'owner',
    { holdSession: ended.holdSession },
  );
  assert.equal(refused.kind === 'rejected' && refused.code, 'session_ended');
  const refusedRecover = await store.publication.recover(
    { targetRevisionId: first, expectedLiveRevisionId: second },
    'owner',
    { holdSession: ended.holdSession },
  );
  assert.equal(refusedRecover.kind === 'rejected' && refusedRecover.code, 'session_ended');
  assert.equal((await readLive(nodeFs, store.paths))?.revisionId, second);
  assert.equal((await readEvents(nodeFs, store.paths)).length, 2);
  // Their target is a revision that was live, and stays.
  assert.deepEqual((await nodeFs.readdir(store.paths.revisions)).sort(), [first, second].sort());
  const byOperator = await store.publication.rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second },
    'operator',
  );
  assert.equal(byOperator.kind, 'committed');
  const [, , event] = await readEvents(nodeFs, store.paths);
  assert.equal(event?.actor, 'operator');
});

test("what the pointer move did decides the outcome, not holdSession()'s answer", async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const draft = await draftOf(store, contentVariant(pairInput('engineering'), 'three'));
  const input = {
    draftId: draft.draftId,
    draftVersion: draft.version,
    expectedLiveRevisionId: second,
  };
  const live = readFileSync(store.paths.live, 'utf8');
  const revisions = (await nodeFs.readdir(store.paths.revisions)).sort();
  const unchanged = async (what: string) => {
    assert.equal(readFileSync(store.paths.live, 'utf8'), live, what);
    assert.deepEqual(
      (await readEvents(nodeFs, store.paths)).map((event) => event.seq),
      [1, 2],
      what,
    );
    assert.equal((await store.drafts.getWorking())?.version, draft.version, what);
  };

  // An ok for a move that never ran is a wiring error: nothing is written,
  // and the revision a publish wrote for the move is gone again.
  const skipping = async <T>(): Promise<HeldMove<T>> => ({ ok: true, value: undefined as T });
  await assert.rejects(
    async () => store.publication.publish(input, 'owner', { holdSession: skipping }),
    /answered ok without running the pointer move/,
  );
  await unchanged('a publish answered ok');
  assert.deepEqual((await nodeFs.readdir(store.paths.revisions)).sort(), revisions);
  await assert.rejects(
    async () =>
      store.publication.recover(
        { targetRevisionId: first, expectedLiveRevisionId: second },
        'owner',
        { holdSession: skipping },
      ),
    /answered ok without running the pointer move/,
  );
  await unchanged('a recover answered ok');
  // A recover's target was live before, and stays.
  assert.deepEqual((await nodeFs.readdir(store.paths.revisions)).sort(), revisions);

  // A failure in the move stands, even where holdSession() swallows it.
  const session = await ownerSession();
  const swallowing = async <T>(move: (hold: SessionHold) => Promise<T>): Promise<HeldMove<T>> => {
    await session.holdSession(move).catch(() => {});
    return { ok: false };
  };
  const failing = openStore({
    dataDir: store.paths.root,
    checks: testChecks(),
    fs: {
      ...nodeFs,
      async rename(from, to, point) {
        if (point === 'publish.live.rename') throw Object.assign(new Error('EIO'), { code: 'EIO' });
        return nodeFs.rename(from, to, point);
      },
    },
  });
  await assert.rejects(
    async () => failing.publication.publish(input, 'owner', { holdSession: swallowing }),
    (error: unknown) => (error as StoreError).code === 'storage_unavailable',
  );
  await unchanged('a failed move answered not ok');

  // A move that ran is committed, step 5 and all, even when the answer is not ok.
  const late = async <T>(move: (hold: SessionHold) => Promise<T>): Promise<HeldMove<T>> => {
    await session.holdSession(move);
    return { ok: false };
  };
  const committed = await store.publication.publish(input, 'owner', { holdSession: late });
  assert.equal(committed.kind, 'committed');
  assert.deepEqual(
    (await readEvents(nodeFs, store.paths)).map((event) => event.seq),
    [1, 2, 3],
  );
  assert.equal(await store.drafts.getWorking(), null);
});

test("a staged revision that doesn't read back as written never goes live", async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const draft = await draftOf(store, contentVariant(pairInput('engineering'), 'two'));
  // A disk that changes what a staged document holds, once it's written.
  const corrupting: FsPort = {
    ...nodeFs,
    async writeFile(file, data, point, options) {
      await nodeFs.writeFile(file, data, point, options);
      if (point === 'publish.staging.portfolio.write') {
        await nodeFs.writeFile(file, `${String(data)}# changed on disk\n`, point);
      }
    },
  };
  const corrupted = openStore({ dataDir: store.paths.root, checks: testChecks(), fs: corrupting });
  await assert.rejects(
    owned(corrupted).publish(
      { draftId: draft.draftId, draftVersion: draft.version, expectedLiveRevisionId: first },
      'owner',
    ),
    (error: unknown) => (error as { code?: string }).code === 'storage_unavailable',
  );
  assert.equal((await readLive(nodeFs, store.paths))?.revisionId, first);
  assert.deepEqual(await nodeFs.readdir(store.paths.revisions), [first]);
  assert.equal((await store.drafts.getWorking())?.version, draft.version);
});

test("an operation first writes the live event's own file when a failure after the last commit left it out", async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  // As step 5 leaves it when the event write fails after the commit.
  rmSync(store.paths.event(2));
  assert.deepEqual(
    (await readEvents(nodeFs, store.paths)).map((event) => event.seq),
    [1],
  );
  const rolled = await owned(store).rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second },
    'owner',
  );
  assert.deepEqual(rolled, { kind: 'committed', revisionId: first, seq: 3 });
  const events = await readEvents(nodeFs, store.paths);
  assert.deepEqual(
    events.map((event) => [event.seq, event.type, event.revisionId]),
    [
      [1, 'publish', first],
      [2, 'publish', second],
      [3, 'rollback', first],
    ],
  );
});

/** The lock record of another process, as one that broke this one's lock and took it writes. */
const theirLock = () =>
  JSON.stringify({
    pid: 1,
    startTime: 'x',
    hostname: 'another-host',
    holder: 'cli:backup',
    at: new Date().toISOString(),
    nonce: 'theirs',
  });

test('a commit whose lock was broken and retaken moves nothing and answers lock_lost, and a retry commits', async (t) => {
  const logs: StoreLogEntry[] = [];
  const log = (entry: StoreLogEntry) => logs.push(entry);
  const store = await newStore(t, { log });
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const draft = await draftOf(store, contentVariant(pairInput('engineering'), 'three'));
  const live = readFileSync(store.paths.live, 'utf8');
  // Another process takes the lock just as the pointer is about to move.
  const breakingAt = (at: string) =>
    openStore({
      dataDir: store.paths.root,
      checks: testChecks(),
      log,
      fs: {
        ...nodeFs,
        async writeFile(file, data, point, options) {
          if (point === at) writeFileSync(store.paths.lock, theirLock());
          return nodeFs.writeFile(file, data, point, options);
        },
      },
    });
  const publish = {
    draftId: draft.draftId,
    draftVersion: draft.version,
    expectedLiveRevisionId: second,
  };
  const lost = await owned(breakingAt('publish.live.write')).publish(publish, 'owner');
  assert.equal(lost.kind === 'rejected' && lost.code, 'lock_lost');
  assert.equal((await store.lock.holder())?.holder, 'cli:backup');
  assert.ok(await store.lock.forceUnlock());
  const rollback = { targetRevisionId: first, expectedLiveRevisionId: second };
  const lostRollback = await owned(breakingAt('rollback.live.write')).rollback(rollback, 'owner');
  assert.equal(lostRollback.kind === 'rejected' && lostRollback.code, 'lock_lost');
  assert.ok(await store.lock.forceUnlock());
  // Nothing moved, nothing was recorded, and nothing was left behind.
  assert.equal(readFileSync(store.paths.live, 'utf8'), live);
  assert.deepEqual(
    (await readEvents(nodeFs, store.paths)).map((event) => event.seq),
    [1, 2],
  );
  assert.equal((await store.drafts.getWorking())?.version, draft.version);
  assert.deepEqual(
    (await nodeFs.readdir(store.paths.publication)).filter((name) => name.endsWith('.tmp')),
    [],
  );
  assert.equal(
    logs.filter((entry) => entry.level === 'error' && entry.event === 'store.lock.lost').length,
    2,
  );
  // With the lock its own again, the same publish commits.
  assert.equal((await owned(store).publish(publish, 'owner')).kind, 'committed');
});

/** An event that disagrees with live.json's, as a second holder of the lock writes one. */
function anotherEvent(seq: number, revisionId: RevisionId, previousRevisionId: RevisionId) {
  return JSON.stringify({
    seq,
    type: 'rollback',
    revisionId,
    previousRevisionId,
    actor: 'owner',
    at: new Date().toISOString(),
  });
}

const asideIn = async (store: Store) =>
  (await nodeFs.readdir(store.paths.events)).filter((name) => name.includes('.aside-')).sort();

const mismatches = (logs: readonly StoreLogEntry[]) =>
  logs
    .filter((entry) => entry.level === 'error' && entry.event === 'store.event.mismatch')
    .map((entry) => entry.seq);

test('startup repair moves aside event files that disagree with live.json, writes the live one, and the store runs on', async (t) => {
  const logs: StoreLogEntry[] = [];
  const store = await newStore(t, { log: (entry) => logs.push(entry) });
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  // As two holders, or a pointer a power loss took back, leave the log:
  // events/2.json holds the other event, and one is above the live seq.
  writeFileSync(store.paths.event(2), anotherEvent(2, first, second));
  writeFileSync(store.paths.event(3), anotherEvent(3, second, first));

  const report = await store.publication.repair();
  assert.equal(report.eventWritten, true);
  assert.equal(report.eventsAside, 2);
  assert.deepEqual(
    (await readEvents(nodeFs, store.paths)).map((event) => [event.seq, event.type]),
    [
      [1, 'publish'],
      [2, 'publish'],
    ],
  );
  // Kept, where the log doesn't read them.
  const aside = await asideIn(store);
  assert.deepEqual(
    aside.map((name) => name.split('.')[0]),
    ['2', '3'],
  );
  assert.deepEqual(mismatches(logs), [2, 3]);
  const rolled = await owned(store).rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second },
    'owner',
  );
  assert.deepEqual(rolled, { kind: 'committed', revisionId: first, seq: 3 });
  assert.equal((await store.publication.repair()).eventsAside, 0);
});

test('an operation moves aside an event file that disagrees with live.json before it runs, and commits', async (t) => {
  const logs: StoreLogEntry[] = [];
  const store = await newStore(t, { log: (entry) => logs.push(entry) });
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  writeFileSync(store.paths.event(2), anotherEvent(2, first, second));
  writeFileSync(store.paths.event(3), anotherEvent(3, second, first));
  const rolled = await owned(store).rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second },
    'owner',
  );
  assert.deepEqual(rolled, { kind: 'committed', revisionId: first, seq: 3 });
  assert.deepEqual(
    (await readEvents(nodeFs, store.paths)).map((event) => [event.seq, event.type]),
    [
      [1, 'publish'],
      [2, 'publish'],
      [3, 'rollback'],
    ],
  );
  assert.equal((await asideIn(store)).length, 2);
  assert.deepEqual(mismatches(logs), [2, 3]);
});

test('a commit whose event file another event took writes its own over it, moving the other aside', async (t) => {
  const logs: StoreLogEntry[] = [];
  const store = await newStore(t, { log: (entry) => logs.push(entry) });
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  // Another event lands at the new seq as the pointer moves, as a second holder's would.
  const intruding: FsPort = {
    ...nodeFs,
    async rename(from, to, point) {
      await nodeFs.rename(from, to, point);
      if (point === 'rollback.live.rename') {
        writeFileSync(store.paths.event(3), anotherEvent(3, second, first));
      }
    },
  };
  const rolling = openStore({
    dataDir: store.paths.root,
    checks: testChecks(),
    fs: intruding,
    log: (entry) => logs.push(entry),
  });
  const rolled = await owned(rolling).rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second },
    'owner',
  );
  assert.deepEqual(rolled, { kind: 'committed', revisionId: first, seq: 3 });
  const live = (await readLive(nodeFs, store.paths))!;
  assert.deepEqual(
    (await readEvents(nodeFs, store.paths)).find((event) => event.seq === 3),
    { ...live.event },
  );
  assert.equal((await asideIn(store)).length, 1);
  assert.deepEqual(mismatches(logs), [3]);
  assert.equal(
    logs.some((entry) => entry.event === 'store.rollback.event_deferred'),
    false,
  );
});
