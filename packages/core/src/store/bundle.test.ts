// `export-revision` and `verify-revision` (#3, item 26): a full export is
// item 19's source layout, the two documents with their stored text,
// snapshots/, media/ once #10 has a media document, and bundle.json; it
// passes verify-revision, which refuses one whose files or hashes are off.
// `--documents-only` writes the two documents alone.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { canonicalize, parseSource, PORTFOLIO_SCHEMA_VERSION } from '@portfolio/schema';
import { loadPair, readPairBytes } from '@portfolio/schema/node';
import { BUNDLE_FILE, exportRevision, verifyRevision, type Bundle } from './bundle';
import { nodeFs } from './fs-port';
import { isSha256, type RevisionId } from './layout';
import { readEvents, readLive } from './pointer';
import { readRevision } from './revisions';
import type { Store } from './store';
import { writeTombstone } from './tombstone';
import { cli, line } from './test-support/cli';
import {
  contentVariant,
  filesUnder,
  mediaDocument,
  newStore,
  owned,
  pairInput,
  publishInput,
  tempDir,
  testChecks,
} from './test-support/fixtures';

const target = (t: TestContext, name = 'export') => path.join(tempDir(t, 'store-export-'), name);
const exportOf = (store: Store, id: RevisionId | 'live', out: string, documentsOnly = false) =>
  exportRevision({ fs: nodeFs, paths: store.paths, checks: testChecks() }, id, out, {
    documentsOnly,
  });

test('a full export of live is the source layout: the stored documents, the snapshots, and bundle.json with the events that made it live', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  await owned(store).rollback({ targetRevisionId: first, expectedLiveRevisionId: second }, 'owner');
  const out = target(t);
  const outcome = await exportOf(store, 'live', out);
  assert.equal(outcome.kind, 'exported');
  if (outcome.kind !== 'exported') return;
  assert.equal(outcome.revisionId, first);
  // Until #10 there is no media document, so no media/.
  assert.deepEqual(filesUnder(out), [
    'bundle.json',
    'portfolio.yml',
    'site.yml',
    'snapshots/controls.json',
  ]);

  const read = await readRevision(nodeFs, store.paths, first);
  assert.ok(read.ok);
  if (!read.ok) return;
  const { unit, manifest } = read.revision;
  assert.equal(readFileSync(path.join(out, 'portfolio.yml'), 'utf8'), unit.portfolio.sourceText);
  assert.equal(readFileSync(path.join(out, 'site.yml'), 'utf8'), unit.site.sourceText);
  assert.equal(
    readFileSync(path.join(out, 'snapshots/controls.json'), 'utf8'),
    canonicalize(unit.snapshots.controls),
  );

  const bundle = JSON.parse(readFileSync(path.join(out, BUNDLE_FILE), 'utf8')) as Bundle;
  assert.equal(bundle.revisionId, first);
  assert.equal(bundle.unitHash, manifest.unitHash);
  assert.deepEqual(bundle.documents.portfolio, {
    file: 'portfolio.yml',
    format: 'yaml',
    schemaVersion: PORTFOLIO_SCHEMA_VERSION,
    sourceHash: manifest.documents.portfolio.sourceHash,
    contentHash: manifest.documents.portfolio.contentHash,
  });
  assert.deepEqual(bundle.snapshots, {
    controls: {
      file: 'snapshots/controls.json',
      contentHash: manifest.snapshots.controls!.contentHash,
    },
  });
  assert.deepEqual(bundle.blobs, []);
  const events = await readEvents(nodeFs, store.paths);
  assert.deepEqual(
    bundle.events.map((event) => [event.seq, event.type]),
    [
      [1, 'publish'],
      [3, 'rollback'],
    ],
  );
  assert.deepEqual(
    bundle.events,
    events.filter((event) => event.revisionId === first),
  );
});

test("a full export passes verify-revision, and #4's pair loader reads it as a source directory", async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const out = target(t);
  assert.equal((await exportOf(store, 'live', out)).kind, 'exported');
  const report = await verifyRevision({ fs: nodeFs, checks: testChecks() }, out);
  assert.deepEqual(report.problems, []);
  assert.ok(
    loadPair(out).ok,
    'the documents read as a pair, snapshots/ and bundle.json beside them',
  );
  assert.ok(readPairBytes(out).ok);

  const run = await cli(['verify-revision', out], { readSource: readPairBytes });
  assert.equal(run.code, 0, run.out);
  assert.match(
    run.out,
    /checks out: every file and hash, unit hash sha256:[0-9a-f]{64}, and it serves under this build\.$/m,
  );
});

test('verify-revision refuses a changed byte, a missing or extra file, a bundle.json that names another path, and a pair that does not serve', async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const exported = target(t);
  assert.equal((await exportOf(store, 'live', exported)).kind, 'exported');
  const variant = (change: (dir: string) => void) => {
    const dir = target(t, 'variant');
    for (const file of filesUnder(exported)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), readFileSync(path.join(exported, file)));
    }
    change(dir);
    return dir;
  };
  const bundle = JSON.parse(readFileSync(path.join(exported, BUNDLE_FILE), 'utf8')) as Bundle;
  const codes = async (dir: string) =>
    (await verifyRevision({ fs: nodeFs, checks: testChecks() }, dir)).problems.map((problem) => [
      problem.code,
      problem.path,
    ]);

  assert.deepEqual(
    await codes(
      variant((dir) => writeFileSync(path.join(dir, 'site.yml'), '# edited\n', { flag: 'a' })),
    ),
    [['hash_mismatch', 'site.yml']],
  );
  assert.deepEqual(
    await codes(variant((dir) => rmSync(path.join(dir, 'snapshots/controls.json')))),
    [['file_missing', 'snapshots/controls.json']],
  );
  // A second portfolio document would make the pair source.duplicate under read-only.
  assert.deepEqual(
    await codes(variant((dir) => writeFileSync(path.join(dir, 'portfolio.json'), '{}'))),
    [['unexpected_file', 'portfolio.json']],
  );
  assert.deepEqual(await codes(variant((dir) => rmSync(path.join(dir, BUNDLE_FILE)))), [
    ['bundle_unreadable', BUNDLE_FILE],
  ]);
  const elsewhere = {
    ...bundle,
    documents: { ...bundle.documents, site: { ...bundle.documents.site, file: '../site.yml' } },
  };
  assert.deepEqual(
    await codes(
      variant((dir) => writeFileSync(path.join(dir, BUNDLE_FILE), JSON.stringify(elsewhere))),
    ),
    [['bundle_unreadable', BUNDLE_FILE]],
  );
  const rehashed = { ...bundle, unitHash: `sha256:${'0'.repeat(64)}` };
  assert.deepEqual(
    await codes(
      variant((dir) => writeFileSync(path.join(dir, BUNDLE_FILE), JSON.stringify(rehashed))),
    ),
    [['unit_hash_mismatch', BUNDLE_FILE]],
  );

  // A build that refuses the pair can't serve the export, whatever its hashes say.
  const refusing = testChecks({
    validate: (pair) => ({
      ...testChecks().validate(pair),
      diagnostics: [
        {
          code: 'schema.version',
          severity: 'blocks-preview',
          document: 'site',
          pointer: '/schemaVersion',
          message: 'Too new.',
          remediation: 'Upgrade.',
        },
      ],
    }),
  });
  const refused = await verifyRevision({ fs: nodeFs, checks: refusing }, exported);
  assert.deepEqual(
    refused.problems.map((problem) => [problem.code, problem.diagnostic?.code]),
    [['does_not_serve', 'schema.version']],
  );
  const run = await cli(
    ['verify-revision', variant((dir) => writeFileSync(path.join(dir, 'x'), ''))],
    {
      readSource: readPairBytes,
    },
  );
  assert.equal(run.code, 1);
  assert.match(run.out, /^problem: unexpected_file x$/m);
});

test('--documents-only writes the two documents alone, which verify-revision refuses for want of bundle.json', async (t) => {
  const store = await newStore(t);
  const parsed = parseSource(pairInput('engineering').portfolio.sourceText, 'yaml');
  assert.ok(parsed.ok);
  const json = await publishInput(store, {
    portfolio: {
      format: 'json',
      sourceText: `${JSON.stringify(parsed.ok && parsed.data, null, 2)}\n`,
    },
    site: pairInput('engineering').site,
  });
  const out = target(t);
  const outcome = await exportOf(store, json, out, true);
  assert.equal(outcome.kind, 'exported');
  assert.deepEqual(filesUnder(out), ['portfolio.json', 'site.yml']);
  const report = await verifyRevision({ fs: nodeFs, checks: testChecks() }, out);
  assert.deepEqual(
    report.problems.map((problem) => problem.code),
    ['bundle_unreadable'],
  );

  const run = await cli(['export-revision', json, '--out', target(t, 'cli'), '--documents-only'], {
    dataDir: store.paths.root,
    readSource: readPairBytes,
  });
  assert.equal(run.code, 0, run.err);
  assert.match(run.out, /isn't for switching owner to read-only: export it in full for that\.$/m);
});

test("a media document goes to media/media.json, and #10's export blobs to media/blobs/<hex>", async (t) => {
  const store = await newStore(t);
  const rendition = await store.assets.put(Buffer.from('a rendition'), 'image/webp');
  const original = await store.assets.put(Buffer.from('an original'), 'image/jpeg');
  const media = mediaDocument([rendition.sha256, original.sha256]);
  await publishInput(store, { ...pairInput('engineering'), media });
  // #10's exportBlobs: renditions, never image originals.
  const checks = testChecks({ exportBlobs: () => [rendition.sha256] });
  const out = target(t);
  const outcome = await exportRevision({ fs: nodeFs, paths: store.paths, checks }, 'live', out);
  assert.equal(outcome.kind, 'exported');
  const hex = rendition.sha256.slice('sha256:'.length);
  assert.deepEqual(filesUnder(out), [
    'bundle.json',
    `media/blobs/${hex}`,
    'media/media.json',
    'portfolio.yml',
    'site.yml',
    'snapshots/controls.json',
  ]);
  assert.equal(readFileSync(path.join(out, 'media/media.json'), 'utf8'), media.sourceText);
  assert.deepEqual(readFileSync(path.join(out, 'media/blobs', hex)), Buffer.from('a rendition'));
  assert.deepEqual((await verifyRevision({ fs: nodeFs, checks }, out)).problems, []);
  writeFileSync(path.join(out, 'media/blobs', hex), 'swapped');
  assert.deepEqual(
    (await verifyRevision({ fs: nodeFs, checks }, out)).problems.map((problem) => [
      problem.code,
      problem.path,
    ]),
    [['hash_mismatch', `media/blobs/${hex}`]],
  );
  const bundle = JSON.parse(readFileSync(path.join(out, BUNDLE_FILE), 'utf8')) as Bundle;
  assert.ok(bundle.documents.media && isSha256(bundle.documents.media.contentHash));
});

test('export refuses an empty store, a tombstoned or unknown revision, a target in use, and the data directory', async (t) => {
  const store = await newStore(t);
  assert.deepEqual(await exportOf(store, 'live', target(t)), { kind: 'refused', code: 'empty' });
  const first = await publishInput(store, pairInput('engineering'));
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  await writeTombstone(
    nodeFs,
    store.paths,
    { revisionId: first, removedAt: new Date().toISOString(), actor: 'operator' },
    'test',
  );
  assert.deepEqual(await exportOf(store, first, target(t)), { kind: 'refused', code: 'not_found' });
  assert.deepEqual(await exportOf(store, `rev_${'0'.repeat(32)}`, target(t)), {
    kind: 'refused',
    code: 'not_found',
  });
  const busy = target(t);
  mkdirSync(busy);
  writeFileSync(path.join(busy, 'keep'), '');
  assert.deepEqual(await exportOf(store, 'live', busy), {
    kind: 'refused',
    code: 'target_not_empty',
  });
  assert.deepEqual(await exportOf(store, 'live', path.join(store.paths.root, 'out')), {
    kind: 'refused',
    code: 'target_overlaps',
  });

  const live = (await readLive(nodeFs, store.paths))!;
  const run = await cli(['export-revision', 'live', '--out', target(t, 'cli')], {
    dataDir: store.paths.root,
    readSource: readPairBytes,
  });
  assert.equal(run.code, 0, run.err);
  assert.equal(line(run.out, 'unit hash'), live.unitHash);
  assert.match(
    run.out,
    /^Check it with verify-revision before you serve it under read-only as PORTFOLIO_SOURCE_DIR\.$/m,
  );
  assert.equal(
    (
      await cli(['export-revision', 'latest', '--out', 'x'], {
        dataDir: store.paths.root,
        readSource: readPairBytes,
      })
    ).code,
    2,
  );
});
