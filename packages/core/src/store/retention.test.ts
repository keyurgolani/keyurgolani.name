// `retention` (#3, item 26): with no flag it removes no revision, only
// unreferenced blobs older than 24 hours and audit files over 12 months old;
// `--keep` and `--remove` never remove a protected revision (the live one,
// the 10 most recently live, a draft's base); a removed revision leaves its
// tombstone, which verify and the last-known-good walk skip.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readPairBytes } from '@portfolio/schema/node';
import { nodeFs } from './fs-port';
import type { RevisionId, Sha256 } from './layout';
import { LockLostError, type PublicationLock } from './lock';
import { readLive } from './pointer';
import { auditExpired, RECENTLY_LIVE_KEPT, runRetention, type RetentionInput } from './retention';
import { openStore, type Store } from './store';
import { writeTombstone } from './tombstone';
import { importSourceHash, type UnitInput } from '../catalog/unit';
import { verifyStore } from './verify';
import { cli } from './test-support/cli';
import { recordingFs } from './test-support/crash-fs';
import {
  contentVariant,
  mediaDocument,
  newStore,
  pairInput,
  publishInput,
  tempDir,
  testChecks,
} from './test-support/fixtures';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const DAY = 24 * 60 * 60_000;
const readSource = (dir: string) => readPairBytes(dir);

const retention = (store: Store, input: RetentionInput = {}, now = NOW) =>
  runRetention(
    {
      fs: nodeFs,
      paths: store.paths,
      lock: store.lock,
      checks: testChecks(),
      actor: 'operator',
      now: () => now,
    },
    input,
  );

/** Imports `input` as the next live revision, leaving every draft as it is. */
async function imported(store: Store, input: UnitInput): Promise<RevisionId> {
  const live = await readLive(nodeFs, store.paths);
  const outcome = await store.publication.importSource(
    {
      documents: input,
      sourceHash: importSourceHash({
        'portfolio.yml': input.portfolio.sourceText,
        'site.yml': input.site.sourceText,
      }),
      expectedLiveRevisionId: live?.revisionId ?? null,
    },
    'operator',
  );
  assert.equal(outcome.kind, 'committed');
  return outcome.kind === 'committed' ? outcome.revisionId : assert.fail();
}

/** Sets a file's modification time `age` before NOW. */
const aged = (file: string, age: number) => {
  const at = new Date(NOW - age);
  utimesSync(file, at, at);
};

test('with no flag, retention removes no revision, and only blobs nothing references older than 24 hours and audit files over 12 months old', async (t) => {
  const store = await newStore(t);
  const inRevision = await store.assets.put(Buffer.from('a cover'), 'image/jpeg');
  await publishInput(store, {
    ...pairInput('engineering'),
    media: mediaDocument([inRevision.sha256]),
  });
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const inDraft = await store.assets.put(Buffer.from('an upload'), 'image/png');
  const created = await store.drafts.create(
    {
      documents: {
        ...contentVariant(pairInput('engineering'), 'draft'),
        media: mediaDocument([inDraft.sha256]),
      },
      expectedVersion: (await store.drafts.getWorking())?.version,
    },
    'owner',
  );
  assert.equal(created.kind, 'saved');
  const old = await store.assets.put(Buffer.from('nothing uses this'), 'image/png');
  const fresh = await store.assets.put(Buffer.from('nor this, yet'), 'image/png');
  for (const blob of [inRevision, inDraft, old]) aged(store.paths.blob(blob.sha256), 2 * DAY);
  aged(store.paths.blob(fresh.sha256), DAY - 60_000);
  mkdirSync(store.paths.audit, { recursive: true });
  for (const month of ['2025-08', '2025-09', '2025-10', '2026-10']) {
    writeFileSync(path.join(store.paths.audit, `${month}.jsonl`), '{}\n');
  }

  const dry = await retention(store, { dryRun: true });
  assert.equal(dry.kind, 'done');
  const outcome = await retention(store);
  assert.equal(outcome.kind, 'done');
  if (outcome.kind !== 'done' || dry.kind !== 'done') return;
  assert.deepEqual(outcome.report.removedRevisions, []);
  assert.deepEqual(outcome.report.removedBlobs, [old.sha256]);
  assert.deepEqual(outcome.report.removedAudit, ['2025-08.jsonl', '2025-09.jsonl']);
  assert.deepEqual(
    [dry.report.removedBlobs, dry.report.removedAudit],
    [outcome.report.removedBlobs, outcome.report.removedAudit],
    'the dry run names the same',
  );
  for (const blob of [inRevision, inDraft, fresh])
    assert.ok(existsSync(store.paths.blob(blob.sha256)));
  assert.equal(existsSync(store.paths.blob(old.sha256)), false);
  assert.ok(existsSync(path.join(store.paths.audit, '2025-10.jsonl')));
  assert.equal((await store.revisions.list()).length, 2);
});

test('an audit file goes once its last day is more than 12 months old', () => {
  const now = Date.parse('2026-10-21T00:00:00.000Z');
  assert.equal(auditExpired('2025-09.jsonl', now), true);
  assert.equal(auditExpired('2025-10.jsonl', now), false);
  assert.equal(auditExpired('2026-10.jsonl', now), false);
  assert.equal(auditExpired('2025-10.jsonl', Date.parse('2026-11-01T00:00:00.000Z')), true);
  assert.equal(auditExpired('notes.txt', now), false);
});

/** R1 and R2 published, a working draft on R2, then R3 to R14 imported: R14 is live. */
async function history(t: Parameters<typeof newStore>[0]) {
  const store = await newStore(t);
  const ids: RevisionId[] = [];
  ids.push(await publishInput(store, contentVariant(pairInput('engineering'), 'r1')));
  ids.push(await publishInput(store, contentVariant(pairInput('engineering'), 'r2')));
  const draft = await store.drafts.create(
    { documents: contentVariant(pairInput('engineering'), 'a draft on r2') },
    'owner',
  );
  assert.equal(draft.kind, 'saved');
  assert.equal(draft.kind === 'saved' && draft.draft.baseRevisionId, ids[1]);
  for (let n = 3; n <= RECENTLY_LIVE_KEPT + 4; n++) {
    ids.push(await imported(store, contentVariant(pairInput('engineering'), `r${n}`)));
  }
  return { store, ids };
}

test('--keep never removes the live revision, the 10 most recently live before it, or a draft base, and each one it removes leaves a tombstone', async (t) => {
  const { store, ids } = await history(t);
  const [r1, r2, r3] = ids;
  const outcome = await retention(store, { keep: 0 });
  assert.equal(outcome.kind, 'done');
  if (outcome.kind !== 'done') return;
  assert.deepEqual([...outcome.report.removedRevisions].sort(), [r1, r3].sort());
  assert.equal(outcome.report.protected.get(ids.at(-1)!), 'live');
  assert.equal(outcome.report.protected.get(r2!), 'draft-base');
  for (const id of ids.slice(3, -1))
    assert.equal(outcome.report.protected.get(id), 'recently-live', id);
  for (const id of [r1!, r3!]) {
    assert.equal(existsSync(store.paths.revision(id)), false, id);
    const tombstone = JSON.parse(readFileSync(store.paths.tombstone(id), 'utf8'));
    assert.deepEqual(tombstone, {
      revisionId: id,
      removedAt: new Date(NOW).toISOString(),
      actor: 'operator',
    });
  }
  const remaining = await store.revisions.list();
  assert.equal(remaining.length, ids.length - 2);
  assert.equal(
    (await verifyStore({ fs: nodeFs, paths: store.paths, checks: testChecks() })).problems.length,
    0,
  );
  // Removed revisions stay in the log, and can't be made live again.
  const back = await store.publication.recover(
    { targetRevisionId: r1, expectedLiveRevisionId: ids.at(-1)! },
    'operator',
  );
  assert.equal(back.kind === 'rejected' && back.code, 'not_found');
});

test('--keep n keeps the newest n whatever they are, and removes only unprotected ones beyond them', async (t) => {
  const { store, ids } = await history(t);
  const outcome = await retention(store, { keep: ids.length - 1, dryRun: true });
  assert.equal(outcome.kind, 'done');
  // The oldest, R1, is beyond the newest 13, and nothing protects it.
  assert.deepEqual(outcome.kind === 'done' && outcome.report.removedRevisions, [ids[0]]);
  assert.equal((await store.revisions.list()).length, ids.length, 'a dry run removes nothing');
  const none = await retention(store, { keep: ids.length });
  assert.deepEqual(none.kind === 'done' && none.report.removedRevisions, []);
});

test('--remove refuses a protected revision and says why, and removes an unprotected one', async (t) => {
  const { store, ids } = await history(t);
  const call = { dataDir: store.paths.root, readSource };
  for (const [id, why] of [
    [ids.at(-1)!, 'the live revision'],
    [ids[5]!, 'one of the 10 revisions most recently live'],
    [ids[1]!, "a draft's base"],
  ] as const) {
    const run = await cli(['retention', '--remove', id], call);
    assert.equal(run.code, 1, run.out);
    assert.match(run.err, new RegExp(`^protected: ${id} is ${why}, which retention never removes`));
    assert.ok(existsSync(store.paths.revision(id)));
  }
  const removed = await cli(['retention', '--remove', ids[0]!], call);
  assert.equal(removed.code, 0, removed.err);
  assert.match(removed.out, new RegExp(`^removed revision ${ids[0]}$`, 'm'));
  assert.ok(existsSync(store.paths.tombstone(ids[0]!)));
  const gone = await cli(['retention', '--remove', ids[0]!], call);
  assert.equal(gone.code, 1);
  assert.match(gone.err, /^not_found: /);
  assert.equal((await cli(['retention', '--keep', '-1'], call)).code, 2);
  assert.equal((await cli(['retention', '--keep', '1', '--remove', ids[0]!], call)).code, 2);
});

test('verify and the last-known-good walk skip a tombstoned revision, whatever is left of its directory', async (t) => {
  const store = await newStore(t);
  const r1 = await publishInput(store, contentVariant(pairInput('engineering'), 'r1'));
  const r2 = await publishInput(store, contentVariant(pairInput('engineering'), 'r2'));
  const r3 = await publishInput(store, contentVariant(pairInput('engineering'), 'r3'));
  // A crash after R2's tombstone, before its directory went: it's still whole.
  await writeTombstone(
    nodeFs,
    store.paths,
    { revisionId: r2, removedAt: new Date(NOW).toISOString(), actor: 'operator' },
    'test',
  );
  // The live revision is damaged: the last known good is R1, never R2.
  const live = path.join(store.paths.revision(r3), 'documents', 'portfolio.yml');
  writeFileSync(live, '# damaged\n', { flag: 'a' });
  const status = await store.publication.status();
  assert.deepEqual(
    [status.state, status.liveRevisionId, status.servingRevisionId],
    ['degraded', r3, r1],
  );
  assert.equal(await store.publication.lastKnownGood(), r1);

  // Whatever is left of R2 isn't checked either.
  writeFileSync(path.join(store.paths.revision(r2), 'documents', 'portfolio.yml'), 'damaged too\n');
  const report = await verifyStore({ fs: nodeFs, paths: store.paths, checks: testChecks() });
  assert.deepEqual(report.problems, [{ code: 'revision_hash_mismatch', path: `revisions/${r3}` }]);
  assert.deepEqual(report.notes, [{ code: 'tombstoned_directory_left', path: `revisions/${r2}` }]);

  // The next retention run finishes the removal.
  const outcome = await retention(store);
  assert.deepEqual(outcome.kind === 'done' && outcome.report.finishedRevisions, [r2]);
  assert.equal(existsSync(store.paths.revision(r2)), false);
  assert.ok(existsSync(store.paths.tombstone(r2)));
});

test("a revision's tombstone is synced into place before its directory goes", async (t) => {
  const { store, ids } = await history(t);
  const recording = recordingFs();
  const outcome = await runRetention(
    {
      fs: recording.fs,
      paths: store.paths,
      lock: store.lock,
      checks: testChecks(),
      actor: 'operator',
      now: () => NOW,
    },
    { remove: ids[0] },
  );
  assert.equal(outcome.kind, 'done');
  const points = recording.hits.map((hit) => hit.point);
  const at = (point: string) => {
    const index = points.indexOf(point);
    assert.ok(index >= 0, point);
    return index;
  };
  assert.ok(at('retention.tombstone.fsync') < at('retention.tombstone.rename'));
  assert.ok(at('retention.tombstone.rename') < at('retention.revisions.fsync'));
  assert.ok(at('retention.revisions.fsync') < at('retention.revision.remove'));
});

test("no blob goes while a revision's manifest can't be read", async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const blob: { sha256: Sha256 } = await store.assets.put(Buffer.from('unreferenced'), 'image/png');
  aged(store.paths.blob(blob.sha256), 2 * DAY);
  writeFileSync(path.join(store.paths.revision(first), 'manifest.json'), '{ not json');
  const outcome = await retention(openStore({ dataDir: store.paths.root, checks: testChecks() }));
  assert.equal(outcome.kind, 'done');
  assert.equal(outcome.kind === 'done' && outcome.report.blobsKept, 'manifest_unreadable');
  assert.ok(existsSync(store.paths.blob(blob.sha256)));
});

test('retention never goes into a linked shard, nor removes a link where a blob should be', async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const outside = tempDir(t, 'store-outside-');
  const name = `ab${'c'.repeat(62)}`;
  writeFileSync(path.join(outside, name), "not the store's\n");
  aged(path.join(outside, name), 2 * DAY);
  mkdirSync(store.paths.assets, { recursive: true });
  symlinkSync(outside, path.join(store.paths.assets, 'ab'));
  // And a link named for a blob, in a shard of the store's own.
  mkdirSync(path.join(store.paths.assets, 'cd'));
  const linked = path.join(store.paths.assets, 'cd', `cd${'e'.repeat(62)}`);
  symlinkSync(path.join(outside, name), linked);

  const outcome = await retention(store);
  assert.equal(outcome.kind, 'done');
  assert.deepEqual(outcome.kind === 'done' && outcome.report.removedBlobs, []);
  assert.ok(existsSync(path.join(outside, name)), 'the file outside the store stays');
  assert.ok(existsSync(linked));
});

test('a run whose lock another process took removes no revision, and leaves a half-removed one for later', async (t) => {
  const { store, ids } = await history(t);
  // A crash after R3's tombstone, before its directory went.
  await writeTombstone(
    nodeFs,
    store.paths,
    { revisionId: ids[2]!, removedAt: new Date(NOW).toISOString(), actor: 'operator' },
    'test',
  );
  const lost: PublicationLock = {
    ...store.lock,
    async fence() {
      throw new LockLostError();
    },
  };
  const outcome = await runRetention(
    {
      fs: nodeFs,
      paths: store.paths,
      lock: lost,
      checks: testChecks(),
      actor: 'operator',
      now: () => NOW,
    },
    { remove: ids[0] },
  );
  assert.equal(outcome.kind, 'done');
  if (outcome.kind !== 'done') return;
  assert.equal(outcome.report.stopped, 'lock_lost');
  assert.deepEqual([outcome.report.removedRevisions, outcome.report.finishedRevisions], [[], []]);
  assert.ok(existsSync(store.paths.revision(ids[0]!)));
  assert.equal(existsSync(store.paths.tombstone(ids[0]!)), false);
  assert.ok(existsSync(store.paths.revision(ids[2]!)), 'the next run finishes it');
});
