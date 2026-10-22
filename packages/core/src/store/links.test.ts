// Symbolic links planted in the data directory (#3, from #50's review): the
// store never writes, reads, chmods, or deletes through one, so nothing
// outside the store is created, changed, or removed.
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { nodeFs } from './fs-port';
import { sha256 } from '../catalog/unit';
import {
  contentVariant,
  newStore,
  owned,
  pairInput,
  publishInput,
  tempDir,
} from './test-support/fixtures';

const loop = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ELOOP';

test('the FsPort writes, reads, and chmods nothing through a symbolic link', async (t) => {
  const root = tempDir(t);
  const outside = path.join(root, 'outside');
  mkdirSync(outside, { mode: 0o755 });
  const kept = path.join(outside, 'kept.txt');
  writeFileSync(kept, "not the store's\n");

  // A dangling link, and one to a file outside.
  const dangling = path.join(root, 'dangling');
  symlinkSync(path.join(outside, 'made-through-a-link'), dangling);
  await assert.rejects(nodeFs.writeFile(dangling, 'x', 'test.write'), loop);
  await assert.rejects(nodeFs.writeFile(dangling, 'x', 'test.write', { exclusive: true }));
  assert.equal(existsSync(path.join(outside, 'made-through-a-link')), false);
  const toKept = path.join(root, 'to-kept');
  symlinkSync(kept, toKept);
  await assert.rejects(nodeFs.writeFile(toKept, 'overwritten', 'test.write'), loop);
  await assert.rejects(nodeFs.readFile(toKept), loop);
  await assert.rejects(
    new Promise((resolve, reject) => {
      nodeFs.createReadStream(toKept).on('error', reject).on('data', resolve);
    }),
    loop,
  );
  assert.equal(readFileSync(kept, 'utf8'), "not the store's\n");

  // mkdir() refuses a link where a directory should be, and leaves its target's mode.
  const toOutside = path.join(root, 'to-outside');
  symlinkSync(outside, toOutside);
  await assert.rejects(nodeFs.mkdir(toOutside, 'test.mkdir'), loop);
  assert.equal(statSync(outside).mode & 0o777, 0o755);

  // touch() touches the link, not what it points at.
  const old = (Date.now() - 60 * 60_000) / 1000;
  utimesSync(kept, old, old);
  await nodeFs.touch(toKept, 'test.touch');
  assert.ok(Date.now() - statSync(kept).mtimeMs > 30 * 60_000);
  assert.equal((await nodeFs.lstat(toKept))?.isSymbolicLink, true);
  assert.equal((await nodeFs.stat(toKept))?.isSymbolicLink, false);
});

test('a link planted where publish writes live.json never sends a write outside the store', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const outside = tempDir(t, 'store-outside-');
  const target = path.join(outside, 'live-through-a-link.json');
  symlinkSync(target, path.join(store.paths.publication, 'live.json.tmp'));
  const working = await store.drafts.getWorking();
  const created = await store.drafts.create(
    {
      documents: contentVariant(pairInput('engineering'), 'two'),
      ...(working ? { expectedVersion: working.version } : {}),
    },
    'owner',
  );
  if (created.kind !== 'saved') return assert.fail();
  await owned(store)
    .publish(
      { draftId: created.draft.draftId, draftVersion: 1, expectedLiveRevisionId: first },
      'owner',
    )
    .catch(() => {});
  assert.equal(existsSync(target), false);
  assert.equal(lstatSync(store.paths.live).isFile(), true);
});

test('repair never goes through a linked directory, and removes only regular temporary files', async (t) => {
  const root = tempDir(t);
  const outside = path.join(root, 'outside');
  const outsideShard = path.join(root, 'outside-shard');
  const outsideRevisions = path.join(root, 'outside-revisions');
  for (const dir of [outside, outsideShard, outsideRevisions]) mkdirSync(dir);
  writeFileSync(path.join(outside, '.precious.tmp'), "not the store's\n");
  writeFileSync(path.join(outsideShard, '.old-work.tmp'), "not the store's either\n");
  const old = (Date.now() - 2 * 24 * 60 * 60_000) / 1000;
  utimesSync(path.join(outsideShard, '.old-work.tmp'), old, old);
  const staging = path.join(outsideRevisions, `.staging-rev_${'0'.repeat(32)}`);
  mkdirSync(staging);
  writeFileSync(path.join(staging, 'keep.txt'), 'keep me\n');

  const store = await newStore(t);
  // drafts/ and revisions/ swapped for links after startup, and an asset
  // shard and a temporary file that are links.
  renameSync(store.paths.drafts, path.join(root, 'drafts-was-here'));
  symlinkSync(outside, store.paths.drafts);
  renameSync(store.paths.revisions, path.join(root, 'revisions-was-here'));
  symlinkSync(outsideRevisions, store.paths.revisions);
  symlinkSync(outsideShard, path.join(store.paths.assets, 'ab'));
  const outsideFile = path.join(root, 'outside-file.txt');
  writeFileSync(outsideFile, 'keep me too\n');
  symlinkSync(outsideFile, path.join(store.paths.events, '.linked.tmp'));

  const report = await store.publication.repair();
  assert.equal(report.stagingRemoved, 0);
  assert.equal(report.tempsRemoved, 0);
  assert.equal(existsSync(path.join(outside, '.precious.tmp')), true);
  assert.equal(existsSync(path.join(outsideShard, '.old-work.tmp')), true);
  assert.equal(existsSync(path.join(staging, 'keep.txt')), true);
  assert.equal(readFileSync(outsideFile, 'utf8'), 'keep me too\n');
  // A temporary name on what isn't a regular file isn't a crash's temporary file.
  assert.equal(lstatSync(path.join(store.paths.events, '.linked.tmp')).isSymbolicLink(), true);

  // In a real revisions/, a .staging-* that's a link goes as a link only.
  const second = await newStore(t);
  const linkedStaging = path.join(second.paths.revisions, `.staging-rev_${'1'.repeat(32)}`);
  symlinkSync(outsideRevisions, linkedStaging);
  const directory = path.join(second.paths.drafts, '.not-a-file.tmp');
  mkdirSync(directory);
  writeFileSync(path.join(directory, 'keep.txt'), 'keep me\n');
  const repaired = await second.publication.repair();
  assert.equal(repaired.stagingRemoved, 1);
  assert.equal(repaired.tempsRemoved, 0);
  assert.equal(existsSync(linkedStaging), false);
  assert.equal(existsSync(path.join(staging, 'keep.txt')), true);
  assert.equal(existsSync(path.join(directory, 'keep.txt')), true);
});

test("a blob that is a link isn't one the AssetStore holds, and a put replaces the link", async (t) => {
  const store = await newStore(t);
  const bytes = Buffer.from('a photograph, held elsewhere');
  const hash = sha256(bytes);
  const outside = tempDir(t, 'store-outside-');
  const elsewhere = path.join(outside, 'blob');
  writeFileSync(elsewhere, bytes);
  const file = store.paths.blob(hash);
  mkdirSync(path.dirname(file), { mode: 0o700 });
  symlinkSync(elsewhere, file);
  assert.equal(await store.assets.has(hash), false);
  assert.equal(await store.assets.open(hash), null);
  assert.deepEqual(await store.assets.put(bytes, 'image/jpeg'), {
    sha256: hash,
    size: bytes.byteLength,
  });
  assert.equal(lstatSync(file).isFile(), true);
  assert.equal(await store.assets.has(hash), true);
  assert.deepEqual(readFileSync(elsewhere), bytes);
});
