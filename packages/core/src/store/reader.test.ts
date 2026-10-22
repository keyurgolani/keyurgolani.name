import assert from 'node:assert/strict';
import {
  copyFileSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { validatePublicationUnit } from '@portfolio/schema';
import type { LiveRevision, RenderDrift } from '../catalog/port';
import type { Rendering } from '../catalog/unit';
import type { StoreLogEntry } from './common';
import type { ReadFs } from './fs-port';
import { readLive } from './pointer';
import { nodeReadFs } from './read-fs';
import { revisionCatalogReader, UNIT_CACHE_SIZE, type RevisionCatalogOptions } from './reader';
import { openStore, type Store } from './store';
import {
  contentVariant,
  newStore,
  owned,
  pairInput,
  publishInput,
  mediaDocument,
  registryChecks,
  tempDir,
  testChecks,
} from './test-support/fixtures';
import { bareImports, closure } from './test-support/imports';
import { runChild } from './test-support/spawn';

// RevisionCatalogReader (#3, item 19): what owner's visitors are served.

test('the reader imports nothing that writes, and gets the reads of node:fs alone', () => {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const reached = closure(path.join(here, 'reader.ts'));
  const names = [...reached].map((file) => path.relative(here, file)).sort();
  for (const writer of [
    'assets.ts',
    'commit.ts',
    'drafts.ts',
    'fs-port.ts',
    'lock.ts',
    'preflight.ts',
    'publication.ts',
    'server-claim.ts',
    'store.ts',
  ]) {
    assert.ok(!names.includes(writer), `the reader reaches ${writer}`);
  }
  assert.ok(names.includes('read-fs.ts') && names.includes('revisions.ts'), names.join(', '));
  // constants gives readFile() its O_NOFOLLOW.
  const READS = new Set(['readFile', 'readdir', 'stat', 'lstat', 'constants']);
  for (const file of reached) {
    for (const { specifier, names: imported } of bareImports(file)) {
      if (!/^(?:node:)?fs(?:\/promises)?$/.test(specifier)) continue;
      for (const name of imported) {
        assert.ok(
          READS.has(name),
          `${path.relative(here, file)} imports ${name} from ${specifier}`,
        );
      }
    }
    // Nor does any of them call a write on whatever port it's handed.
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      /\bfs\.(?:writeFile|rename|link|remove|mkdir|fsync|touch)\(/,
      path.relative(here, file),
    );
  }
});

function reader(store: Store, options: Partial<RevisionCatalogOptions> = {}) {
  const servable: boolean[] = [];
  const logs: StoreLogEntry[] = [];
  const catalog = revisionCatalogReader({
    dataDir: store.paths.root,
    checks: testChecks(),
    setServable: (value) => servable.push(value),
    log: (entry) => logs.push(entry),
    ...options,
  });
  return { catalog, servable, logs };
}

const served = (live: LiveRevision) =>
  live.unit ? live : assert.fail(`nothing served: ${live.state}`);

/** A ReadFs that counts what it's asked for. */
function counting(inner: ReadFs = nodeReadFs) {
  const calls: string[] = [];
  const fs: ReadFs = {
    readFile: (file) => {
      calls.push(`read ${path.basename(file)}`);
      return inner.readFile(file);
    },
    readdir: (dir) => inner.readdir(dir),
    stat: (target) => {
      calls.push(`stat ${path.basename(target)}`);
      return inner.stat(target);
    },
    lstat: (target) => {
      calls.push(`lstat ${path.basename(target)}`);
      return inner.lstat(target);
    },
  };
  return { fs, calls };
}

test('the reader serves the live revision, and the next request sees a publish from another process', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const { fs, calls } = counting();
  const { catalog, servable } = reader(store, { fs });

  const live = served(await catalog.getLive());
  assert.deepEqual([live.state, live.revisionId], ['live', first]);
  assert.equal(live.unitHash, (await readLive(nodeReadFs, store.paths))?.unitHash);
  assert.ok(Object.isFrozen(live.unit.portfolio) && Object.isFrozen(live.unit.site.appearance));
  assert.deepEqual(Object.keys(live.unit.snapshots), ['controls']);
  // While the pointer stays, each request stats live.json and reads nothing more.
  calls.length = 0;
  assert.equal(await catalog.getLive(), live);
  assert.deepEqual(calls, ['stat live.json']);

  // Another process publishes. The draft is this one's; the move is the child's.
  const created = await store.drafts.create(
    {
      documents: contentVariant(pairInput('engineering'), 'two'),
      expectedVersion: (await store.drafts.getWorking())?.version,
    },
    'owner',
  );
  assert.equal(created.kind, 'saved');
  if (created.kind !== 'saved') return;
  const child = await runChild({
    kind: 'run',
    dataDir: store.paths.root,
    steps: [
      {
        op: 'publish',
        input: {
          draftId: created.draft.draftId,
          draftVersion: created.draft.version,
          expectedLiveRevisionId: first,
        },
      },
    ],
  });
  const [step] = (
    child.result as { results: [{ ok: boolean; outcome: { kind: string; revisionId: string } }] }
  ).results;
  assert.equal(step?.outcome.kind, 'committed', child.stderr);
  const next = served(await catalog.getLive());
  assert.deepEqual([next.state, next.revisionId], ['live', step!.outcome.revisionId]);
  assert.equal(next.unit.portfolio.meta?.description, 'A portfolio, version two.');
  assert.deepEqual(servable, [true, true]);
});

test('a damaged live revision serves the last known good as degraded, and the pointer is never rewritten', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const pointer = readFileSync(store.paths.live);
  writeFileSync(
    path.join(store.paths.revision(second), 'documents', 'portfolio.yml'),
    '# damaged\n',
  );
  const { catalog, servable, logs } = reader(store);

  const live = served(await catalog.getLive());
  assert.deepEqual([live.state, live.revisionId], ['degraded', first]);
  assert.notEqual(live.unit.portfolio.meta?.description, 'A portfolio, version two.');
  assert.deepEqual(await catalog.status(), {
    state: 'degraded',
    liveRevisionId: second,
    servingRevisionId: first,
    seq: 2,
    unitHash: (await readLive(nodeReadFs, store.paths))?.unitHash,
    reason: 'damaged:hash_mismatch',
    renderDrift: null,
  });
  assert.deepEqual(readFileSync(store.paths.live), pointer);
  assert.deepEqual(servable, [true]);
  // The owner's diagnostic: one line, with the IDs and why, never content.
  assert.deepEqual(logs, [
    {
      level: 'warn',
      event: 'store.catalog.degraded',
      revisionId: second,
      servingRevisionId: first,
      code: 'damaged:hash_mismatch',
    },
  ]);

  // A pointer that can't be read serves the last known good from the log.
  writeFileSync(store.paths.live, '{"not": "a pointer"}\n');
  const unreadable = await catalog.status();
  assert.deepEqual(
    [unreadable.state, unreadable.liveRevisionId, unreadable.servingRevisionId, unreadable.reason],
    ['degraded', null, first, 'pointer_damaged'],
  );
  assert.deepEqual(servable, [true, true]);
});

test('with nothing servable the reader is incompatible or empty, and says so to the composition root', async (t) => {
  const empty = await newStore(t);
  const none = reader(empty);
  assert.deepEqual(await none.catalog.getLive(), {
    state: 'empty',
    revisionId: null,
    unitHash: null,
    unit: null,
  });
  assert.deepEqual(none.servable, [false]);

  // Until the first-start import, an empty store serves what whenEmpty does.
  const documents: LiveRevision = {
    state: 'live',
    revisionId: 'doc-0123456789ab',
    unitHash: 'sha256:0',
    unit: served(await reader(await storeWithOne(t)).catalog.getLive()).unit,
  };
  const fallback = reader(empty, { whenEmpty: { getLive: async () => documents } });
  assert.equal(await fallback.catalog.getLive(), documents);
  assert.deepEqual(
    [(await fallback.catalog.status()).state, (await fallback.catalog.status()).servingRevisionId],
    ['live', 'doc-0123456789ab'],
  );
  assert.deepEqual(fallback.servable, [true, true, true]);

  // The only revision, damaged: nothing to fall back on.
  const store = await storeWithOne(t);
  const only = (await readLive(nodeReadFs, store.paths))!.revisionId;
  writeFileSync(path.join(store.paths.revision(only), 'manifest.json'), '{');
  const broken = reader(store);
  assert.deepEqual(await broken.catalog.getLive(), {
    state: 'incompatible',
    revisionId: null,
    unitHash: null,
    unit: null,
  });
  const status = await broken.catalog.status();
  assert.deepEqual(
    [status.state, status.liveRevisionId, status.servingRevisionId, status.reason],
    ['incompatible', only, null, 'damaged:parse_failure'],
  );
  assert.deepEqual(broken.servable, [false]);
  assert.deepEqual(
    broken.logs.map((entry) => [entry.level, entry.event, entry.code]),
    [['error', 'store.catalog.incompatible', 'damaged:parse_failure']],
  );
});

async function storeWithOne(t: { after(fn: () => void): void }) {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  return store;
}

test('an unregistered variant on the live revision stays live, on the fallback composition', async (t) => {
  const store = await newStore(t, { checks: registryChecks(['missing-variant']) });
  const live = await publishInput(store, pairInput('engineering'));
  // The build no longer registers it: as served, it only warns.
  const { catalog, servable } = reader(store, { checks: registryChecks([]) });
  const served = await catalog.getLive();
  assert.deepEqual([served.state, served.revisionId], ['live', live]);
  assert.equal(served.unit?.site.appearance.variant, 'missing-variant');
  assert.deepEqual(servable, [true]);
});

test('drift between the live manifest and the build is reported, and logged once for each pointer', async (t) => {
  const store = await newStore(t);
  const live = await publishInput(store, pairInput('engineering'));
  const build: Rendering = {
    variant: { id: 'missing-variant', version: '1.1.0' },
    packs: [],
    contracts: { variant: '2' },
  };
  const renderDrift = (rendering: Rendering): RenderDrift[] =>
    rendering.variant && rendering.variant.version !== build.variant?.version
      ? [
          {
            kind: 'variant',
            id: rendering.variant.id,
            revision: rendering.variant.version,
            build: build.variant?.version ?? null,
          },
        ]
      : [];
  const { catalog, logs } = reader(store, { renderDrift });
  const expected = [{ kind: 'variant', id: 'missing-variant', revision: '1.0.0', build: '1.1.0' }];
  assert.deepEqual((await catalog.status()).renderDrift, expected);
  await catalog.getLive();
  assert.deepEqual(logs, [
    { level: 'warn', event: 'store.render-drift', revisionId: live, drift: expected },
  ]);
  // A build that matches has none.
  const same = reader(store, { renderDrift: () => [] });
  assert.equal((await same.catalog.status()).renderDrift, null);
  assert.deepEqual(same.logs, []);
});

test('the reader keeps at most four units, and validates a dropped one again', async (t) => {
  const store = await newStore(t);
  const ids = [await publishInput(store, pairInput('engineering'))];
  for (const marker of ['two', 'three', 'four', 'five']) {
    ids.push(await publishInput(store, contentVariant(pairInput('engineering'), marker)));
  }
  assert.equal(UNIT_CACHE_SIZE, 4);
  const { fs, calls } = counting();
  let validations = 0;
  const checks = testChecks({
    validateLive: (pair) => {
      validations += 1;
      return validatePublicationUnit(pair);
    },
  });
  const { catalog } = reader(store, { fs, checks });
  // Serve each of the five in turn, the way rollbacks move the pointer.
  const moveTo = async (target: string, expected: string) => {
    const outcome = await owned(store).rollback(
      { targetRevisionId: target as never, expectedLiveRevisionId: expected as never },
      'owner',
    );
    assert.equal(outcome.kind, 'committed');
  };
  await catalog.getLive();
  let current = ids[4]!;
  for (const target of [ids[0]!, ids[1]!, ids[2]!, ids[3]!]) {
    await moveTo(target, current);
    current = target;
    await catalog.getLive();
  }
  assert.equal(validations, 5);
  // ids[4] was served first and is the one dropped: serving it again checks it again.
  validations = 0;
  await moveTo(ids[4]!, current);
  assert.equal(served(await catalog.getLive()).revisionId, ids[4]);
  assert.equal(validations, 1);
  // ids[3], still kept, serves with its files read and their hashes checked
  // again, as on every move of the pointer, and isn't validated again.
  validations = 0;
  calls.length = 0;
  await moveTo(ids[3]!, ids[4]!);
  assert.equal(served(await catalog.getLive()).revisionId, ids[3]);
  assert.ok(calls.includes('read portfolio.yml'), calls.join(', '));
  assert.equal(validations, 0);
});

test('a kept unit the pointer moves back to is served only while its files, its tombstone, and its blobs still allow', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const { catalog } = reader(store);
  assert.equal(served(await catalog.getLive()).revisionId, second);
  const pointsAtSecond = readFileSync(store.paths.live);
  const third = await publishInput(store, contentVariant(pairInput('engineering'), 'three'));
  assert.equal(served(await catalog.getLive()).revisionId, third);

  // The pointer names the kept second again, as another process could
  // leave it, but a document of it changed on disk since it was kept.
  writeFileSync(
    path.join(store.paths.revision(second), 'documents', 'portfolio.yml'),
    '# damaged\n',
  );
  const moveBack = (bytes: Buffer) => {
    writeFileSync(`${store.paths.live}.test`, bytes);
    renameSync(`${store.paths.live}.test`, store.paths.live);
  };
  moveBack(pointsAtSecond);
  const damaged = await catalog.status();
  assert.deepEqual(
    [damaged.state, damaged.liveRevisionId, damaged.servingRevisionId, damaged.reason],
    ['degraded', second, third, 'damaged:hash_mismatch'],
  );

  // A tombstone on the kept third: the last known good is the first now.
  writeFileSync(
    store.paths.tombstone(third),
    `${JSON.stringify({ revisionId: third, removedAt: new Date().toISOString(), actor: 'operator' })}\n`,
  );
  moveBack(readFileSync(store.paths.live));
  const tombstoned = served(await catalog.getLive());
  assert.deepEqual([tombstoned.state, tombstoned.revisionId], ['degraded', first]);
});

test('the reader serves the pair its check passed, the stored text as this build parses it, while revision.get shows the stored model', async (t) => {
  const store = await newStore(t);
  const live = await publishInput(store, pairInput('engineering'));
  // A build whose parse of the same text differs from the one that published it.
  const checks = testChecks({
    validateLive: (pair) => {
      const result = validatePublicationUnit(pair);
      if (!result.pair) return result;
      const site = { ...result.pair.site, parsedBy: 'this build' } as typeof result.pair.site;
      return { ...result, pair: { ...result.pair, site } };
    },
  });
  const { catalog } = reader(store, { checks });
  const unit = served(await catalog.getLive()).unit;
  assert.equal((unit.site as unknown as { parsedBy?: string }).parsedBy, 'this build');
  const detail = await store.publication.revision(live);
  assert.equal((detail?.documents.site?.model as { parsedBy?: string }).parsedBy, undefined);
});

test('a reopened store serves the same revision through a new reader', async (t) => {
  const store = await newStore(t);
  const live = await publishInput(store, pairInput('engineering'));
  const again = openStore({ dataDir: store.paths.root, checks: testChecks() });
  assert.equal(served(await reader(again).catalog.getLive()).revisionId, live);
});

/** Swaps `file` for a link to a copy of its own bytes, outside the store. */
function linkInPlace(t: { after(fn: () => void): void }, file: string): void {
  const copy = path.join(tempDir(t, 'outside-'), path.basename(file));
  copyFileSync(file, copy);
  rmSync(file);
  symlinkSync(copy, file);
}

test('the reader reads no file through a symbolic link: a linked document or blob of the live revision serves the last known good', async (t) => {
  for (const linked of ['document', 'blob'] as const) {
    const store = await newStore(t);
    const first = await publishInput(store, pairInput('engineering'));
    const blob = await store.assets.put(Buffer.from('a blob'), 'text/plain');
    const second = await publishInput(store, {
      ...contentVariant(pairInput('engineering'), 'two'),
      media: mediaDocument([blob.sha256]),
    });
    // The same bytes, so only the link tells it apart.
    linkInPlace(
      t,
      linked === 'blob'
        ? store.paths.blob(blob.sha256)
        : path.join(store.paths.revision(second), 'documents', 'portfolio.yml'),
    );
    const live = await reader(store).catalog.getLive();
    assert.equal(live.state, 'degraded', linked);
    assert.equal(live.revisionId, first, linked);
  }
});
