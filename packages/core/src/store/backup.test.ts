// `backup` and `restore` (#3, item 26, and Slice 3): a backup holds the lock,
// copies what item 2 backs up with publication/live.json last, and lists
// every file's SHA-256 in backup-manifest.json; a restore into an empty
// directory checks every hash and yields the same live revision and
// unitHash, which verify passes. ephemeral/, where #2 keeps sessions, is in
// no backup, and restore never creates it. Neither follows a link: a backup
// copies regular files only, and a restore refuses a backup holding a link
// or a special file.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { readPairBytes } from '@portfolio/schema/node';
import { BACKUP_MANIFEST, backupStore, restoreStore, type BackupManifest } from './backup';
import { nodeFs, type FsPort } from './fs-port';
import { readLive } from './pointer';
import { openStore, type Store } from './store';
import { verifyStore } from './verify';
import { cli, line } from './test-support/cli';
import { recordingFs } from './test-support/crash-fs';
import {
  contentVariant,
  filesUnder,
  mediaDocument,
  newStore,
  pairInput,
  publishInput,
  tempDir,
  testChecks,
} from './test-support/fixtures';

const readSource = (dir: string) => readPairBytes(dir);

/** A store with two live revisions, a working draft that references a blob, and #2's state beside it. */
async function seeded(t: TestContext): Promise<Store> {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const blob = await store.assets.put(Buffer.from('a photograph'), 'image/jpeg');
  const draft = await store.drafts.create(
    {
      documents: {
        ...contentVariant(pairInput('engineering'), 'draft'),
        media: mediaDocument([blob.sha256]),
      },
      expectedVersion: (await store.drafts.getWorking())?.version,
    },
    'owner',
  );
  assert.equal(draft.kind, 'saved');
  mkdirSync(path.join(store.paths.ephemeral, 'auth', 'sessions'), { recursive: true });
  writeFileSync(path.join(store.paths.ephemeral, 'auth', 'sessions', 'record.json'), '{}\n');
  writeFileSync(path.join(store.paths.ephemeral, 'auth', 'revoked-before'), '0\n');
  mkdirSync(store.paths.audit, { recursive: true });
  writeFileSync(path.join(store.paths.audit, '2026-10.jsonl'), '{"type":"logout"}\n');
  return store;
}

const target = (t: TestContext, name: string) => path.join(tempDir(t, 'store-target-'), name);

/** A FIFO at `file`: a read of it waits for a writer, for good if none comes. */
const fifo = (file: string) => execFileSync('mkfifo', [file]);

test('backup, then restore into an empty directory, yields the same live revision and unitHash, and verify passes', async (t) => {
  const store = await seeded(t);
  const live = (await readLive(nodeFs, store.paths))!;
  const out = target(t, 'b1');
  const backup = await backupStore({ fs: nodeFs, paths: store.paths, lock: store.lock }, out);
  assert.equal(backup.kind, 'done');
  if (backup.kind !== 'done') return;
  assert.deepEqual(backup.manifest.live, {
    revisionId: live.revisionId,
    seq: live.seq,
    unitHash: live.unitHash,
  });

  const into = target(t, 'restored');
  const restored = await restoreStore({ fs: nodeFs }, out, into);
  assert.equal(restored.kind, 'restored');
  const again = openStore({ dataDir: into, checks: testChecks() });
  const status = await again.publication.status();
  assert.deepEqual(
    [status.state, status.liveRevisionId, status.seq, status.unitHash],
    ['live', live.revisionId, live.seq, live.unitHash],
  );
  const report = await verifyStore({ fs: nodeFs, paths: again.paths, checks: testChecks() });
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.counts, { revisions: 2, tombstones: 0, events: 2, drafts: 1, blobs: 1 });
  // What backs up came back byte for byte.
  const backedUp = filesUnder(store.paths.root).filter(
    (file) => !file.startsWith('ephemeral/') && file !== 'publication/lock',
  );
  assert.deepEqual(filesUnder(into), backedUp);
  for (const file of backedUp) {
    assert.deepEqual(
      readFileSync(path.join(into, file)),
      readFileSync(path.join(store.paths.root, file)),
      file,
    );
  }
});

test('ephemeral/ is not in the backup, and restore never creates it', async (t) => {
  const store = await seeded(t);
  // A lock and a server claim are runtime only too.
  writeFileSync(store.paths.server, '{}\n');
  const out = target(t, 'b1');
  const backup = await backupStore({ fs: nodeFs, paths: store.paths, lock: store.lock }, out);
  assert.equal(backup.kind, 'done');
  if (backup.kind !== 'done') return;
  const files = filesUnder(out);
  assert.ok(files.length > 5);
  for (const file of files) {
    assert.doesNotMatch(
      file,
      /^ephemeral\/|^publication\/(lock|server\.json)$|\.tmp$|\.staging-/,
      file,
    );
  }
  assert.ok(backup.manifest.files.every((file) => !file.path.startsWith('ephemeral/')));

  const into = target(t, 'restored');
  assert.equal((await restoreStore({ fs: nodeFs }, out, into)).kind, 'restored');
  assert.equal(existsSync(path.join(into, 'ephemeral')), false);
  // A planted ephemeral/ file in a backup is refused, not restored.
  const planted = target(t, 'planted');
  assert.equal(
    (await backupStore({ fs: nodeFs, paths: store.paths, lock: store.lock }, planted)).kind,
    'done',
  );
  mkdirSync(path.join(planted, 'ephemeral', 'auth'), { recursive: true });
  writeFileSync(path.join(planted, 'ephemeral', 'auth', 'revoked-before'), '0\n');
  const refused = await restoreStore({ fs: nodeFs }, planted, target(t, 'again'));
  assert.deepEqual(refused, {
    kind: 'refused',
    code: 'backup_unexpected_file',
    path: 'ephemeral/auth/revoked-before',
  });
});

test('backup copies the publication log after every other file, the pointer last, then the manifest with each SHA-256, and puts the log in place in one rename', async (t) => {
  const store = await seeded(t);
  const recording = recordingFs();
  const out = target(t, 'b1');
  const writes: string[] = [];
  const renames: string[] = [];
  // The log goes under a dot directory of its own, which one rename makes publication/.
  const STAGED = /^\.publication\.[0-9a-f]{12}\.tmp(?=\/|$)/;
  const relative = (file: string) => path.relative(out, file).split(path.sep).join('/');
  const watching: FsPort = {
    ...recording.fs,
    async writeFile(file, data, point, options) {
      if (point.startsWith('backup.')) writes.push(relative(file).replace(STAGED, 'publication'));
      return recording.fs.writeFile(file, data, point, options);
    },
    async rename(from, to, point, pass) {
      if (point.startsWith('backup.')) {
        renames.push(`${relative(from).replace(STAGED, '<staged>')} -> ${relative(to)}`);
      }
      return recording.fs.rename(from, to, point, pass);
    },
  };
  const backup = await backupStore({ fs: watching, paths: store.paths, lock: store.lock }, out);
  assert.equal(backup.kind, 'done');
  if (backup.kind !== 'done') return;
  assert.deepEqual(writes.slice(-2), ['publication/live.json', BACKUP_MANIFEST]);
  assert.deepEqual(renames, ['<staged> -> publication']);
  assert.ok(
    readdirSync(out).every((name) => !name.startsWith('.')),
    'nothing staged is left',
  );
  assert.deepEqual(
    backup.manifest.files.map((file) => file.path),
    writes.slice(0, -1),
    'the manifest lists the files in the order they were written',
  );
  const manifest = JSON.parse(
    readFileSync(path.join(out, BACKUP_MANIFEST), 'utf8'),
  ) as BackupManifest;
  assert.deepEqual(manifest, backup.manifest);
  for (const file of manifest.files) {
    const bytes = readFileSync(path.join(out, file.path));
    assert.equal(file.size, bytes.byteLength, file.path);
  }
  // Each file is synced before the next.
  const points = recording.hits
    .map((hit) => hit.point)
    .filter((point) => point.startsWith('backup.'));
  assert.equal(points.filter((point) => point === 'backup.write').length, writes.length);
  assert.equal(points.filter((point) => point === 'backup.fsync').length, writes.length);
});

test('backup holds the publication lock throughout, so nothing moves the pointer while it copies', async (t) => {
  const store = await seeded(t);
  const other = openStore({ dataDir: store.paths.root, checks: testChecks(), lockWaitMs: 50 });
  const holders: (string | undefined)[] = [];
  let tried: unknown;
  const watching: FsPort = {
    ...nodeFs,
    async writeFile(file, data, point, options) {
      if (point === 'backup.write') {
        holders.push((await store.lock.holder())?.holder);
        if (tried === undefined) {
          tried = await other.lock.acquire('publish').then(
            (held) => held.release().then(() => 'acquired'),
            (error: { code?: string }) => error.code,
          );
        }
      }
      return nodeFs.writeFile(file, data, point, options);
    },
  };
  const backup = await backupStore(
    { fs: watching, paths: store.paths, lock: store.lock },
    target(t, 'b1'),
  );
  assert.equal(backup.kind, 'done');
  assert.ok(holders.length > 5);
  assert.ok(
    holders.every((holder) => holder === 'cli:backup'),
    holders.join(', '),
  );
  assert.equal(tried, 'lock_timeout');
  assert.equal(await store.lock.holder(), null, 'released once it ends');
});

test('restore refuses a non-empty target and a backup whose files or hashes are off, and leaves the target as it was', async (t) => {
  const store = await seeded(t);
  const out = target(t, 'b1');
  assert.equal(
    (await backupStore({ fs: nodeFs, paths: store.paths, lock: store.lock }, out)).kind,
    'done',
  );
  const manifest = JSON.parse(
    readFileSync(path.join(out, BACKUP_MANIFEST), 'utf8'),
  ) as BackupManifest;

  const busy = target(t, 'busy');
  mkdirSync(busy);
  writeFileSync(path.join(busy, 'keep.txt'), 'mine\n');
  assert.deepEqual(await restoreStore({ fs: nodeFs }, out, busy), {
    kind: 'refused',
    code: 'target_not_empty',
  });
  assert.deepEqual(filesUnder(busy), ['keep.txt']);

  // A copy of the backup with one change each.
  const variant = (change: (dir: string) => void) => {
    const dir = target(t, 'variant');
    mkdirSync(dir);
    for (const file of filesUnder(out)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), readFileSync(path.join(out, file)));
    }
    change(dir);
    return dir;
  };
  const document = manifest.files.find((file) => file.path.endsWith('/documents/portfolio.yml'))!;
  const cases: [string, (dir: string) => void, string, string?][] = [
    [
      'an added line',
      (dir) => writeFileSync(path.join(dir, document.path), '# changed\n', { flag: 'a' }),
      'hash_mismatch',
      document.path,
    ],
    [
      'one byte changed, the size the same',
      (dir) => {
        const file = path.join(dir, document.path);
        const bytes = readFileSync(file);
        bytes[bytes.length - 2] = bytes[bytes.length - 2] === 0x61 ? 0x62 : 0x61;
        writeFileSync(file, bytes);
      },
      'hash_mismatch',
      document.path,
    ],
    [
      'a missing file',
      (dir) => rmSync(path.join(dir, 'publication/live.json')),
      'backup_incomplete',
      'publication/live.json',
    ],
    [
      'an extra file',
      (dir) => writeFileSync(path.join(dir, 'drafts', 'stray.json'), '{}'),
      'backup_unexpected_file',
      'drafts/stray.json',
    ],
    ['no manifest', (dir) => rmSync(path.join(dir, BACKUP_MANIFEST)), 'manifest_unreadable'],
  ];
  for (const [what, change, code, where] of cases) {
    const into = target(t, 'restored');
    const outcome = await restoreStore({ fs: nodeFs }, variant(change), into);
    assert.deepEqual(outcome, { kind: 'refused', code, ...(where ? { path: where } : {}) }, what);
    assert.equal(existsSync(into), false, `${what}: nothing was written`);
  }
  // A manifest that lists a path outside what a store backs up is no manifest.
  const outside = variant((dir) => {
    const edited = {
      ...manifest,
      files: [...manifest.files, { path: '../escape', size: 0, sha256: manifest.files[0]!.sha256 }],
    };
    writeFileSync(path.join(dir, BACKUP_MANIFEST), JSON.stringify(edited));
  });
  assert.equal((await restoreStore({ fs: nodeFs }, outside, target(t, 'x'))).kind, 'refused');
});

test('backup refuses a non-empty --out and one in the data directory, and writes nothing there', async (t) => {
  const store = await seeded(t);
  const busy = target(t, 'busy');
  mkdirSync(busy);
  writeFileSync(path.join(busy, 'keep.txt'), 'mine\n');
  const lock = store.lock;
  assert.deepEqual(await backupStore({ fs: nodeFs, paths: store.paths, lock }, busy), {
    kind: 'refused',
    code: 'target_not_empty',
  });
  assert.deepEqual(filesUnder(busy), ['keep.txt']);
  const inside = path.join(store.paths.root, 'backups');
  assert.deepEqual(await backupStore({ fs: nodeFs, paths: store.paths, lock }, inside), {
    kind: 'refused',
    code: 'target_overlaps',
  });
  assert.equal(existsSync(inside), false);
});

test('the backup and restore commands print the live revision and unitHash, and say a restore brings back no session', async (t) => {
  const store = await seeded(t);
  const live = (await readLive(nodeFs, store.paths))!;
  const out = target(t, 'b1');
  const backup = await cli(['backup', '--out', out], { dataDir: store.paths.root, readSource });
  assert.equal(backup.code, 0, backup.err);
  assert.equal(line(backup.out, 'live revision'), `${live.revisionId} (seq ${live.seq})`);
  assert.equal(line(backup.out, 'unit hash'), live.unitHash);

  const into = target(t, 'restored');
  const restore = await cli(['restore', '--from', out, '--into', into], { readSource });
  assert.equal(restore.code, 0, `${restore.out}${restore.err}`);
  assert.equal(line(restore.out, 'live revision'), `${live.revisionId} (seq ${live.seq})`);
  assert.equal(line(restore.out, 'unit hash'), live.unitHash);
  assert.match(
    restore.out,
    /^The restore brings back no session: sessions live in ephemeral\/, which no backup holds\./m,
  );
  assert.match(restore.out, /every file and hash checks out/);
  const status = await cli(['status'], { dataDir: into, readSource });
  assert.equal(status.code, 0);
  assert.equal(line(status.out, 'live revision'), `${live.revisionId} (seq ${live.seq})`);

  const again = await cli(['restore', '--from', out, '--into', into], { readSource });
  assert.equal(again.code, 1);
  assert.match(again.err, /^target_not_empty: /);
});

test('backup copies regular files only, never through a link, and names what it left out', async (t) => {
  const store = await seeded(t);
  const outside = tempDir(t, 'store-outside-');
  writeFileSync(path.join(outside, 'secret.txt'), 'outside the store\n');
  mkdirSync(path.join(outside, 'revision'));
  writeFileSync(path.join(outside, 'revision', 'manifest.json'), 'outside the store\n');
  const planted = {
    file: `drafts/drf_${'a'.repeat(32)}.json`,
    directory: `revisions/rev_${'b'.repeat(32)}`,
    fifo: 'audit/2026-09.jsonl',
  };
  symlinkSync(path.join(outside, 'secret.txt'), path.join(store.paths.root, planted.file));
  symlinkSync(path.join(outside, 'revision'), path.join(store.paths.root, planted.directory));
  fifo(path.join(store.paths.root, planted.fifo));
  // ephemeral/ is #2's, and no backup looks in it.
  symlinkSync(path.join(outside, 'secret.txt'), path.join(store.paths.ephemeral, 'auth', 'link'));

  const out = target(t, 'b1');
  const backup = await backupStore({ fs: nodeFs, paths: store.paths, lock: store.lock }, out);
  assert.equal(backup.kind, 'done');
  if (backup.kind !== 'done') return;
  assert.deepEqual(backup.skipped, [planted.fifo, planted.file, planted.directory]);
  const files = filesUnder(out);
  assert.ok(files.length > 5);
  for (const file of files) {
    for (const entry of Object.values(planted)) {
      assert.ok(file !== entry && !file.startsWith(`${entry}/`), file);
    }
    assert.doesNotMatch(readFileSync(path.join(out, file), 'utf8'), /outside the store/, file);
  }
  // What it holds restores whole.
  assert.equal((await restoreStore({ fs: nodeFs }, out, target(t, 'restored'))).kind, 'restored');

  // The command names each one, and exits 1.
  const run = await cli(['backup', '--out', target(t, 'b2')], {
    dataDir: store.paths.root,
    readSource,
  });
  assert.equal(run.code, 1, run.err);
  assert.deepEqual(
    run.err.split('\n').filter((entry) => entry.startsWith('not_regular_file: ')),
    [planted.fifo, planted.file, planted.directory].map(
      (entry) => `not_regular_file: left out ${entry}, a link or a special file.`,
    ),
  );
});

test('restore refuses a backup that holds a link or a special file, and writes nothing', async (t) => {
  const store = await seeded(t);
  const out = target(t, 'b1');
  assert.equal(
    (await backupStore({ fs: nodeFs, paths: store.paths, lock: store.lock }, out)).kind,
    'done',
  );
  const manifest = JSON.parse(
    readFileSync(path.join(out, BACKUP_MANIFEST), 'utf8'),
  ) as BackupManifest;
  const document = manifest.files.find((file) => file.path.endsWith('/documents/portfolio.yml'))!;
  const outside = tempDir(t, 'store-outside-');
  /** `file` in `dir` moved out of it, with a link to it in its place: the same bytes, by a link. */
  const linked = (dir: string, file: string) => {
    const moved = path.join(mkdtempSync(path.join(outside, 'moved-')), path.basename(file));
    renameSync(path.join(dir, file), moved);
    symlinkSync(moved, path.join(dir, file));
  };
  const revision = `revisions/rev_${'c'.repeat(32)}`;
  const cases: [string, (dir: string) => void, string][] = [
    [
      'a listed file swapped for a link to its bytes',
      (dir) => linked(dir, document.path),
      document.path,
    ],
    ['its manifest a link', (dir) => linked(dir, BACKUP_MANIFEST), BACKUP_MANIFEST],
    ['a linked directory', (dir) => symlinkSync(outside, path.join(dir, revision)), revision],
    ['a FIFO', (dir) => fifo(path.join(dir, 'audit', '2026-09.jsonl')), 'audit/2026-09.jsonl'],
  ];
  for (const [what, change, where] of cases) {
    const from = target(t, 'variant');
    cpSync(out, from, { recursive: true });
    change(from);
    const into = target(t, 'restored');
    assert.deepEqual(
      await restoreStore({ fs: nodeFs }, from, into),
      { kind: 'refused', code: 'not_regular_file', path: where },
      what,
    );
    assert.equal(existsSync(into), false, `${what}: nothing was written`);
  }

  const from = target(t, 'variant');
  cpSync(out, from, { recursive: true });
  fifo(path.join(from, 'audit', '2026-09.jsonl'));
  const run = await cli(['restore', '--from', from, '--into', target(t, 'restored')], {
    readSource,
  });
  assert.equal(run.code, 1);
  assert.equal(
    run.err,
    'not_regular_file: The backup holds a link or a special file (audit/2026-09.jsonl). A ' +
      'backup holds directories and regular files only, and a restore follows no link. ' +
      'Nothing was restored.\n',
  );
});
