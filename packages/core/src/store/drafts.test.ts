import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { onStoreEvent, type StoreEvent } from './common';
import { asDraft } from './drafts';
import { nodeFs } from './fs-port';
import { readLive } from './pointer';
import { sha256 } from './unit';
import {
  contentVariant,
  invalidInput,
  mediaDocument,
  newStore,
  owned,
  pairInput,
  publishInput,
} from './test-support/fixtures';

const tooBig = (input = pairInput('engineering')) => ({
  ...input,
  portfolio: {
    ...input.portfolio,
    sourceText: `${input.portfolio.sourceText}#${'x'.repeat(1024 * 1024)}\n`,
  },
});

test("an invalid draft saves with its diagnostics, and one whose text doesn't parse saves with a null model", async (t) => {
  const store = await newStore(t);
  const invalid = await store.drafts.create({ documents: invalidInput('ref.missing') }, 'owner');
  assert.equal(invalid.kind, 'saved');
  if (invalid.kind !== 'saved') return;
  const diagnostics = [
    ...invalid.draft.documents.portfolio.diagnostics,
    ...invalid.draft.documents.site.diagnostics,
  ];
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === 'ref.missing'));
  assert.notEqual(invalid.draft.documents.portfolio.model, null);

  const broken = await store.drafts.save(
    {
      draftId: invalid.draft.draftId,
      expectedVersion: 1,
      documents: {
        ...pairInput('engineering'),
        portfolio: { format: 'yaml', sourceText: 'identity: [\n' },
      },
    },
    'owner',
  );
  assert.equal(broken.kind, 'saved');
  if (broken.kind !== 'saved') return;
  assert.equal(broken.draft.version, 2);
  assert.equal(broken.draft.documents.portfolio.model, null);
  assert.ok(broken.draft.documents.portfolio.diagnostics.some((d) => d.code === 'parse.syntax'));
  assert.ok(asDraft(JSON.parse(readFileSync(store.paths.draft(broken.draft.draftId), 'utf8'))));
});

test('a YAML draft keeps its comments and key order through applyEdits and publish', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const created = await store.drafts.create({}, 'owner');
  assert.equal(created.kind, 'saved');
  if (created.kind !== 'saved') return;
  assert.equal(created.draft.baseRevisionId, first);
  const original = created.draft.documents.portfolio.sourceText;
  assert.equal(original, pairInput('engineering').portfolio.sourceText);

  const edited = await store.drafts.applyEdits(
    {
      draftId: created.draft.draftId,
      expectedVersion: created.draft.version,
      edits: [
        {
          document: 'portfolio',
          pointer: '/identity/tagline',
          op: 'set',
          value: 'Staff platform engineer',
        },
        { document: 'portfolio', pointer: '/identity/pronouns', op: 'delete' },
      ],
    },
    'owner',
  );
  assert.equal(edited.kind, 'saved');
  if (edited.kind !== 'saved') return;
  const text = edited.draft.documents.portfolio.sourceText;
  assert.equal(edited.draft.version, created.draft.version + 1);
  // Every comment survives, and every line but the two edited ones is as it was.
  const comments = (source: string) =>
    source.split('\n').filter((line) => line.trimStart().startsWith('#'));
  assert.deepEqual(comments(text), comments(original));
  const removed = original.split('\n').filter((line) => !text.split('\n').includes(line));
  assert.deepEqual(removed, ['  tagline: Platform engineer', '  pronouns: she/her']);
  assert.ok(text.includes('  tagline: Staff platform engineer'));
  const keys = (source: string) => [...source.matchAll(/^(\w+):/gm)].map((match) => match[1]);
  assert.deepEqual(keys(text), keys(original));

  const published = await owned(store).publish(
    {
      draftId: edited.draft.draftId,
      draftVersion: edited.draft.version,
      expectedLiveRevisionId: first,
    },
    'owner',
  );
  assert.equal(published.kind, 'committed');
  if (published.kind !== 'committed') return;
  const stored = readFileSync(
    path.join(store.paths.revision(published.revisionId), 'documents/portfolio.yml'),
    'utf8',
  );
  assert.equal(stored, text);
});

test("an edit that can't apply fails with validation_failed and saves nothing", async (t) => {
  const store = await newStore(t);
  const created = await store.drafts.create({ documents: pairInput('engineering') }, 'owner');
  if (created.kind !== 'saved') return assert.fail();
  const outcome = await store.drafts.applyEdits(
    {
      draftId: created.draft.draftId,
      expectedVersion: 1,
      edits: [{ document: 'portfolio', pointer: '/sections/99/id', op: 'set', value: 'x' }],
    },
    'owner',
  );
  assert.equal(outcome.kind === 'rejected' && outcome.code, 'validation_failed');
  assert.equal(outcome.kind === 'rejected' && outcome.diagnostics[0]?.code, 'edit.failed');
  assert.equal((await store.drafts.get(created.draft.draftId))?.version, 1);
  await assert.rejects(
    store.drafts.applyEdits(
      {
        draftId: created.draft.draftId,
        expectedVersion: 1,
        edits: [{ document: 'other' as never, pointer: '', op: 'delete' }],
      },
      'owner',
    ),
    TypeError,
  );
});

test('one working draft: create replaces its documents as a new version under expectedVersion, with live as the base', async (t) => {
  const store = await newStore(t);
  assert.equal((await store.drafts.create({}, 'owner')).kind === 'rejected', true);
  const first = await publishInput(store, pairInput('engineering'));
  const created = await store.drafts.create(
    { documents: contentVariant(pairInput('engineering'), 'one') },
    'owner',
  );
  if (created.kind !== 'saved') return assert.fail();
  const again = await store.drafts.create({}, 'owner');
  assert.equal(again.kind === 'conflict' && again.code, 'draft_conflict');
  const replaced = await store.drafts.create({ expectedVersion: 1 }, 'owner');
  if (replaced.kind !== 'saved') return assert.fail();
  assert.equal(replaced.draft.draftId, created.draft.draftId);
  assert.equal(replaced.draft.version, 2);
  assert.equal(replaced.draft.baseRevisionId, first);
  assert.equal(replaced.draft.createdAt, created.draft.createdAt);
  assert.equal(
    replaced.draft.documents.portfolio.sourceText,
    pairInput('engineering').portfolio.sourceText,
  );
  assert.deepEqual(await nodeFs.readdir(store.paths.drafts).then((names) => names.sort()), [
    `${created.draft.draftId}.json`,
    `${created.draft.draftId}.prev.json`,
  ]);
  assert.equal((await store.drafts.getWorking())?.version, 2);
});

test('Restore into draft starts the working draft from a chosen revision, on live as its base', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const restored = await store.drafts.create({ fromRevisionId: first }, 'owner');
  if (restored.kind !== 'saved') return assert.fail();
  assert.equal(restored.draft.baseRevisionId, second);
  assert.equal(
    restored.draft.documents.portfolio.sourceText,
    pairInput('engineering').portfolio.sourceText,
  );
  const unknown = await store.drafts.create(
    { fromRevisionId: `rev_${'0'.repeat(32)}`, expectedVersion: 1 },
    'owner',
  );
  assert.equal(unknown.kind === 'rejected' && unknown.code, 'not_found');
});

test('a stale save returns draft_conflict with the current version and documents, and keeps the previous version', async (t) => {
  const store = await newStore(t);
  const created = await store.drafts.create(
    { documents: contentVariant(pairInput('engineering'), 'one') },
    'owner',
  );
  if (created.kind !== 'saved') return assert.fail();
  const { draftId } = created.draft;
  const saved = await store.drafts.save(
    { draftId, expectedVersion: 1, documents: contentVariant(pairInput('engineering'), 'two') },
    'owner',
  );
  assert.equal(saved.kind, 'saved');
  const stale = await store.drafts.save(
    { draftId, expectedVersion: 1, documents: contentVariant(pairInput('engineering'), 'three') },
    'owner',
  );
  assert.equal(stale.kind, 'conflict');
  if (stale.kind !== 'conflict' || stale.code !== 'draft_conflict') return assert.fail();
  assert.equal(stale.version, 2);
  assert.match(stale.documents.portfolio.sourceText, /version two/);
  const previous = asDraft(JSON.parse(readFileSync(store.paths.draftPrevious(draftId), 'utf8')));
  assert.equal(previous?.version, 1);
  assert.match(previous?.documents.portfolio.sourceText ?? '', /version one/);
  const missing = await store.drafts.save(
    { draftId: `drf_${'0'.repeat(32)}`, expectedVersion: 1, documents: pairInput('engineering') },
    'owner',
  );
  assert.equal(missing.kind === 'rejected' && missing.code, 'not_found');
});

test('a stale applyEdits or rebase returns draft_conflict with the current version too, and saves nothing', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const created = await store.drafts.create(
    { documents: contentVariant(pairInput('engineering'), 'one') },
    'owner',
  );
  if (created.kind !== 'saved') return assert.fail();
  const { draftId } = created.draft;
  const saved = await store.drafts.save(
    { draftId, expectedVersion: 1, documents: contentVariant(pairInput('engineering'), 'two') },
    'owner',
  );
  assert.equal(saved.kind, 'saved');
  const edited = await store.drafts.applyEdits(
    {
      draftId,
      expectedVersion: 1,
      edits: [{ document: 'site', pointer: '/features/feed', op: 'set', value: false }],
    },
    'owner',
  );
  const rebased = await store.drafts.rebase(
    {
      draftId,
      expectedVersion: 1,
      documents: contentVariant(pairInput('engineering'), 'three'),
      baseRevisionId: first,
    },
    'owner',
  );
  for (const stale of [edited, rebased]) {
    if (stale.kind !== 'conflict' || stale.code !== 'draft_conflict') return assert.fail();
    assert.equal(stale.version, 2);
    assert.match(stale.documents.portfolio.sourceText, /version two/);
  }
  const working = await store.drafts.get(draftId);
  assert.equal(working?.version, 2);
  assert.match(working?.documents.portfolio.sourceText ?? '', /version two/);
});

test('a document past 1 MiB fails with payload_too_large, and nothing is written', async (t) => {
  const store = await newStore(t);
  const outcome = await store.drafts.create({ documents: tooBig() }, 'owner');
  assert.equal(outcome.kind === 'rejected' && outcome.code, 'payload_too_large');
  assert.deepEqual(outcome.kind === 'rejected' && outcome.documents, ['portfolio']);
  assert.deepEqual(await nodeFs.readdir(store.paths.drafts), []);
});

test('rebase needs live as the new base, and a damaged draft file falls back to its previous version', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const created = await store.drafts.create(
    { documents: contentVariant(pairInput('engineering'), 'one') },
    'owner',
  );
  if (created.kind !== 'saved') return assert.fail();
  const { draftId } = created.draft;
  const wrongBase = await store.drafts.rebase(
    { draftId, expectedVersion: 1, documents: pairInput('engineering'), baseRevisionId: null },
    'owner',
  );
  assert.equal(wrongBase.kind === 'conflict' && wrongBase.code, 'live_conflict');
  const rebased = await store.drafts.rebase(
    {
      draftId,
      expectedVersion: 1,
      documents: contentVariant(pairInput('engineering'), 'two'),
      baseRevisionId: first,
    },
    'owner',
  );
  assert.equal(rebased.kind, 'saved');
  writeFileSync(store.paths.draft(draftId), '{"draftFormat": 1, "draftId"');
  const fallback = await store.drafts.get(draftId);
  assert.equal(fallback?.version, 1);
});

test('discard deletes the draft and its previous version; a stale one is a conflict', async (t) => {
  const store = await newStore(t);
  const events: StoreEvent[] = [];
  t.after(onStoreEvent((event) => events.push(event)));
  const created = await store.drafts.create({ documents: pairInput('engineering') }, 'owner');
  if (created.kind !== 'saved') return assert.fail();
  const { draftId } = created.draft;
  await store.drafts.save(
    { draftId, expectedVersion: 1, documents: contentVariant(pairInput('engineering'), 'two') },
    'owner',
  );
  const stale = await store.drafts.discard({ draftId, expectedVersion: 1 }, 'owner');
  assert.equal(stale.kind === 'conflict' && stale.code, 'draft_conflict');
  assert.deepEqual(await store.drafts.discard({ draftId, expectedVersion: 2 }, 'owner'), {
    kind: 'discarded',
    draftId,
  });
  assert.deepEqual(await nodeFs.readdir(store.paths.drafts), []);
  assert.equal((await store.drafts.discard({ draftId }, 'owner')).kind, 'rejected');
  assert.deepEqual(
    events.map((event) => [event.name, event.version ?? null]),
    [
      ['draftSaved', 1],
      ['draftSaved', 2],
      ['draftDiscarded', null],
    ],
  );
});

test('a draft can only reference a blob the AssetStore holds', async (t) => {
  const store = await newStore(t);
  const absent = sha256('a picture nobody stored');
  const refused = await store.drafts.create(
    { documents: { ...pairInput('engineering'), media: mediaDocument([absent]) } },
    'owner',
  );
  assert.equal(refused.kind === 'rejected' && refused.code, 'asset_missing');
  assert.deepEqual(refused.kind === 'rejected' && refused.blobs, [absent]);
  const stored = await store.assets.put(Buffer.from('a picture'), 'image/png');
  const saved = await store.drafts.create(
    { documents: { ...pairInput('engineering'), media: mediaDocument([stored.sha256]) } },
    'owner',
  );
  assert.equal(saved.kind, 'saved');
});

test('saving, editing, rebasing, or discarding a draft never changes the live revision', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const live = readFileSync(store.paths.live);
  const created = await store.drafts.create({}, 'owner');
  if (created.kind !== 'saved') return assert.fail();
  const { draftId } = created.draft;
  await store.drafts.save(
    { draftId, expectedVersion: 1, documents: contentVariant(pairInput('engineering'), 'two') },
    'owner',
  );
  await store.drafts.applyEdits(
    {
      draftId,
      expectedVersion: 2,
      edits: [{ document: 'site', pointer: '/features/feed', op: 'set', value: false }],
    },
    'owner',
  );
  await store.drafts.rebase(
    { draftId, expectedVersion: 3, documents: pairInput('engineering'), baseRevisionId: first },
    'owner',
  );
  await store.drafts.discard({ draftId }, 'owner');
  assert.deepEqual(readFileSync(store.paths.live), live);
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 1);
});

test('draft files are 0600 in a 0700 directory', async (t) => {
  const store = await newStore(t);
  const created = await store.drafts.create({ documents: pairInput('engineering') }, 'owner');
  if (created.kind !== 'saved') return assert.fail();
  await store.drafts.save(
    {
      draftId: created.draft.draftId,
      expectedVersion: 1,
      documents: contentVariant(pairInput('engineering'), 'two'),
    },
    'owner',
  );
  assert.equal(statSync(store.paths.drafts).mode & 0o777, 0o700);
  assert.equal(statSync(store.paths.draft(created.draft.draftId)).mode & 0o777, 0o600);
  assert.equal(statSync(store.paths.draftPrevious(created.draft.draftId)).mode & 0o777, 0o600);
});
