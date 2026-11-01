// `import` (#3, item 24) in the PublicationService: all five of publish's
// steps on the mounted documents, an `import` event that carries their
// sourceHash, and, where publish would find nothing to publish, a pointer
// move to the live revision again.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { memoryAuditSink } from '../audit/sink';
import { nodeFs } from './fs-port';
import type { RevisionId } from './layout';
import { readEvents, readLive } from './pointer';
import { readManifest } from './revisions';
import { importSourceHash, type UnitInput } from '../catalog/unit';
import {
  commentedVariant,
  contentVariant,
  invalidInput,
  newStore,
  pairInput,
  publishInput,
} from './test-support/fixtures';

const hashOf = (input: UnitInput) =>
  importSourceHash({
    'portfolio.yml': input.portfolio.sourceText,
    'site.yml': input.site.sourceText,
  });
const revisionDirs = (root: string) =>
  readdirSync(`${root}/revisions`).filter((name) => /^rev_[0-9a-f]{32}$/.test(name));

test('an import publishes the mounted pair as a revision, with an import event carrying its sourceHash', async (t) => {
  const audit = memoryAuditSink();
  const store = await newStore(t, { audit });
  const input = pairInput('engineering');
  const outcome = await store.publication.importSource(
    { documents: input, sourceHash: hashOf(input), expectedLiveRevisionId: null },
    'operator',
  );
  assert.equal(outcome.kind, 'committed');
  if (outcome.kind !== 'committed') return;
  assert.equal(outcome.seq, 1);

  const live = await readLive(nodeFs, store.paths);
  assert.equal(live?.revisionId, outcome.revisionId);
  const manifest = await readManifest(nodeFs, store.paths, outcome.revisionId);
  assert.deepEqual(manifest?.source, { kind: 'import', sourceHash: hashOf(input) });
  assert.equal(manifest?.parentRevisionId, null);
  assert.equal(manifest?.createdBy, 'operator');
  assert.equal(live?.unitHash, manifest?.unitHash);

  const [event] = await readEvents(nodeFs, store.paths);
  assert.deepEqual(
    { ...event, at: undefined },
    {
      seq: 1,
      type: 'import',
      revisionId: outcome.revisionId,
      previousRevisionId: null,
      actor: 'operator',
      at: undefined,
      sourceHash: hashOf(input),
    },
  );
  assert.deepEqual(
    audit.records.map((record) => [record.type, record.actor, record.refs]),
    [['imported', 'operator', { seq: 1, revisionId: outcome.revisionId }]],
  );
  assert.equal(await store.drafts.getWorking(), null, 'an import writes no draft');
});

test("an import of what's live already writes no revision: only the seq and the event change", async (t) => {
  const store = await newStore(t);
  const input = pairInput('engineering');
  const first = await store.publication.importSource(
    { documents: input, sourceHash: hashOf(input), expectedLiveRevisionId: null },
    'operator',
  );
  assert.equal(first.kind, 'committed');
  if (first.kind !== 'committed') return;
  const before = await readLive(nodeFs, store.paths);

  const again = await store.publication.importSource(
    { documents: input, sourceHash: hashOf(input), expectedLiveRevisionId: first.revisionId },
    'operator',
  );
  assert.deepEqual(again, { kind: 'committed', revisionId: first.revisionId, seq: 2 });
  assert.deepEqual(revisionDirs(store.paths.root), [first.revisionId]);
  const after = await readLive(nodeFs, store.paths);
  assert.equal(after?.revisionId, before?.revisionId);
  assert.equal(after?.unitHash, before?.unitHash);
  assert.deepEqual(
    (await readEvents(nodeFs, store.paths)).map((event) => [
      event.seq,
      event.type,
      event.revisionId,
      event.previousRevisionId,
    ]),
    [
      [1, 'import', first.revisionId, null],
      [2, 'import', first.revisionId, first.revisionId],
    ],
  );

  // New bytes with the same content are a new revision, as a publish would make.
  const commented = commentedVariant(input, 'a comment');
  const third = await store.publication.importSource(
    {
      documents: commented,
      sourceHash: hashOf(commented),
      expectedLiveRevisionId: first.revisionId,
    },
    'operator',
  );
  assert.equal(third.kind, 'committed');
  assert.notEqual(third.kind === 'committed' && third.revisionId, first.revisionId);
  assert.equal(revisionDirs(store.paths.root).length, 2);
});

test('an import after a Studio publish names it as the parent and lists it as previous', async (t) => {
  const store = await newStore(t);
  const published = await publishInput(store, pairInput('engineering'));
  const next = contentVariant(pairInput('engineering'), 'imported');
  const outcome = await store.publication.importSource(
    { documents: next, sourceHash: hashOf(next), expectedLiveRevisionId: published },
    'operator',
  );
  assert.equal(outcome.kind, 'committed');
  if (outcome.kind !== 'committed') return;
  const manifest = await readManifest(nodeFs, store.paths, outcome.revisionId);
  assert.equal(manifest?.parentRevisionId, published);
  assert.equal((await readEvents(nodeFs, store.paths)).at(-1)?.previousRevisionId, published);
});

test('an import that read a live revision another one replaced gets live_conflict, and writes nothing', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const input = contentVariant(pairInput('engineering'), 'three');
  for (const stale of [null, first] as (RevisionId | null)[]) {
    const outcome = await store.publication.importSource(
      { documents: input, sourceHash: hashOf(input), expectedLiveRevisionId: stale },
      'operator',
    );
    assert.equal(outcome.kind, 'conflict');
    assert.equal(outcome.kind === 'conflict' && outcome.code, 'live_conflict');
    assert.equal(
      outcome.kind === 'conflict' && 'liveRevisionId' in outcome && outcome.liveRevisionId,
      second,
    );
  }
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 2);
  assert.equal(revisionDirs(store.paths.root).length, 2);
});

test('an invalid pair is validation_failed with its findings, and an import needs a source hash', async (t) => {
  const store = await newStore(t);
  const invalid = invalidInput('ref.missing');
  const outcome = await store.publication.importSource(
    { documents: invalid, sourceHash: hashOf(invalid), expectedLiveRevisionId: null },
    'operator',
  );
  assert.equal(outcome.kind === 'rejected' && outcome.code, 'validation_failed');
  assert.ok(
    outcome.kind === 'rejected' && outcome.diagnostics.some((d) => d.code === 'ref.missing'),
  );
  assert.equal(await readLive(nodeFs, store.paths), null);
  assert.deepEqual(revisionDirs(store.paths.root), []);

  const input = pairInput('engineering');
  assert.throws(
    () =>
      store.publication.importSource(
        { documents: input, sourceHash: 'sha256:nope' as never, expectedLiveRevisionId: null },
        'operator',
      ),
    TypeError,
  );
  // The owner imports through Studio's draft, never this, and holds a session for any pointer move.
  assert.throws(
    () =>
      store.publication.importSource(
        { documents: input, sourceHash: hashOf(input), expectedLiveRevisionId: null },
        'owner',
      ),
    TypeError,
  );
});
