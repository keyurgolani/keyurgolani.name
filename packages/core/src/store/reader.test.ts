import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
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
import { nodeFs, type FsPort, type ReadFs } from './fs-port';
import { newRevisionId, type StorePaths } from './layout';
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

/** The values the servable flag took, in order, each run of one value as one. */
const flags = (values: readonly boolean[]) =>
  values.filter((value, index) => index === 0 || value !== values[index - 1]);

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
  // Every request sets the flag from the decision it got, a kept one too.
  assert.deepEqual(flags(servable), [true]);
  const before = servable.length;
  await catalog.getLive();
  assert.equal(servable.length, before + 1);
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
  assert.deepEqual(flags(servable), [true]);
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
  assert.deepEqual(flags(servable), [true]);
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
  assert.deepEqual(flags(none.servable), [false]);

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
  assert.deepEqual(flags(fallback.servable), [true]);

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
  assert.deepEqual(flags(broken.servable), [false]);
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

test('the reader reads no revision through a linked directory: its own, documents/, snapshots/, or revisions/ is damaged:unreadable', async (t) => {
  for (const linked of ['its own', 'documents/', 'snapshots/', 'revisions/'] as const) {
    const store = await newStore(t);
    const first = await publishInput(store, pairInput('engineering'));
    const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
    const own = store.paths.revision(second);
    const dir = {
      'its own': own,
      'documents/': path.join(own, 'documents'),
      'snapshots/': path.join(own, 'snapshots'),
      'revisions/': store.paths.revisions,
    }[linked];
    // A copy, with the same bytes, so only the link tells it apart.
    const copy = path.join(tempDir(t, 'outside-'), path.basename(dir));
    cpSync(dir, copy, { recursive: true });
    rmSync(dir, { recursive: true });
    symlinkSync(copy, dir);
    const { catalog } = reader(store);
    const live = await catalog.getLive();
    const status = await catalog.status();
    if (linked === 'revisions/') {
      // Every revision is read through it, so none serves.
      assert.deepEqual([live.state, status.reason], ['incompatible', 'damaged:unreadable'], linked);
    } else {
      assert.deepEqual(
        [live.state, live.revisionId, status.reason],
        ['degraded', first, 'damaged:unreadable'],
        linked,
      );
    }
  }
});

/** A renderDrift that walks every field of a rendering, as apps/web's does. */
const walkingDrift = (rendering: Rendering): RenderDrift[] => [
  ...(rendering.variant
    ? [
        {
          kind: 'variant' as const,
          id: rendering.variant.id,
          revision: rendering.variant.version,
          build: null,
        },
      ]
    : []),
  ...rendering.packs.map((pack) => ({
    kind: 'pack' as const,
    id: pack.id,
    revision: pack.version,
    build: null,
  })),
  ...Object.entries(rendering.contracts).map(([id, version]) => ({
    kind: 'contract' as const,
    id,
    revision: version,
    build: null,
  })),
];

test("a live manifest whose rendering a reader can't walk is damaged, and the last known good serves, with no throw", async (t) => {
  const odd: Array<[string, (rendering: Record<string, unknown>) => unknown]> = [
    [
      'no contracts',
      (rendering) =>
        Object.fromEntries(Object.entries(rendering).filter(([key]) => key !== 'contracts')),
    ],
    ['a null pack', (rendering) => ({ ...rendering, packs: [null] })],
    ['a variant with no version', (rendering) => ({ ...rendering, variant: { id: 'x' } })],
    ['a contract that is not a string', (rendering) => ({ ...rendering, contracts: { a: 1 } })],
    ['no rendering at all', () => null],
  ];
  for (const [what, change] of odd) {
    const store = await newStore(t);
    const first = await publishInput(store, pairInput('engineering'));
    const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
    const file = path.join(store.paths.revision(second), 'manifest.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(
      file,
      JSON.stringify({ ...manifest, rendering: change(manifest.rendering as never) }),
    );
    const { catalog } = reader(store, { renderDrift: walkingDrift });
    const live = await catalog.getLive();
    assert.equal(live.state, 'degraded', what);
    assert.equal(live.revisionId, first, what);
    assert.equal((await catalog.status()).reason, 'damaged:parse_failure', what);
  }
});

test("a live file that's there but can't be read, for EACCES, EISDIR, or a link, is damaged:unreadable, and the last known good serves", async (t) => {
  const cases: Array<[string, (file: string) => void]> = [
    ['unreadable', (file) => chmodSync(file, 0o000)],
    [
      'a directory in its place',
      (file) => {
        rmSync(file);
        mkdirSync(file);
      },
    ],
    ['a link in its place', (file) => linkInPlace(t, file)],
  ];
  for (const [what, spoil] of cases) {
    const store = await newStore(t);
    const first = await publishInput(store, pairInput('engineering'));
    const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
    const file = path.join(store.paths.revision(second), 'documents', 'portfolio.yml');
    spoil(file);
    t.after(() => {
      try {
        chmodSync(file, 0o600);
      } catch {
        // Not a file any more.
      }
    });
    const { catalog } = reader(store);
    const live = await catalog.getLive();
    assert.equal(live.state, 'degraded', what);
    assert.equal(live.revisionId, first, what);
    assert.equal((await catalog.status()).reason, 'damaged:unreadable', what);
  }
});

test("an event file that can't be read is left out of the last known good's walk, as an unparseable one is", async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const third = await publishInput(store, contentVariant(pairInput('engineering'), 'three'));
  writeFileSync(
    path.join(store.paths.revision(third), 'documents', 'portfolio.yml'),
    '# damaged\n',
  );
  // seq 2's own file, a link: the walk passes over it to seq 1.
  linkInPlace(t, store.paths.event(2));
  const live = await reader(store).catalog.getLive();
  assert.equal(live.state, 'degraded');
  assert.equal(live.revisionId, first);
});

test("a decision that fails is kept as nothing servable: requests over a log that can't be listed decide once, and never throw", async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  writeFileSync(
    path.join(store.paths.revision(second), 'documents', 'portfolio.yml'),
    '# damaged\n',
  );
  let listings = 0;
  const fs: ReadFs = {
    ...nodeReadFs,
    async readdir(dir) {
      if (dir !== store.paths.events) return nodeReadFs.readdir(dir);
      listings += 1;
      throw Object.assign(new Error(`EACCES: ${dir}`), { code: 'EACCES' });
    },
  };
  let validations = 0;
  const checks = testChecks({
    validateLive: (pair) => {
      validations += 1;
      return validatePublicationUnit(pair);
    },
  });
  const { catalog, servable, logs } = reader(store, { fs, checks });
  for (let request = 0; request < 5; request++) {
    const live = await catalog.getLive();
    assert.equal(live.state, 'incompatible');
    assert.equal(live.unit, null);
  }
  // One decision for all five: the log listed once, and nothing validated,
  // since the damaged live revision fails its hashes first.
  assert.equal(listings, 1);
  assert.equal(validations, 0);
  assert.ok(servable.length > 0 && servable.every((value) => value === false));
  assert.equal((await catalog.status()).reason, 'storage_unavailable');
  // The log line says what, never where.
  assert.ok(logs.every((entry) => !JSON.stringify(entry).includes(store.paths.root)));
  assert.ok(logs.some((entry) => entry.event === 'store.catalog.incompatible'));
});

test("of two decisions in flight, only the later pointer's sets the flag, whichever finishes last, and every later request keeps it set", async (t) => {
  for (const order of ['nothing servable, then live', 'live, then nothing servable'] as const) {
    const store = await newStore(t);
    const first = await publishInput(store, pairInput('engineering'));
    const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
    const damage = (id: Parameters<typeof store.paths.revision>[0]) =>
      writeFileSync(
        path.join(store.paths.revision(id), 'documents', 'portfolio.yml'),
        '# damaged\n',
      );
    // Reads of the revisions in `slow` wait for `release`.
    let slow = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fs: ReadFs = {
      ...nodeReadFs,
      async readFile(file) {
        if ([...slow].some((id) => file.includes(id))) await gate;
        return nodeReadFs.readFile(file);
      },
    };
    const { catalog, servable } = reader(store, { fs });
    let expected: boolean;
    let early: Promise<LiveRevision>;
    if (order === 'nothing servable, then live') {
      // The first pointer's decision, nothing servable, is slow; meanwhile a good publish lands.
      damage(first);
      damage(second);
      slow = new Set([first]);
      early = catalog.getLive();
      await new Promise((resolve) => setTimeout(resolve, 50));
      slow = new Set();
      await publishInput(store, contentVariant(pairInput('engineering'), 'three'));
      expected = true;
    } else {
      // The first pointer's decision, live, is slow, past its tombstone
      // check; meanwhile the pointer moves back to the first revision, which
      // is then damaged, and the second is removed, so nothing serves.
      slow = new Set([second]);
      early = catalog.getLive();
      await new Promise((resolve) => setTimeout(resolve, 50));
      slow = new Set();
      const moved = await owned(store).rollback(
        { targetRevisionId: first, expectedLiveRevisionId: second },
        'owner',
      );
      assert.equal(moved.kind, 'committed', order);
      damage(first);
      writeFileSync(store.paths.tombstone(second), '{}\n');
      expected = false;
    }
    const later = await catalog.getLive();
    assert.equal(servable.at(-1), expected, order);
    release();
    await early;
    // The overtaken decision said nothing, and the next request keeps the latest one's flag.
    assert.equal(servable.at(-1), expected, order);
    const next = await catalog.getLive();
    assert.equal(next.state, later.state, order);
    assert.equal(servable.at(-1), expected, order);
  }
});

/** A whenEmpty that answers empty, and counts how often it's asked. */
function countingEmpty() {
  const seen = { asked: 0 };
  const whenEmpty = {
    getLive: async (): Promise<LiveRevision> => {
      seen.asked += 1;
      return { state: 'empty', revisionId: null, unitHash: null, unit: null };
    },
  };
  return { seen, whenEmpty };
}

test('live.json gone from a store that has published serves the last known good as pointer_damaged, logged at error, and never whenEmpty', async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const pointer = readFileSync(store.paths.live);
  rmSync(store.paths.live);
  let listings = 0;
  const fs: ReadFs = {
    ...nodeReadFs,
    readdir(dir) {
      listings += 1;
      return nodeReadFs.readdir(dir);
    },
  };
  const { seen, whenEmpty } = countingEmpty();
  const { catalog, servable, logs } = reader(store, { fs, whenEmpty });

  const live = served(await catalog.getLive());
  assert.deepEqual([live.state, live.revisionId], ['degraded', second]);
  assert.deepEqual(await catalog.status(), {
    state: 'degraded',
    liveRevisionId: null,
    servingRevisionId: second,
    seq: null,
    unitHash: null,
    reason: 'pointer_damaged',
    renderDrift: null,
  });
  assert.equal(seen.asked, 0);
  assert.deepEqual(flags(servable), [true]);
  assert.deepEqual(
    logs.map((entry) => [entry.level, entry.event, entry.code]),
    [
      ['error', 'store.pointer.missing', 'pointer_damaged'],
      ['warn', 'store.catalog.degraded', 'pointer_damaged'],
    ],
  );
  // Decided once: the requests after it list nothing.
  const listed = listings;
  for (let request = 0; request < 3; request++) await catalog.getLive();
  assert.equal(listings, listed);

  // With live.json back, the revision it names is live.
  writeFileSync(store.paths.live, pointer);
  assert.equal((await catalog.getLive()).state, 'live');
  rmSync(store.paths.live);
  assert.equal((await catalog.status()).reason, 'pointer_damaged');

  // Every trace of a publish gone as well, the store is empty, and whenEmpty answers each request.
  for (const dir of [store.paths.events, store.paths.revisions]) {
    for (const name of readdirSync(dir)) rmSync(path.join(dir, name), { recursive: true });
  }
  assert.equal((await catalog.getLive()).state, 'empty');
  await catalog.getLive();
  assert.equal(seen.asked, 2);
});

test("without live.json, an event, one moved aside, or a tombstone says the store has published, and a revision alone, a publish's staging, or a temporary file doesn't", async (t) => {
  const id = newRevisionId();
  const cases: Array<[string, (paths: StorePaths) => void, boolean]> = [
    ['an event', (paths) => writeFileSync(paths.event(1), '{}\n'), true],
    [
      'an event moved aside',
      (paths) => writeFileSync(path.join(paths.events, '1.aside-0a1b2c3d4e5f.json'), '{}\n'),
      true,
    ],
    // Never live: its publish wrote neither its pointer nor its event.
    ['a revision alone', (paths) => mkdirSync(paths.revision(id)), false],
    ['a tombstone', (paths) => writeFileSync(paths.tombstone(id), '{}\n'), true],
    ["a publish's staging", (paths) => mkdirSync(paths.staging(id)), false],
    [
      'a temporary file',
      (paths) => writeFileSync(path.join(paths.events, '.1.json.0a1b2c3d4e5f.tmp'), '{}\n'),
      false,
    ],
  ];
  for (const [what, add, published] of cases) {
    const store = await newStore(t);
    add(store.paths);
    const { seen, whenEmpty } = countingEmpty();
    const { catalog, logs } = reader(store, { whenEmpty });
    const status = await catalog.status();
    if (published) {
      // Nothing it holds serves, so nothing does.
      assert.deepEqual(
        [status.state, status.reason, seen.asked],
        ['incompatible', 'pointer_damaged', 0],
        what,
      );
      assert.ok(
        logs.some((entry) => entry.level === 'error' && entry.event === 'store.pointer.missing'),
        what,
      );
    } else {
      assert.deepEqual([status.state, seen.asked], ['empty', 1], what);
      assert.deepEqual(logs, [], what);
    }
  }
});

test("a live.json, or with none an events/, that can't be looked at decides all the same, and never throws", async (t) => {
  for (const target of ['live', 'events'] as const) {
    const store = await newStore(t);
    const only = await publishInput(store, pairInput('engineering'));
    // events/ and revisions/ key the decision only while there's no live.json.
    if (target === 'events') rmSync(store.paths.live);
    const fs: ReadFs = {
      ...nodeReadFs,
      async stat(file) {
        if (file === store.paths[target]) {
          throw Object.assign(new Error(`EACCES: ${file}`), { code: 'EACCES' });
        }
        return nodeReadFs.stat(file);
      },
    };
    const { catalog } = reader(store, { fs });
    const status = await catalog.status();
    if (target === 'live') {
      // Nor can the decision read it: nothing serves, and the code says why.
      assert.deepEqual([status.state, status.reason], ['incompatible', 'storage_unavailable']);
    } else {
      assert.deepEqual(
        [status.state, status.servingRevisionId, status.reason],
        ['degraded', only, 'pointer_damaged'],
      );
    }
  }
});

test("a first publish that fails or dies before its pointer leaves the store empty, whenEmpty serving, and so does the moment before a good one's pointer lands", async (t) => {
  const mounted: LiveRevision = {
    state: 'live',
    revisionId: 'doc-0123456789ab',
    unitHash: 'sha256:0',
    unit: served(await reader(await storeWithOne(t)).catalog.getLive()).unit,
  };
  const whenEmpty = { getLive: async () => mounted };
  const failing = (point: string, act: () => Promise<void>): FsPort => ({
    ...nodeFs,
    async writeFile(file, data, at, options) {
      if (at === point) await act();
      return nodeFs.writeFile(file, data, at, options);
    },
  });

  // Its pointer write fails, as on a full disk: a revision is left, with no pointer and no event.
  const full = await newStore(t);
  const failed = openStore({
    dataDir: full.paths.root,
    checks: testChecks(),
    fs: failing('publish.live.write', async () => {
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    }),
  });
  await assert.rejects(publishInput(failed, pairInput('engineering')));
  // A process killed at the same point leaves the same.
  const killed = await newStore(t);
  const child = await runChild({
    kind: 'run',
    dataDir: killed.paths.root,
    crash: { point: 'publish.live.write', nth: 1 },
    steps: [{ op: 'publishDocuments', documents: pairInput('engineering') }],
  });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  for (const store of [full, killed]) {
    assert.equal(readdirSync(store.paths.revisions).length, 1);
    assert.deepEqual(readdirSync(store.paths.events), []);
    // Served now, and again by a new reader, as after a restart.
    for (let start = 0; start < 2; start++) {
      const { catalog, servable, logs } = reader(store, { whenEmpty });
      assert.equal(await catalog.getLive(), mounted);
      assert.equal((await catalog.status()).state, 'live');
      assert.deepEqual(flags(servable), [true]);
      assert.deepEqual(logs, []);
    }
  }

  // A good first publish, held just before its pointer's write: meanwhile whenEmpty serves.
  const fresh = await newStore(t);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const atPointer = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const held = openStore({
    dataDir: fresh.paths.root,
    checks: testChecks(),
    fs: failing('publish.live.write', async () => {
      reached();
      await gate;
    }),
  });
  const { catalog, servable, logs } = reader(fresh, { whenEmpty });
  const publishing = publishInput(held, pairInput('engineering'));
  await atPointer;
  assert.equal(await catalog.getLive(), mounted);
  release();
  const published = await publishing;
  const live = await catalog.getLive();
  assert.deepEqual([live.state, live.revisionId], ['live', published]);
  assert.deepEqual(flags(servable), [true]);
  assert.deepEqual(logs, []);
});
