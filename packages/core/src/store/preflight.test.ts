import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { nodeFs, type FsPort } from './fs-port';
import { STORE_LAYOUT, storePaths } from './layout';
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
  mkdirSync(path.join(source, 'data'), { recursive: true });
  assert.equal(
    await preflight({ dataDir: path.join(source, 'data'), sourceDir: source }),
    'data_dir_in_source',
  );
  assert.equal(await preflight({ dataDir: root, sourceDir: source }), 'data_dir_in_source');
  assert.equal(await preflight({ dataDir: source, sourceDir: source }), 'data_dir_in_source');
  const apart = path.join(root, 'data');
  mkdirSync(apart);
  assert.equal(await preflight({ dataDir: apart, sourceDir: source }), null);
});

test('a store.json of another layout is store_layout_unsupported', async (t) => {
  const dataDir = tempDir(t);
  writeFileSync(path.join(dataDir, 'store.json'), JSON.stringify({ layout: STORE_LAYOUT + 1 }));
  assert.equal(await preflight({ dataDir }), 'store_layout_unsupported');
  writeFileSync(path.join(dataDir, 'store.json'), '{');
  assert.equal(await preflight({ dataDir }), 'store_layout_unsupported');
});
