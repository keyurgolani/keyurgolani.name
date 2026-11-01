import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { nodeFs, type FsPort } from './fs-port';
import { BACKUP_CLAIM, isWithin, RESTORE_CLAIM, STORE_LAYOUT, storePaths } from './layout';
import { preflight, storeDirectories } from './preflight';
import { tempDir } from './test-support/fixtures';

const runsAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

test('preflight makes the store directories at 0700 and writes store.json into a new store', async (t) => {
  const dataDir = tempDir(t);
  assert.equal(await preflight({ dataDir }), null);
  const paths = storePaths(dataDir);
  for (const dir of storeDirectories(paths)) {
    assert.equal(statSync(dir).mode & 0o777, 0o700, dir);
  }
  assert.deepEqual(JSON.parse(readFileSync(paths.storeFile, 'utf8')), { layout: STORE_LAYOUT });
  assert.equal(statSync(paths.storeFile).mode & 0o777, 0o600);
  // No probe is left behind, and a second start finds it ready.
  assert.deepEqual(
    (await nodeFs.readdir(dataDir)).filter((name) => name.startsWith('.')),
    [],
  );
  assert.equal(await preflight({ dataDir }), null);
});

test('a missing data directory, or a file in its place, is data_dir_missing', async (t) => {
  const root = tempDir(t);
  assert.equal(await preflight({ dataDir: path.join(root, 'nothing-here') }), 'data_dir_missing');
  writeFileSync(path.join(root, 'a-file'), '');
  assert.equal(await preflight({ dataDir: path.join(root, 'a-file') }), 'data_dir_missing');
  assert.equal(
    await preflight({ dataDir: path.join(root, 'a-file', 'below') }),
    'data_dir_missing',
  );
});

test(
  'a data directory the server cannot write is data_dir_not_writable',
  { skip: runsAsRoot },
  async (t) => {
    const dataDir = tempDir(t);
    chmodSync(dataDir, 0o500);
    try {
      assert.equal(await preflight({ dataDir }), 'data_dir_not_writable');
    } finally {
      chmodSync(dataDir, 0o700);
    }
  },
);

test('a volume where rename fails is data_dir_rename_failed', async (t) => {
  const dataDir = tempDir(t);
  const noRename: FsPort = {
    ...nodeFs,
    async rename() {
      throw Object.assign(new Error('not supported'), { code: 'EXDEV' });
    },
  };
  assert.equal(await preflight({ dataDir, fs: noRename }), 'data_dir_rename_failed');
});

test('a data directory inside the source mount, or holding it, is data_dir_in_source', async (t) => {
  const root = tempDir(t);
  const source = path.join(root, 'config');
  mkdirSync(path.join(source, 'data'), { recursive: true, mode: 0o700 });
  assert.equal(
    await preflight({ dataDir: path.join(source, 'data'), sourceDir: source }),
    'data_dir_in_source',
  );
  assert.equal(await preflight({ dataDir: root, sourceDir: source }), 'data_dir_in_source');
  assert.equal(await preflight({ dataDir: source, sourceDir: source }), 'data_dir_in_source');
  const apart = path.join(root, 'data');
  mkdirSync(apart, { mode: 0o700 });
  assert.equal(await preflight({ dataDir: apart, sourceDir: source }), null);
});

test('a data directory whose name starts with two dots, inside the source mount, is data_dir_in_source', async (t) => {
  const root = tempDir(t);
  const source = path.join(root, 'config');
  mkdirSync(path.join(source, '..x'), { recursive: true, mode: 0o700 });
  assert.equal(
    await preflight({ dataDir: path.join(source, '..x'), sourceDir: source }),
    'data_dir_in_source',
  );
  // And a source mount so named inside the data directory.
  const data = path.join(root, 'data');
  mkdirSync(path.join(data, '..config'), { recursive: true, mode: 0o700 });
  assert.equal(
    await preflight({ dataDir: data, sourceDir: path.join(data, '..config') }),
    'data_dir_in_source',
  );
});

test('isWithin takes a name below a directory that starts with two dots as below it, and only .., a path through it, or another root as outside', () => {
  const base = path.resolve('/srv/data');
  for (const inner of ['/srv/data', '/srv/data/..x', '/srv/data/...', '/srv/data/a/..b/c']) {
    assert.equal(isWithin(base, path.resolve(inner)), true, inner);
  }
  for (const inner of ['/srv', '/srv/data-x', '/srv/..data', '/srv/other/..x', '/']) {
    assert.equal(isWithin(base, path.resolve(inner)), false, inner);
  }
});

test("a data directory its group or anyone may write, or another user's, is data_dir_not_private", async (t) => {
  const dataDir = tempDir(t);
  for (const mode of [0o777, 0o770, 0o702]) {
    chmodSync(dataDir, mode);
    assert.equal(await preflight({ dataDir }), 'data_dir_not_private', mode.toString(8));
  }
  // Read access for others is the operator's call; writing is what's refused.
  chmodSync(dataDir, 0o755);
  assert.equal(await preflight({ dataDir }), null);
  chmodSync(dataDir, 0o700);
  const uid = process.getuid?.() ?? 0;
  const someoneElses: FsPort = {
    ...nodeFs,
    async stat(target) {
      const found = await nodeFs.stat(target);
      return found && target === dataDir ? { ...found, uid: uid + 1 } : found;
    },
  };
  assert.equal(await preflight({ dataDir, fs: someoneElses }), 'data_dir_not_private');
  assert.equal(await preflight({ dataDir }), null);
});

test('a store directory that is a symbolic link is data_dir_linked, and nothing it points at changes', async (t) => {
  const root = tempDir(t);
  const outside = path.join(root, 'outside');
  mkdirSync(outside, { mode: 0o755 });
  for (const linked of ['drafts', 'revisions', 'publication', 'publication/events', 'assets']) {
    const dataDir = path.join(root, linked.replaceAll('/', '-'));
    mkdirSync(path.join(dataDir, path.dirname(linked)), { recursive: true, mode: 0o700 });
    symlinkSync(outside, path.join(dataDir, linked));
    assert.equal(await preflight({ dataDir }), 'data_dir_linked', linked);
    // Not chmodded, and nothing made in it.
    assert.equal(statSync(outside).mode & 0o777, 0o755, linked);
    assert.deepEqual(readdirSync(outside), [], linked);
  }
  // The data directory itself may be a link, to the operator's volume.
  const volume = path.join(root, 'volume');
  mkdirSync(volume, { mode: 0o700 });
  const mounted = path.join(root, 'mounted');
  symlinkSync(volume, mounted);
  assert.equal(await preflight({ dataDir: mounted }), null);
});

test('a store.json of another layout is store_layout_unsupported', async (t) => {
  const dataDir = tempDir(t);
  writeFileSync(path.join(dataDir, 'store.json'), JSON.stringify({ layout: STORE_LAYOUT + 1 }));
  assert.equal(await preflight({ dataDir }), 'store_layout_unsupported');
  writeFileSync(path.join(dataDir, 'store.json'), '{');
  assert.equal(await preflight({ dataDir }), 'store_layout_unsupported');
});

test("preflight refuses a directory a restore didn't finish, by its claim or the log it staged, and lays nothing out", async (t) => {
  const claimed = tempDir(t);
  writeFileSync(path.join(claimed, RESTORE_CLAIM), '{}\n');
  const staged = tempDir(t);
  mkdirSync(path.join(staged, '.publication.0123456789ab.tmp', 'events'), { recursive: true });
  for (const dataDir of [claimed, staged]) {
    const before = readdirSync(dataDir);
    assert.equal(await preflight({ dataDir }), 'data_dir_restore_incomplete', dataDir);
    assert.deepEqual(readdirSync(dataDir), before, 'nothing was laid out');
  }
  // A backup's claim is a backup directory's, and no data directory's business.
  const backup = tempDir(t);
  writeFileSync(path.join(backup, BACKUP_CLAIM), '{}\n');
  assert.equal(await preflight({ dataDir: backup }), null);
});
