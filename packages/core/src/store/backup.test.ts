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
import { createHash } from 'node:crypto';
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
import { newRevisionId, RESTORE_CLAIM, storePaths } from './layout';
import { readLive } from './pointer';
import { preflight } from './preflight';
import { placeCopiedLog } from './publication';
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
  // So is one the manifest lists, with its size and hash: no manifest that
  // names ephemeral/ is one a restore trusts.
  const manifest = JSON.parse(
    readFileSync(path.join(planted, BACKUP_MANIFEST), 'utf8'),
  ) as BackupManifest;
  const bytes = readFileSync(path.join(planted, 'ephemeral', 'auth', 'revoked-before'));
  const listed = {
    path: 'ephemeral/auth/revoked-before',
    size: bytes.byteLength,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
  writeFileSync(
    path.join(planted, BACKUP_MANIFEST),
    JSON.stringify({ ...manifest, files: [listed, ...manifest.files] }),
  );
  const listedInto = target(t, 'listed');
  assert.deepEqual(await restoreStore({ fs: nodeFs }, planted, listedInto), {
    kind: 'refused',
    code: 'manifest_unreadable',
  });
  assert.equal(existsSync(listedInto), false);
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
      if (point === 'backup.write') writes.push(relative(file).replace(STAGED, 'publication'));
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

/** A backup of `store` in a directory of its own. */
async function backedUp(t: TestContext, store: Store, name = 'b1'): Promise<string> {
  const out = target(t, name);
  const backup = await backupStore({ fs: nodeFs, paths: store.paths, lock: store.lock }, out);
  assert.equal(backup.kind, 'done');
  return out;
}

/** A copy of the backup in `from`, its manifest changed by `edit`. */
function edited(t: TestContext, from: string, edit: (manifest: BackupManifest) => unknown): string {
  const copy = target(t, 'edited');
  cpSync(from, copy, { recursive: true });
  const file = path.join(copy, BACKUP_MANIFEST);
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as BackupManifest;
  writeFileSync(file, JSON.stringify(edit(manifest)));
  return copy;
}

test('two backups into one new --out at once: one is done, the other gets target_not_empty, and the first stays whole', async (t) => {
  const store = await seeded(t);
  const out = target(t, 'same');
  const both = await Promise.all([
    backupStore({ fs: nodeFs, paths: store.paths, lock: store.lock }, out),
    backupStore({ fs: nodeFs, paths: store.paths, lock: store.lock }, out),
  ]);
  assert.deepEqual(
    both.map((outcome) => (outcome.kind === 'refused' ? outcome.code : outcome.kind)).sort(),
    ['done', 'target_not_empty'],
  );
  const done = both.find((outcome) => outcome.kind === 'done');
  assert.ok(done?.kind === 'done');
  const restored = await restoreStore({ fs: nodeFs }, out, target(t, 'restored'));
  assert.equal(restored.kind, 'restored');
  assert.deepEqual(restored.kind === 'restored' && restored.manifest, done.manifest);
});

test('a backup that fails takes back only what it wrote, and leaves what another put in its target', async (t) => {
  const store = await seeded(t);
  const out = target(t, 'b1');
  let writes = 0;
  const meddling: FsPort = {
    ...nodeFs,
    async writeFile(file, data, point, options) {
      if (point === 'backup.write') {
        writes += 1;
        // Once the backup has made assets/, someone else puts files there and beside it.
        if (writes === 2) {
          writeFileSync(path.join(out, 'assets', 'keep.txt'), 'mine\n');
          writeFileSync(path.join(out, 'notes.txt'), 'mine too\n');
        }
        if (writes === 4) throw Object.assign(new Error('No space left.'), { code: 'ENOSPC' });
      }
      return nodeFs.writeFile(file, data, point, options);
    },
  };
  await assert.rejects(backupStore({ fs: meddling, paths: store.paths, lock: store.lock }, out));
  assert.deepEqual(readdirSync(out).sort(), ['assets', 'notes.txt']);
  assert.deepEqual(readdirSync(path.join(out, 'assets')), ['keep.txt']);
  assert.equal(await store.lock.holder(), null, 'the lock is free');
});

test("a server's preflight and a restore racing for one directory: whichever claims it first has it", async (t) => {
  const store = await seeded(t);
  const out = await backedUp(t, store);

  // The restore claims an empty volume first. Preflight refuses it while the
  // restore runs, lays nothing out, and the restore goes on.
  const volume = tempDir(t, 'store-volume-');
  let reached!: () => void;
  const paused = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const pausing: FsPort = {
    ...nodeFs,
    async writeFile(file, data, point, options) {
      if (point === 'restore.write' && !held) {
        held = true;
        reached();
        await gate;
      }
      return nodeFs.writeFile(file, data, point, options);
    },
  };
  const restoring = restoreStore({ fs: pausing }, out, volume);
  await paused;
  const claimed = readdirSync(volume).sort();
  assert.ok(claimed.includes(RESTORE_CLAIM));
  assert.equal(await preflight({ dataDir: volume }), 'data_dir_restore_incomplete');
  assert.deepEqual(readdirSync(volume).sort(), claimed, 'preflight laid nothing out');
  release();
  assert.equal((await restoring).kind, 'restored');
  assert.equal(await preflight({ dataDir: volume }), null);

  // Preflight lays out a volume first: the restore finds it in use, and leaves it as it was.
  const laidOut = tempDir(t, 'store-volume-');
  assert.equal(await preflight({ dataDir: laidOut }), null);
  const before = filesUnder(laidOut);
  assert.deepEqual(await restoreStore({ fs: nodeFs }, out, laidOut), {
    kind: 'refused',
    code: 'target_not_empty',
  });
  assert.deepEqual(filesUnder(laidOut), before);
});

test("restore refuses a manifest whose pointer isn't last, that lists a path twice, or of another backup format", async (t) => {
  const store = await seeded(t);
  const out = await backedUp(t, store);
  const cases: [string, (manifest: BackupManifest) => unknown][] = [
    ['the pointer first', (m) => ({ ...m, files: [m.files.at(-1)!, ...m.files.slice(0, -1)] })],
    ['a path twice', (m) => ({ ...m, files: [m.files[0]!, ...m.files] })],
    ['another format', (m) => ({ ...m, backupFormat: 2 })],
  ];
  for (const [what, edit] of cases) {
    const into = target(t, 'restored');
    assert.deepEqual(
      await restoreStore({ fs: nodeFs }, edited(t, out, edit), into),
      { kind: 'refused', code: 'manifest_unreadable' },
      what,
    );
    assert.equal(existsSync(into), false, `${what}: nothing was written`);
  }
});

test('a backup file that changes between the check and the copy stops the restore with hash_mismatch, and nothing stays', async (t) => {
  const store = await seeded(t);
  const out = await backedUp(t, store);
  const manifest = JSON.parse(
    readFileSync(path.join(out, BACKUP_MANIFEST), 'utf8'),
  ) as BackupManifest;
  const changing = path.join(out, ...manifest.files[2]!.path.split('/'));
  let reads = 0;
  const swapping: FsPort = {
    ...nodeFs,
    async readFile(file) {
      const bytes = await nodeFs.readFile(file);
      if (file !== changing) return bytes;
      reads += 1;
      return reads === 1 ? bytes : Buffer.concat([bytes, Buffer.from(' ')]);
    },
  };
  const into = target(t, 'restored');
  assert.deepEqual(await restoreStore({ fs: swapping }, out, into), {
    kind: 'refused',
    code: 'hash_mismatch',
    path: manifest.files[2]!.path,
  });
  assert.equal(existsSync(into), false);
});

test('restore refuses a target inside the backup, or one that holds it, and writes nothing', async (t) => {
  const store = await seeded(t);
  const out = await backedUp(t, store);
  const before = filesUnder(out);
  // An empty directory adds no file, so the backup still reads whole.
  const nested = path.join(out, 'nested');
  mkdirSync(nested);
  for (const into of [nested, path.dirname(out)]) {
    assert.deepEqual(
      await restoreStore({ fs: nodeFs }, out, into),
      { kind: 'refused', code: 'target_overlaps' },
      into,
    );
  }
  assert.deepEqual(readdirSync(nested), []);
  assert.deepEqual(filesUnder(out), before);
});

test('a copied log goes in place only from a dot directory of its own root', async (t) => {
  const root = tempDir(t, 'store-place-');
  const undotted = path.join(root, 'staged');
  const elsewhere = path.join(tempDir(t, 'store-place-'), '.staged');
  for (const staged of [undotted, elsewhere]) {
    mkdirSync(path.join(staged, 'events'), { recursive: true });
    await assert.rejects(placeCopiedLog(nodeFs, staged, root, 'restore'), TypeError, staged);
    assert.ok(existsSync(path.join(staged, 'events')), 'the staged log stays');
  }
  assert.deepEqual(readdirSync(root), ['staged'], 'no publication/ was made');
});

test("a restore whose pointer isn't the manifest's says so and exits 1", async (t) => {
  const store = await seeded(t);
  const out = await backedUp(t, store);
  const other = newRevisionId();
  const copy = edited(t, out, (m) => ({ ...m, live: { ...m.live!, revisionId: other } }));
  const run = await cli(['restore', '--from', copy, '--into', target(t, 'restored')], {
    readSource,
  });
  assert.equal(run.code, 1, run.out);
  assert.match(
    run.err,
    new RegExp(
      `^The restored pointer doesn't name ${other}, as the backup's manifest does\\.$`,
      'm',
    ),
  );
});

test('two restores into one new directory at once: one restores, the other gets target_not_empty, and the store is whole', async (t) => {
  const store = await seeded(t);
  const out = await backedUp(t, store);
  const into = target(t, 'restored');
  // No lock orders two restores: the claim alone does.
  const both = await Promise.all([
    restoreStore({ fs: nodeFs }, out, into),
    restoreStore({ fs: nodeFs }, out, into),
  ]);
  assert.deepEqual(
    both.map((outcome) => (outcome.kind === 'refused' ? outcome.code : outcome.kind)).sort(),
    ['restored', 'target_not_empty'],
  );
  assert.equal(await preflight({ dataDir: into }), null);
  const report = await verifyStore({ fs: nodeFs, paths: storePaths(into), checks: testChecks() });
  assert.deepEqual(report.problems, []);
  assert.equal((await readLive(nodeFs, storePaths(into)))?.seq, 2);
});

test('a backup or a restore that fails in a directory that was there and empty leaves it there, and empty', async (t) => {
  const store = await seeded(t);
  const out = await backedUp(t, store);
  /** nodeFs, except that the third file `operation` writes fails. */
  const failing = (operation: 'backup' | 'restore'): FsPort => {
    let writes = 0;
    return {
      ...nodeFs,
      async writeFile(file, data, point, options) {
        if (point === `${operation}.write` && ++writes === 3) {
          throw Object.assign(new Error('No space left.'), { code: 'ENOSPC' });
        }
        return nodeFs.writeFile(file, data, point, options);
      },
    };
  };
  // An operator's own directory, or a volume's mount point: there before the run.
  const backupDir = tempDir(t, 'store-existing-');
  await assert.rejects(
    backupStore({ fs: failing('backup'), paths: store.paths, lock: store.lock }, backupDir),
  );
  assert.deepEqual(readdirSync(backupDir), [], 'the backup directory stays, empty');
  const volume = tempDir(t, 'store-existing-');
  await assert.rejects(restoreStore({ fs: failing('restore') }, out, volume));
  assert.deepEqual(readdirSync(volume), [], 'the volume stays, empty');
});
