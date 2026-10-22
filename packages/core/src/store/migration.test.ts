// Schema migration (#3, item 25, Slice 4) with a test-only next schema
// major: `migrate-store`'s migration of the live revision, startup on an
// unmigrated store, and a rollback to a revision an older build wrote.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { applyEdits, parseSource } from '@portfolio/schema';
import type { StoreLogEntry } from './common';
import { nodeFs } from './fs-port';
import { newRevisionId, type RevisionId } from './layout';
import { readEvents, readLive } from './pointer';
import type { MigrationOutcome } from './publication';
import { revisionCatalogReader } from './reader';
import { readManifest } from './revisions';
import { openStore, type Store } from './store';
import type { StoreMigration, UnitChecks, UnitInput } from '../catalog/unit';
import {
  contentVariant,
  filesUnder,
  newStore,
  owned,
  pairInput,
  publishInput,
  tempDir,
  testChecks,
} from './test-support/fixtures';
import {
  CURRENT_VERSIONS,
  migrateToNext,
  NEXT,
  NEXT_VERSIONS,
  nextChecks,
  TITLE_PATH,
} from './test-support/next-schema';

/** Every file under `dir`, by its path there, with the SHA-256 of its bytes. */
function everyFile(dir: string): Record<string, string> {
  return Object.fromEntries(
    filesUnder(dir).map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(path.join(dir, file)))
        .digest('hex'),
    ]),
  );
}

/** The files of each of `ids`, under revisions/. */
function revisionFiles(store: Store, ids: readonly RevisionId[]) {
  return Object.fromEntries(ids.map((id) => [id, everyFile(store.paths.revision(id))]));
}

/** A store this build wrote, with two revisions, the second live. */
async function olderStore(t: TestContext, first: UnitInput = pairInput('engineering')) {
  const dataDir = tempDir(t);
  const older = await newStore(t, { dataDir });
  const a = await publishInput(older, first);
  const b = await publishInput(older, contentVariant(first, 'two'));
  return { dataDir, older, a, b };
}

const committed = (outcome: MigrationOutcome) => {
  assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
  return outcome.kind === 'committed' ? outcome : assert.fail();
};

const documentData = (text: string) => {
  const read = parseSource(text, 'yaml');
  assert.ok(read.ok);
  return read.data as { schemaVersion: number; migration?: { id: string; title?: string } };
};

test("migrate-store's migration makes the live revision's migration live as its child, and changes no revision that exists", async (t) => {
  const { dataDir, older, a, b } = await olderStore(t);
  const existing = revisionFiles(older, [a, b]);
  const logs: StoreLogEntry[] = [];
  const store = openStore({ dataDir, checks: nextChecks(), log: (entry) => logs.push(entry) });

  // The next build can't serve what an older one wrote, and names the command.
  const status = await store.publication.status();
  assert.deepEqual(
    [status.state, status.liveRevisionId, status.reason, status.command],
    ['incompatible', b, 'incompatible:schema.version', 'portfolio-store migrate-store'],
  );

  // The dry run plans it and writes nothing.
  const files = everyFile(dataDir);
  const dry = await store.publication.migrate({ expectedLiveRevisionId: b }, 'operator', {
    dryRun: true,
  });
  assert.equal(dry.kind, 'planned');
  if (dry.kind !== 'planned') return;
  const { plan } = dry;
  assert.deepEqual([plan.fromRevisionId, plan.from, plan.to], [b, CURRENT_VERSIONS, NEXT_VERSIONS]);
  assert.deepEqual(
    plan.changed.map((document) => [document.document, document.file]),
    [['portfolio', 'portfolio.yml']],
  );
  const before = readFileSync(
    path.join(older.paths.revision(b), 'documents/portfolio.yml'),
    'utf8',
  );
  assert.equal(plan.changed[0]!.before, before);
  assert.equal(plan.ids.length, 1);
  assert.deepEqual([plan.needs, plan.secrets], [[], []]);
  assert.deepEqual(everyFile(dataDir), files);
  assert.equal(logs.length, 0, 'a dry run takes no lock and logs nothing');

  const run = committed(await store.publication.migrate({ expectedLiveRevisionId: b }, 'operator'));
  // The same plan, so the same minted ids, as the dry run's.
  assert.deepEqual(run.plan, plan);
  const manifest = await readManifest(nodeFs, store.paths, run.revisionId);
  assert.ok(manifest);
  assert.deepEqual(
    [manifest.parentRevisionId, manifest.source, manifest.createdBy],
    [b, { kind: 'migration' }, 'operator'],
  );
  assert.deepEqual(
    [manifest.documents.portfolio.schemaVersion, manifest.documents.site.schemaVersion],
    [NEXT, CURRENT_VERSIONS.site],
  );
  const migrated = path.join(store.paths.revision(run.revisionId), 'documents');
  const text = readFileSync(path.join(migrated, 'portfolio.yml'), 'utf8');
  assert.equal(text, plan.changed[0]!.after);
  assert.deepEqual(documentData(text).migration, {
    id: plan.ids[0]!.id,
    title: 'Ines Okafor',
  });
  // A document no step changes keeps every byte.
  assert.equal(
    readFileSync(path.join(migrated, 'site.yml'), 'utf8'),
    readFileSync(path.join(older.paths.revision(b), 'documents/site.yml'), 'utf8'),
  );

  const events = await readEvents(nodeFs, store.paths);
  assert.deepEqual(events.at(-1), {
    seq: 3,
    type: 'schema-migration',
    revisionId: run.revisionId,
    previousRevisionId: b,
    actor: 'operator',
    at: events.at(-1)!.at,
  });
  assert.deepEqual(revisionFiles(store, [a, b]), existing);
  const live = await store.publication.status();
  assert.deepEqual(
    [live.state, live.servingRevisionId, live.command],
    ['live', run.revisionId, undefined],
  );
  assert.deepEqual(
    logs.map((entry) => [entry.event, entry.revisionId, entry.seq]),
    [['store.migrate.committed', run.revisionId, 3]],
  );

  // Once it's live, there's nothing to migrate, and nothing changes.
  const after = everyFile(dataDir);
  const again = await store.publication.migrate(
    { expectedLiveRevisionId: run.revisionId },
    'operator',
  );
  assert.equal(again.kind === 'rejected' && again.code, 'nothing_to_migrate');
  assert.deepEqual(everyFile(dataDir), after);
  assert.equal(logs.at(-1)?.event, 'store.migrate.failed');
  assert.equal(logs.at(-1)?.code, 'nothing_to_migrate');
});

test('a migration that needs a value only the owner can give writes nothing, dry run or not, until a set value gives it', async (t) => {
  const engineering = pairInput('engineering');
  const untitled = {
    ...engineering,
    portfolio: {
      ...engineering.portfolio,
      sourceText: applyEdits(engineering.portfolio.sourceText, 'yaml', [
        { op: 'delete', pointer: '/meta/title' },
      ]),
    },
  };
  const { dataDir, b } = await olderStore(t, untitled);
  const store = openStore({ dataDir, checks: nextChecks() });
  const files = everyFile(dataDir);

  const need = {
    path: TITLE_PATH,
    reason: 'The old portfolio document has no meta title to carry over.',
  };
  const dry = await store.publication.migrate({ expectedLiveRevisionId: b }, 'operator', {
    dryRun: true,
  });
  assert.equal(dry.kind === 'rejected' && dry.code, 'migration_blocked');
  assert.deepEqual(dry.kind === 'rejected' && dry.plan?.needs, [need]);
  const run = await store.publication.migrate({ expectedLiveRevisionId: b }, 'operator');
  assert.equal(run.kind === 'rejected' && run.code, 'migration_blocked');
  assert.deepEqual(run.kind === 'rejected' && run.plan?.needs, [need]);
  assert.deepEqual(everyFile(dataDir), files);

  // A value with nowhere to go fails the migration, and writes nothing.
  const nowhere = await store.publication.migrate(
    { expectedLiveRevisionId: b, set: [{ path: 'portfolio.nowhere', value: 'x' }] },
    'operator',
  );
  assert.equal(nowhere.kind === 'rejected' && nowhere.code, 'migration_failed');
  assert.deepEqual(nowhere.kind === 'rejected' && nowhere.summary, [
    'A --set value has no place to go.',
  ]);
  assert.deepEqual(everyFile(dataDir), files);

  const set = [{ path: TITLE_PATH, value: 'Ines Okafor, engineer' }];
  const planned = await store.publication.migrate({ expectedLiveRevisionId: b, set }, 'operator', {
    dryRun: true,
  });
  assert.equal(planned.kind, 'planned');
  const given = committed(
    await store.publication.migrate({ expectedLiveRevisionId: b, set }, 'operator'),
  );
  assert.deepEqual(planned.kind === 'planned' && planned.plan.ids, given.plan.ids);
  const text = readFileSync(
    path.join(store.paths.revision(given.revisionId), 'documents/portfolio.yml'),
    'utf8',
  );
  assert.equal(documentData(text).migration?.title, 'Ines Okafor, engineer');
});

test('startup never migrates: an unmigrated store is incompatible or serves a compatible last known good, and names migrate-store', async (t) => {
  const { dataDir, b } = await olderStore(t);
  const reader = (checks: UnitChecks) => {
    const logs: StoreLogEntry[] = [];
    const catalog = revisionCatalogReader({ dataDir, checks, log: (entry) => logs.push(entry) });
    return { catalog, logs };
  };

  // After the upgrade, before the migration: nothing this build serves.
  const files = everyFile(dataDir);
  const upgraded = reader(nextChecks());
  const status = await upgraded.catalog.status();
  assert.deepEqual(
    [status.state, status.liveRevisionId, status.servingRevisionId, status.reason, status.command],
    ['incompatible', b, null, 'incompatible:schema.version', 'portfolio-store migrate-store'],
  );
  assert.deepEqual(upgraded.logs, [
    {
      level: 'error',
      event: 'store.catalog.incompatible',
      revisionId: b,
      code: 'incompatible:schema.version',
      command: 'portfolio-store migrate-store',
    },
  ]);
  assert.deepEqual(everyFile(dataDir), files, 'the reader writes nothing');

  // Migrated, then the older image back, as a swap that went back would:
  // the older build serves its own last known good, and migrate-store is
  // no command for a revision a newer build wrote.
  const store = openStore({ dataDir, checks: nextChecks() });
  const migrated = committed(
    await store.publication.migrate({ expectedLiveRevisionId: b }, 'operator'),
  );
  const back = reader(testChecks());
  const downgraded = await back.catalog.status();
  assert.deepEqual(
    [downgraded.state, downgraded.servingRevisionId, downgraded.reason, downgraded.command],
    ['degraded', b, 'incompatible:schema.version', undefined],
  );
  assert.equal(back.logs[0]?.event, 'store.catalog.degraded');
  assert.equal('command' in back.logs[0]!, false);

  // The older build publishes once more: the next build serves the
  // migration it already made, degraded, and names migrate-store again.
  const older = openStore({ dataDir, checks: testChecks() });
  const published = await publishInput(older, contentVariant(pairInput('engineering'), 'three'));
  const again = reader(nextChecks());
  const degraded = await again.catalog.status();
  assert.deepEqual(
    [degraded.state, degraded.liveRevisionId, degraded.servingRevisionId, degraded.command],
    ['degraded', published, migrated.revisionId, 'portfolio-store migrate-store'],
  );
  assert.deepEqual(again.logs[0], {
    level: 'warn',
    event: 'store.catalog.degraded',
    revisionId: published,
    servingRevisionId: migrated.revisionId,
    code: 'incompatible:schema.version',
    command: 'portfolio-store migrate-store',
  });
  const live = await again.catalog.getLive();
  assert.deepEqual([live.state, live.revisionId], ['degraded', migrated.revisionId]);
});

test("a server rollback to a revision an older build wrote is revision_incompatible naming the CLI's rollback --to, whose migration makes it a child that records restoredFrom", async (t) => {
  const { dataDir, older, a, b } = await olderStore(t);
  const existing = revisionFiles(older, [a, b]);
  const store = openStore({ dataDir, checks: nextChecks() });
  const migrated = committed(
    await store.publication.migrate({ expectedLiveRevisionId: b }, 'operator'),
  );
  const c = migrated.revisionId;

  for (const move of ['rollback', 'recover'] as const) {
    const refused = await owned(store)[move](
      { targetRevisionId: a, expectedLiveRevisionId: c },
      'owner',
    );
    assert.equal(refused.kind, 'rejected', move);
    if (refused.kind !== 'rejected') return;
    assert.deepEqual(
      [refused.code, refused.reason, refused.command],
      ['revision_incompatible', 'schema.version', `portfolio-store rollback --to ${a}`],
      move,
    );
    assert.deepEqual(
      refused.diagnostics.map((diagnostic) => diagnostic.code),
      ['schema.version'],
    );
  }
  assert.equal((await readLive(nodeFs, store.paths))?.revisionId, c);

  const restored = committed(
    await store.publication.migrate({ fromRevisionId: a, expectedLiveRevisionId: c }, 'operator'),
  );
  const manifest = await readManifest(nodeFs, store.paths, restored.revisionId);
  assert.deepEqual([manifest?.parentRevisionId, manifest?.source], [a, { kind: 'migration' }]);
  assert.equal(manifest?.documents.portfolio.schemaVersion, NEXT);
  const events = await readEvents(nodeFs, store.paths);
  assert.deepEqual(events.at(-1), {
    seq: 4,
    type: 'rollback',
    revisionId: restored.revisionId,
    previousRevisionId: c,
    actor: 'operator',
    at: events.at(-1)!.at,
    restoredFrom: a,
  });
  assert.deepEqual(revisionFiles(store, [a, b]), existing);
  assert.equal((await store.publication.status()).servingRevisionId, restored.revisionId);

  // The live revision is migrate-store's, and one at this build's schema
  // rolls back as it is.
  const live = await store.publication.migrate(
    { fromRevisionId: restored.revisionId, expectedLiveRevisionId: restored.revisionId },
    'operator',
  );
  assert.equal(live.kind === 'rejected' && live.code, 'nothing_to_publish');
  const current = await store.publication.migrate(
    { fromRevisionId: c, expectedLiveRevisionId: restored.revisionId },
    'operator',
  );
  assert.equal(current.kind === 'rejected' && current.code, 'nothing_to_migrate');
  const plain = await owned(store).rollback(
    { targetRevisionId: c, expectedLiveRevisionId: restored.revisionId },
    'owner',
  );
  assert.equal(plain.kind, 'committed');

  // To the older build, the migrated revisions are a newer build's: no command.
  const back = openStore({ dataDir, checks: testChecks() });
  const newer = await owned(back).rollback(
    { targetRevisionId: restored.revisionId, expectedLiveRevisionId: c },
    'owner',
  );
  assert.equal(newer.kind, 'rejected');
  if (newer.kind !== 'rejected') return;
  assert.deepEqual(
    [newer.code, newer.reason, newer.command],
    ['revision_incompatible', 'schema.version', undefined],
  );
});

test('a migration refuses a stale expectation, a build without one, what no step reads, a damaged revision, and a migrated unit that fails its check, and writes nothing', async (t) => {
  const { dataDir, a, b } = await olderStore(t);
  const files = everyFile(dataDir);
  const store = openStore({ dataDir, checks: nextChecks() });
  const refused = async (
    checks: UnitChecks,
    input: Parameters<Store['publication']['migrate']>[0],
  ) => {
    const outcomes = [];
    for (const dryRun of [true, false]) {
      outcomes.push(
        await openStore({ dataDir, checks }).publication.migrate(input, 'operator', { dryRun }),
      );
    }
    assert.deepEqual(everyFile(dataDir), files);
    return outcomes;
  };

  for (const outcome of await refused(nextChecks(), { expectedLiveRevisionId: a })) {
    assert.equal(outcome.kind === 'conflict' && outcome.code, 'live_conflict');
    assert.equal(outcome.kind === 'conflict' && outcome.liveRevisionId, b);
  }
  for (const outcome of await refused(nextChecks(testChecks(), { migration: false }), {
    expectedLiveRevisionId: b,
  })) {
    assert.equal(outcome.kind === 'rejected' && outcome.code, 'migration_unavailable');
  }
  const failing: StoreMigration = {
    migrateDocuments: () => ({
      status: 'failed',
      reasons: ['The portfolio document declares schemaVersion 7, at line 2.'],
      summary: ['The portfolio document declares a schemaVersion no migration step reads.'],
    }),
  };
  for (const outcome of await refused(
    { ...nextChecks(), migration: failing },
    { expectedLiveRevisionId: b },
  )) {
    assert.equal(outcome.kind === 'rejected' && outcome.code, 'migration_failed');
    assert.deepEqual(outcome.kind === 'rejected' && outcome.summary, [
      'The portfolio document declares a schemaVersion no migration step reads.',
    ]);
  }
  // A step whose output the next build's check refuses.
  const careless: StoreMigration = {
    migrateDocuments(unit) {
      const plan = migrateToNext(unit);
      if (plan.status !== 'ready') return plan;
      const text = applyEdits(plan.documents.portfolio.text, 'yaml', [
        { op: 'delete', pointer: '/migration/title' },
      ]);
      return { ...plan, documents: { ...plan.documents, portfolio: { text, format: 'yaml' } } };
    },
  };
  for (const outcome of await refused(
    { ...nextChecks(), migration: careless },
    { expectedLiveRevisionId: b },
  )) {
    assert.equal(outcome.kind === 'rejected' && outcome.code, 'validation_failed');
    if (outcome.kind !== 'rejected') return;
    assert.deepEqual(
      outcome.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.pointer]),
      [['schema.invalid', '/migration']],
    );
    assert.equal(outcome.plan?.fromRevisionId, b);
  }
  for (const outcome of await refused(nextChecks(), {
    fromRevisionId: newRevisionId(),
    expectedLiveRevisionId: b,
  })) {
    assert.equal(outcome.kind === 'rejected' && outcome.code, 'not_found');
  }

  // A damaged revision migrates to nothing.
  const file = path.join(store.paths.revision(a), 'documents/portfolio.yml');
  writeFileSync(file, `${readFileSync(file, 'utf8')}# changed\n`);
  const damaged = everyFile(dataDir);
  const outcome = await store.publication.migrate(
    { fromRevisionId: a, expectedLiveRevisionId: b },
    'operator',
  );
  assert.equal(outcome.kind === 'rejected' && outcome.code, 'revision_incompatible');
  assert.equal(outcome.kind === 'rejected' && outcome.reason, 'damaged:hash_mismatch');
  assert.deepEqual(everyFile(dataDir), damaged);

  // Only the operator migrates, and an empty store has nothing to.
  await assert.rejects(
    store.publication.migrate({ expectedLiveRevisionId: b }, 'owner'),
    /as the operator/,
  );
  const empty = await newStore(t, { checks: nextChecks() });
  const nothing = await empty.publication.migrate({ expectedLiveRevisionId: null }, 'operator');
  assert.equal(nothing.kind === 'rejected' && nothing.code, 'not_found');
});
