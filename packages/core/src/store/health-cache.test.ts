import assert from 'node:assert/strict';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { validatePublicationUnit } from '@portfolio/schema';
import type { UnitChecks } from '../catalog/unit';
import {
  contentVariant,
  mediaDocument,
  newStore,
  owned,
  pairInput,
  publishInput,
  testChecks,
} from './test-support/fixtures';

// The PublicationService's kept verdicts (#3, item 14, and the Slice 1
// review's F9): status(), the last-known-good walk, and revision.list check
// a revision once until the pointer moves, a tombstone appears, or a blob
// it references goes or comes back.

/** testChecks, counting each run of the validator, by how it was asked. */
function counted(): { checks: UnitChecks; runs: { publish: number; serve: number } } {
  const runs = { publish: 0, serve: 0 };
  return {
    runs,
    checks: testChecks({
      validate: (pair) => {
        runs.publish += 1;
        return validatePublicationUnit(pair);
      },
      validateLive: (pair) => {
        runs.serve += 1;
        return validatePublicationUnit(pair);
      },
    }),
  };
}

test('a revision is checked once until the pointer moves, and every check reruns when it does', async (t) => {
  const { checks, runs } = counted();
  const store = await newStore(t, { checks });
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  runs.publish = 0;
  runs.serve = 0;

  await store.publication.revisions();
  assert.deepEqual(runs, { publish: 2, serve: 0 });
  await store.publication.revisions();
  await store.publication.revisions({ offset: 0, limit: 1 });
  assert.deepEqual(runs, { publish: 2, serve: 0 }, 'listed again from the kept verdicts');
  assert.equal((await store.publication.status()).state, 'live');
  assert.equal((await store.publication.status()).state, 'live');
  assert.equal(await store.publication.lastKnownGood(), second);
  assert.deepEqual(runs, { publish: 2, serve: 1 }, 'the live one checked as served, once');

  // A rollback moves the pointer, after its own check of the target.
  const moved = await owned(store).rollback(
    { targetRevisionId: first, expectedLiveRevisionId: second },
    'owner',
  );
  assert.equal(moved.kind, 'committed');
  runs.publish = 0;
  runs.serve = 0;
  await store.publication.revisions();
  assert.deepEqual(runs, { publish: 2, serve: 0 }, 'every check reran');
});

test('a page of revision.list checks only its own revisions', async (t) => {
  const { checks, runs } = counted();
  const store = await newStore(t, { checks });
  const ids = [await publishInput(store, pairInput('engineering'))];
  for (const marker of ['two', 'three', 'four']) {
    ids.push(await publishInput(store, contentVariant(pairInput('engineering'), marker)));
  }
  runs.publish = 0;
  const page = await store.publication.revisions({ offset: 1, limit: 2 });
  assert.deepEqual(
    page.map((summary) => summary.revisionId),
    [ids[2], ids[1]],
  );
  assert.equal(runs.publish, 2);
  // The whole list is the pages put together, in the same order.
  const all = await store.publication.revisions();
  assert.deepEqual(
    all.map((summary) => summary.revisionId),
    [...ids].reverse(),
  );
  // History pages by seq, and reads only its range.
  const events = await store.publication.history({ offset: 1, limit: 2 });
  assert.deepEqual(
    events.map((event) => event.seq),
    [2, 3],
  );
  assert.deepEqual(
    (await store.publication.history({ offset: 3, limit: 10 })).map((event) => event.seq),
    [4],
  );
  assert.deepEqual(await store.publication.history({ offset: 4, limit: 10 }), []);
  await assert.rejects(() => store.publication.history({ offset: -1 }), TypeError);
  await assert.rejects(() => store.publication.revisions({ limit: 0 }), TypeError);
});

test('a tombstone, or a blob that goes or comes back, changes a kept verdict without a pointer move', async (t) => {
  const store = await newStore(t);
  const blob = await store.assets.put(Buffer.from('a picture'), 'image/png');
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, {
    ...contentVariant(pairInput('engineering'), 'two'),
    media: mediaDocument([blob.sha256]),
  });
  await publishInput(store, contentVariant(pairInput('engineering'), 'three'));
  const summary = async (id: string) =>
    (await store.publication.revisions()).find((entry) => entry.revisionId === id);

  assert.equal((await summary(first))?.compatible, true);
  assert.equal((await summary(second))?.compatible, true);

  writeFileSync(
    store.paths.tombstone(first),
    `${JSON.stringify({ revisionId: first, removedAt: new Date().toISOString(), actor: 'operator' })}\n`,
  );
  assert.deepEqual(
    [(await summary(first))?.compatible, (await summary(first))?.reason],
    [false, 'removed'],
  );

  rmSync(store.paths.blob(blob.sha256));
  assert.deepEqual(
    [(await summary(second))?.compatible, (await summary(second))?.reason],
    [false, 'incompatible:asset_missing'],
  );
  await store.assets.put(Buffer.from('a picture'), 'image/png');
  assert.equal((await summary(second))?.compatible, true);
});

test('a revision unreadable for a failure that may pass is checked again on the next call, never kept', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const file = path.join(store.paths.revision(first), 'documents', 'portfolio.yml');
  const compatible = async () =>
    Object.fromEntries(
      (await store.publication.revisions()).map((summary) => [
        summary.revisionId,
        summary.compatible,
      ]),
    );
  chmodSync(file, 0o000);
  // Put back if the test stops first; once it's done, the store is gone.
  t.after(() => {
    try {
      chmodSync(file, 0o600);
    } catch {
      // Gone already.
    }
  });
  assert.deepEqual(await compatible(), { [first]: false, [second]: true });
  chmodSync(file, 0o600);
  assert.deepEqual(await compatible(), { [first]: true, [second]: true });
});
